import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { AppModule } from '../src/app.module';
import { ConfigError } from '../src/config/config';
import { DEPLOYMENT } from '../src/config/config.module';
import { Deployment } from '../src/config/deployment';
import { PG_POOL } from '../src/database/database.module';
import { CHAIN_READER, ChainReader } from '../src/indexer/chain-reader';
import {
  createIsolatedSchema,
  describeWithDb,
  IsolatedSchema,
} from './support/isolated-schema';

const ADDRESS = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const ENV_KEYS = [
  'RPC_URL',
  'DATABASE_URL',
  'CONFIRMATIONS',
  'BATCH_SIZE',
  'POLL_INTERVAL_MS',
  'HEALTH_MAX_EXTRA_LAG_BLOCKS',
  'DEPLOYMENT_FILE',
];

describe('AppModule boot', () => {
  const saved: Record<string, string | undefined> = {};
  let dir: string;

  beforeEach(() => {
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    dir = mkdtempSync(join(tmpdir(), 'app-'));
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('refuses to start when the configuration is invalid', async () => {
    for (const key of ENV_KEYS) delete process.env[key];

    await expect(
      Test.createTestingModule({ imports: [AppModule] }).compile(),
    ).rejects.toThrow(ConfigError);
  });

  it('refuses to start when the deployment file is missing', async () => {
    Object.assign(process.env, {
      RPC_URL: 'http://127.0.0.1:8545',
      DATABASE_URL: 'postgres://u:p@localhost:5432/db',
      CONFIRMATIONS: '2',
      BATCH_SIZE: '500',
      POLL_INTERVAL_MS: '1000',
      DEPLOYMENT_FILE: join(dir, 'missing.json'),
    });

    await expect(
      Test.createTestingModule({ imports: [AppModule] }).compile(),
    ).rejects.toThrow('Cannot read the deployment file');
  });

  describeWithDb('with a database', () => {
    let isolated: IsolatedSchema;
    let app: INestApplication;

    beforeEach(async () => {
      isolated = await createIsolatedSchema();
      const deploymentFile = join(dir, 'deployment.json');
      writeFileSync(
        deploymentFile,
        JSON.stringify({ address: ADDRESS, startBlock: 3 }),
      );
      Object.assign(process.env, {
        RPC_URL: 'http://127.0.0.1:8545',
        DATABASE_URL: isolated.url,
        CONFIRMATIONS: '2',
        BATCH_SIZE: '500',
        POLL_INTERVAL_MS: '1000',
        DEPLOYMENT_FILE: deploymentFile,
      });

      // An empty chain, so the indexer loop starts but never needs a node.
      const emptyChain: ChainReader = {
        getBlockNumber: () => Promise.resolve(0n),
        getLogs: () => Promise.resolve([]),
      };
      const moduleRef = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(CHAIN_READER)
        .useValue(emptyChain)
        .compile();
      app = moduleRef.createNestApplication();
      await app.init();
    });

    afterEach(async () => {
      await app.close();
      await isolated.drop();
    });

    it('creates the schema at startup', async () => {
      const pool = app.get<Pool>(PG_POOL);
      const { rows } = await pool.query(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = $1 ORDER BY table_name`,
        [isolated.schema],
      );

      expect(rows.map((row) => row.table_name)).toEqual([
        'escrows',
        'indexer_state',
      ]);
    });

    it('exposes the deployment read from the file', () => {
      expect(app.get<Deployment>(DEPLOYMENT)).toEqual({
        address: ADDRESS.toLowerCase(),
        startBlock: 3,
      });
    });
  });
});
