import { Logger } from '@nestjs/common';
import { Pool } from 'pg';
import {
  createIsolatedSchema,
  describeWithDb,
  IsolatedSchema,
} from '../../test/support/isolated-schema';
import { AppConfig } from '../config/config';
import { applySchema } from '../database/schema';
import { ChainReader } from './chain-reader';
import { DecodedLog } from './decode';
import { IndexerService } from './indexer.service';
import { readCheckpoint } from './projection';
import { BlockRange } from './range';

const SENDER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const BENEFICIARY = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const TOKEN = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const TX = `0x${'ab'.repeat(32)}`;
const DEPLOYMENT = {
  address: '0xe7f1725e7734ce288f8367e1bb143e90bb3f0512',
  startBlock: 5,
};

/** A chain in memory: tests move `head`, add logs and make the next calls fail. */
class FakeChain implements ChainReader {
  head = 0n;
  logs: DecodedLog[] = [];
  requested: BlockRange[] = [];
  failures = 0;

  getBlockNumber(): Promise<bigint> {
    return Promise.resolve(this.head);
  }

  getLogs(range: BlockRange): Promise<DecodedLog[]> {
    this.requested.push(range);
    if (this.failures > 0) {
      this.failures--;
      return Promise.reject(new Error('node unavailable'));
    }
    return Promise.resolve(
      this.logs.filter(
        (log) => log.blockNumber! >= range.from && log.blockNumber! <= range.to,
      ),
    );
  }
}

const createdLog = (
  id: number,
  blockNumber: bigint,
  amount = 1000n,
): DecodedLog => ({
  eventName: 'EscrowCreated',
  args: {
    id: BigInt(id),
    sender: SENDER,
    beneficiary: BENEFICIARY,
    token: TOKEN,
    amount,
    cancelDeadline: 1_700_007_200n,
    expiresAt: 1_700_604_800n,
  },
  blockNumber,
  logIndex: 0,
  transactionHash: TX,
});

const releasedLog = (id: number, blockNumber: bigint): DecodedLog => ({
  eventName: 'EscrowReleased',
  args: { id: BigInt(id) },
  blockNumber,
  logIndex: 0,
  transactionHash: TX,
});

