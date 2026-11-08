import { Pool } from 'pg';
import {
  createIsolatedSchema,
  describeWithDb,
  IsolatedSchema,
} from '../../test/support/isolated-schema';
import { applySchema } from '../database/schema';
import {
  EscrowCreatedEvent,
  EscrowTransitionEvent,
  TransitionType,
} from './events';
import { applyRange, readCheckpoint } from './projection';

// viem returns checksummed addresses, the database must store them lowercase.
const SENDER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const BENEFICIARY = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const TOKEN = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const UINT256_MAX = 2n ** 256n - 1n;

const tx = (n: number) => `0x${n.toString(16).padStart(64, '0')}`;

function created(
  id: number,
  blockNumber: bigint,
  logIndex = 0,
  overrides: Partial<EscrowCreatedEvent> = {},
): EscrowCreatedEvent {
  return {
    type: 'EscrowCreated',
    id: BigInt(id),
    sender: SENDER,
    beneficiary: BENEFICIARY,
    token: TOKEN,
    amount: 1000n,
    cancelDeadline: 1_700_007_200n,
    expiresAt: 1_700_604_800n,
    blockNumber,
    logIndex,
    txHash: tx(Number(blockNumber) * 100 + logIndex),
    ...overrides,
  };
}

function resolved(
  type: TransitionType,
  id: number,
  blockNumber: bigint,
  logIndex = 0,
): EscrowTransitionEvent {
  return {
    type,
    id: BigInt(id),
    blockNumber,
    logIndex,
    txHash: tx(Number(blockNumber) * 100 + logIndex),
  };
}

