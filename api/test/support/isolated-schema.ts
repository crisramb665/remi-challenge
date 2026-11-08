import { randomBytes } from 'node:crypto';
import { Client } from 'pg';

/**
 * Database tests run only when TEST_DATABASE_URL points at a Postgres, for example the
 * container from the README. Each test file works in its own schema and drops it afterwards,
 * so nothing else in that database is touched.
 */
export const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  console.warn('TEST_DATABASE_URL is not set: the database tests are skipped.');
}

export const describeWithDb = testDatabaseUrl ? describe : describe.skip;

export interface IsolatedSchema {
  schema: string;
  /** TEST_DATABASE_URL with a search_path that points at the isolated schema. */
  url: string;
  drop(): Promise<void>;
}

export async function createIsolatedSchema(): Promise<IsolatedSchema> {
  const base = testDatabaseUrl as string;
  const schema = `t_${randomBytes(6).toString('hex')}`;

  const admin = new Client({ connectionString: base });
  await admin.connect();
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.end();

  const url = new URL(base);
  url.searchParams.set('options', `-c search_path=${schema}`);

  return {
    schema,
    url: url.toString(),
    async drop() {
      const client = new Client({ connectionString: base });
      await client.connect();
      await client.query(`DROP SCHEMA ${schema} CASCADE`);
      await client.end();
    },
  };
}