describeWithDb('IndexerService', () => {
  let isolated: IsolatedSchema;
  let pool: Pool;
  let chain: FakeChain;

  beforeAll(async () => {
    isolated = await createIsolatedSchema();
    pool = new Pool({ connectionString: isolated.url });
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await pool.end();
    await isolated.drop();
  });

  beforeEach(async () => {
    await pool.query('DROP TABLE IF EXISTS escrows, indexer_state');
    await applySchema(pool);
    chain = new FakeChain();
  });

  const service = (overrides: Partial<AppConfig> = {}) =>
    new IndexerService(
      pool,
      {
        rpcUrl: 'http://127.0.0.1:8545',
        databaseUrl: 'postgres://unused',
        confirmations: 2,
        batchSize: 500,
        pollIntervalMs: 5,
        healthMaxExtraLagBlocks: 10,
        deploymentFile: '/unused',
        ...overrides,
      },
      DEPLOYMENT,
      chain,
    );

  const statuses = async () =>
    (await pool.query('SELECT id, status FROM escrows ORDER BY id')).rows;

  async function waitFor(condition: () => Promise<boolean>) {
    const deadline = Date.now() + 3000;
    while (!(await condition())) {
      if (Date.now() > deadline) throw new Error('condition not met in time');
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  describe('runOnce', () => {
    it('starts at the deploy block and stops at the safe head', async () => {
      chain.head = 20n;
      chain.logs = [createdLog(1, 5n), createdLog(2, 18n), createdLog(3, 19n)];

      expect(await service().runOnce()).toBe(true);

      expect(chain.requested).toEqual([{ from: 5n, to: 18n }]);
      expect(await readCheckpoint(pool)).toBe(18n);
      // Block 19 is not confirmed yet, so escrow 3 is not indexed.
      expect(await statuses()).toEqual([
        { id: '1', status: 'Pending' },
        { id: '2', status: 'Pending' },
      ]);
    });

    it('splits a backlog into batches and then reports nothing to do', async () => {
      chain.head = 20n;
      const indexer = service({ batchSize: 10 });

      expect(await indexer.runOnce()).toBe(true);
      expect(await indexer.runOnce()).toBe(true);
      expect(await indexer.runOnce()).toBe(false);

      expect(chain.requested).toEqual([
        { from: 5n, to: 14n },
        { from: 15n, to: 18n },
      ]);
      expect(await readCheckpoint(pool)).toBe(18n);
    });

    it('does nothing while the first block is not confirmed', async () => {
      chain.head = 6n;

      expect(await service().runOnce()).toBe(false);

      expect(chain.requested).toEqual([]);
      expect(await readCheckpoint(pool)).toBeNull();
    });

    it('applies events from later ranges to escrows from earlier ones', async () => {
      chain.head = 20n;
      chain.logs = [createdLog(1, 6n), releasedLog(1, 16n)];
      const indexer = service({ batchSize: 10 });

      await indexer.runOnce();
      expect(await statuses()).toEqual([{ id: '1', status: 'Pending' }]);

      await indexer.runOnce();
      expect(await statuses()).toEqual([{ id: '1', status: 'Released' }]);
    });

    it('resumes from the checkpoint after a restart', async () => {
      chain.head = 20n;
      chain.logs = [createdLog(1, 6n)];
      await service({ batchSize: 10 }).runOnce();

      chain.head = 30n;
      chain.requested = [];
      await service({ batchSize: 10 }).runOnce();

      expect(chain.requested).toEqual([{ from: 15n, to: 24n }]);
    });

    it('leaves the range pending when the node fails, and retries the same range', async () => {
      chain.head = 20n;
      chain.logs = [createdLog(1, 6n)];
      chain.failures = 1;
      const indexer = service();

      await expect(indexer.runOnce()).rejects.toThrow('node unavailable');
      expect(await readCheckpoint(pool)).toBeNull();

      await indexer.runOnce();
      expect(chain.requested).toEqual([
        { from: 5n, to: 18n },
        { from: 5n, to: 18n },
      ]);
      expect(await statuses()).toEqual([{ id: '1', status: 'Pending' }]);
    });

    it('stores nothing when an event in the range cannot be applied', async () => {
      chain.head = 20n;
      // 10^78 does not fit numeric(78,0), so the second insert fails after the first one worked.
      chain.logs = [createdLog(1, 6n), createdLog(2, 7n, 10n ** 78n)];

      await expect(service().runOnce()).rejects.toThrow();

      expect(await statuses()).toEqual([]);
      expect(await readCheckpoint(pool)).toBeNull();
    });
  });

  describe('loop', () => {
    it('catches up, follows new blocks and stops on request', async () => {
      chain.head = 20n;
      chain.logs = [createdLog(1, 6n)];
      const indexer = service({ batchSize: 4 });

      indexer.onApplicationBootstrap();
      await waitFor(async () => (await readCheckpoint(pool)) === 18n);

      chain.logs.push(releasedLog(1, 25n));
      chain.head = 30n;
      await waitFor(async () => (await readCheckpoint(pool)) === 28n);
      expect(await statuses()).toEqual([{ id: '1', status: 'Released' }]);

      await indexer.onModuleDestroy();
    });

    it('keeps going after the node fails', async () => {
      chain.head = 20n;
      chain.logs = [createdLog(1, 6n)];
      chain.failures = 2;
      const indexer = service();

      indexer.onApplicationBootstrap();
      await waitFor(async () => (await readCheckpoint(pool)) === 18n);
      await indexer.onModuleDestroy();

      expect(chain.requested.length).toBeGreaterThanOrEqual(3);
      expect(await statuses()).toEqual([{ id: '1', status: 'Pending' }]);
    });

    it('stops at once even when the poll interval is long', async () => {
      chain.head = 0n;
      const indexer = service({ pollIntervalMs: 60_000 });

      indexer.onApplicationBootstrap();
      await new Promise((resolve) => setTimeout(resolve, 50));
      const started = Date.now();
      await indexer.onModuleDestroy();

      expect(Date.now() - started).toBeLessThan(1000);
    });
  });
});