describeWithDb('applyRange', () => {
  let isolated: IsolatedSchema;
  let pool: Pool;

  beforeAll(async () => {
    isolated = await createIsolatedSchema();
    pool = new Pool({ connectionString: isolated.url });
  });

  afterAll(async () => {
    await pool.end();
    await isolated.drop();
  });

  beforeEach(async () => {
    await pool.query('DROP TABLE IF EXISTS escrows, indexer_state');
    await applySchema(pool);
  });

  const escrows = async () =>
    (await pool.query('SELECT * FROM escrows ORDER BY id')).rows;

  describe('EscrowCreated', () => {
    it('stores a Pending escrow with lowercase addresses', async () => {
      await applyRange(pool, { from: 5n, to: 5n }, [created(1, 5n, 2)]);

      expect(await escrows()).toEqual([
        {
          id: '1',
          sender: SENDER.toLowerCase(),
          beneficiary: BENEFICIARY.toLowerCase(),
          token: TOKEN.toLowerCase(),
          amount: '1000',
          cancel_deadline: '1700007200',
          expires_at: '1700604800',
          status: 'Pending',
          created_tx: tx(502),
          created_block: '5',
          resolved_tx: null,
          resolved_block: null,
          updated_at: expect.any(Date),
        },
      ]);
    });

    it('keeps the full precision of a uint256 amount', async () => {
      await applyRange(pool, { from: 5n, to: 5n }, [
        created(1, 5n, 0, { amount: UINT256_MAX }),
      ]);

      expect((await escrows())[0].amount).toBe(UINT256_MAX.toString());
    });

    it('ignores a second EscrowCreated for the same id', async () => {
      await applyRange(pool, { from: 5n, to: 5n }, [created(1, 5n)]);
      await applyRange(pool, { from: 6n, to: 6n }, [
        created(1, 6n, 0, { amount: 999n }),
      ]);

      const rows = await escrows();
      expect(rows).toHaveLength(1);
      expect(rows[0].amount).toBe('1000');
      expect(rows[0].created_block).toBe('5');
    });
  });

  describe('transition events', () => {
    it.each([
      ['EscrowCancelled', 'CancelledBySender'],
      ['EscrowReleased', 'Released'],
      ['EscrowRejected', 'Rejected'],
      ['EscrowExpired', 'Expired'],
    ] as const)(
      '%s sets the status %s and records where it happened',
      async (type, status) => {
        await applyRange(pool, { from: 5n, to: 5n }, [created(1, 5n)]);
        await applyRange(pool, { from: 8n, to: 8n }, [
          resolved(type, 1, 8n, 3),
        ]);

        const [row] = await escrows();
        expect(row.status).toBe(status);
        expect(row.resolved_tx).toBe(tx(803));
        expect(row.resolved_block).toBe('8');
      },
    );

    it('does not change an escrow that is already resolved', async () => {
      await applyRange(pool, { from: 5n, to: 5n }, [created(1, 5n)]);
      await applyRange(pool, { from: 6n, to: 6n }, [
        resolved('EscrowReleased', 1, 6n),
      ]);
      await applyRange(pool, { from: 7n, to: 7n }, [
        resolved('EscrowExpired', 1, 7n),
      ]);

      const [row] = await escrows();
      expect(row.status).toBe('Released');
      expect(row.resolved_tx).toBe(tx(600));
      expect(row.resolved_block).toBe('6');
    });

    it('ignores a transition for an escrow that was never created', async () => {
      await applyRange(pool, { from: 8n, to: 8n }, [
        resolved('EscrowReleased', 42, 8n),
      ]);

      expect(await escrows()).toEqual([]);
      expect(await readCheckpoint(pool)).toBe(8n);
    });
  });

  describe('ordering', () => {
    it('applies events by block number, whatever order they arrive in', async () => {
      await applyRange(pool, { from: 5n, to: 7n }, [
        resolved('EscrowReleased', 1, 7n),
        created(1, 5n),
      ]);

      expect((await escrows())[0].status).toBe('Released');
    });

    it('applies events of the same block by log index', async () => {
      await applyRange(pool, { from: 5n, to: 5n }, [
        resolved('EscrowRejected', 1, 5n, 2),
        created(1, 5n, 1),
      ]);

      expect((await escrows())[0].status).toBe('Rejected');
    });

    it('lets the first transition win when two arrive in one range', async () => {
      await applyRange(pool, { from: 5n, to: 9n }, [
        resolved('EscrowExpired', 1, 9n),
        resolved('EscrowCancelled', 1, 6n),
        created(1, 5n),
      ]);

      const [row] = await escrows();
      expect(row.status).toBe('CancelledBySender');
      expect(row.resolved_block).toBe('6');
    });
  });

  describe('checkpoint', () => {
    it('is empty before the first range', async () => {
      expect(await readCheckpoint(pool)).toBeNull();
    });

    it('moves to the end of each range, even when it holds no events', async () => {
      await applyRange(pool, { from: 5n, to: 12n }, [created(1, 5n)]);
      expect(await readCheckpoint(pool)).toBe(12n);

      await applyRange(pool, { from: 13n, to: 20n }, []);
      expect(await readCheckpoint(pool)).toBe(20n);

      const { rows } = await pool.query(
        'SELECT count(*)::int AS n FROM indexer_state',
      );
      expect(rows[0].n).toBe(1);
    });
  });

  describe('atomicity and idempotency', () => {
    const range = { from: 5n, to: 9n };
    const events = [
      created(1, 5n),
      created(2, 6n),
      resolved('EscrowReleased', 1, 7n),
      resolved('EscrowCancelled', 2, 8n),
    ];

    it('replaying a range is a no-op', async () => {
      await applyRange(pool, range, events);
      const before = await escrows();
      const checkpoint = await readCheckpoint(pool);

      await applyRange(pool, range, events);

      expect(await escrows()).toEqual(before);
      expect(await readCheckpoint(pool)).toBe(checkpoint);
    });

    it('rolls back the whole range when one event fails', async () => {
      // 10^78 does not fit numeric(78,0), so the second insert fails after the first succeeded.
      const failing = [
        created(1, 5n),
        created(2, 6n, 0, { amount: 10n ** 78n }),
      ];

      await expect(applyRange(pool, range, failing)).rejects.toThrow();

      expect(await escrows()).toEqual([]);
      expect(await readCheckpoint(pool)).toBeNull();
    });

    it('keeps the previous checkpoint and escrows when a later range fails', async () => {
      await applyRange(pool, { from: 5n, to: 5n }, [created(1, 5n)]);

      await expect(
        applyRange(pool, { from: 6n, to: 9n }, [
          resolved('EscrowReleased', 1, 6n),
          created(2, 7n, 0, { amount: 10n ** 78n }),
        ]),
      ).rejects.toThrow();

      expect((await escrows())[0].status).toBe('Pending');
      expect(await readCheckpoint(pool)).toBe(5n);
    });

    it('is usable again after a failed range', async () => {
      await expect(
        applyRange(pool, range, [created(1, 5n, 0, { amount: 10n ** 78n })]),
      ).rejects.toThrow();

      await applyRange(pool, range, events);

      expect(await escrows()).toHaveLength(2);
      expect(await readCheckpoint(pool)).toBe(9n);
    });
  });
});
