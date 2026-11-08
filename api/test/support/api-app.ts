import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { AppModule } from '../../src/app.module';
import { PG_POOL } from '../../src/database/database.module';
import { CHAIN_READER, ChainReader } from '../../src/indexer/chain-reader';
import { createIsolatedSchema } from './isolated-schema';

export const START_BLOCK = 3;

const ENV_KEYS = [
  'RPC_URL',
  'DATABASE_URL',
  'CONFIRMATIONS',
  'BATCH_SIZE',
  'POLL_INTERVAL_MS',
  'HEALTH_MAX_EXTRA_LAG_BLOCKS',
  'DEPLOYMENT_FILE',
];

/** A node the tests control: they set the head, the clock and the chain id, or take it down. */
export class ControllableChain implements ChainReader {
  head = 0n;
  timestamp = 0n;
  chainId = 31337;
  down = false;

  private guard<T>(value: T): Promise<T> {
    return this.down
      ? Promise.reject(new Error('connect ECONNREFUSED'))
      : Promise.resolve(value);
  }

  getBlockNumber() {
    return this.guard(this.head);
  }

  getChainId() {
    return this.guard(this.chainId);
  }

  getLatestBlock() {
    return this.guard({ number: this.head, timestamp: this.timestamp });
  }

  getLogs() {
    return this.guard([]);
  }
}

export interface ApiApp {
  app: INestApplication;
  chain: ControllableChain;
  pool: Pool;
  /** Empties both tables between tests. */
  reset(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Starts the whole application against an isolated Postgres schema and a controllable chain.
 * The indexer polls once at startup and then sleeps for an hour, so it never changes the data
 * the tests insert. Extra environment variables, such as CONFIRMATIONS, can be overridden.
 */
export async function startApi(
  env: Record<string, string> = {},
): Promise<ApiApp> {
  const isolated = await createIsolatedSchema();
  const dir = mkdtempSync(join(tmpdir(), 'api-'));
  const deploymentFile = join(dir, 'deployment.json');
  writeFileSync(
    deploymentFile,
    JSON.stringify({
      address: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
      startBlock: START_BLOCK,
    }),
  );

  const saved: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  Object.assign(process.env, {
    RPC_URL: 'http://127.0.0.1:8545',
    DATABASE_URL: isolated.url,
    CONFIRMATIONS: '2',
    BATCH_SIZE: '500',
    POLL_INTERVAL_MS: '3600000',
    DEPLOYMENT_FILE: deploymentFile,
    ...env,
  });

  const chain = new ControllableChain();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(CHAIN_READER)
    .useValue(chain)
    .compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  const pool = app.get<Pool>(PG_POOL);

  return {
    app,
    chain,
    pool,
    async reset() {
      await pool.query('TRUNCATE escrows, indexer_state');
      chain.head = 0n;
      chain.timestamp = 0n;
      chain.chainId = 31337;
      chain.down = false;
    },
    async stop() {
      await app.close();
      await isolated.drop();
      rmSync(dir, { recursive: true, force: true });
      for (const key of ENV_KEYS) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
    },
  };
}
