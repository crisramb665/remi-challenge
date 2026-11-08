import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// schema.sql sits next to this file, in src/ during tests and in dist/ after the build.
const SCHEMA_SQL = readFileSync(join(__dirname, 'schema.sql'), 'utf8');

export interface Queryable {
  query(text: string): Promise<unknown>;
}

/** Creates the tables and indexes if they are missing. Running it again changes nothing. */
export async function applySchema(db: Queryable): Promise<void> {
  await db.query(SCHEMA_SQL);
}
