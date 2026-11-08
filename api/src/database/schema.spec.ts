import { Client } from 'pg';
import {
  createIsolatedSchema,
  describeWithDb,
  IsolatedSchema,
} from '../../test/support/isolated-schema';
import { applySchema } from './schema';

const SENDER = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';
const BENEFICIARY = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
const TOKEN = '0x5fbdb2315678afecb367f032d93f642f64180aa3';
const UINT256_MAX =
  '115792089237316195423570985008687907853269984665640564039457584007913129639935';

describeWithDb('schema.sql', () => {
  let isolated: IsolatedSchema;
  let client: Client;

  beforeAll(async () => {
    isolated = await createIsolatedSchema();
    client = new Client({ connectionString: isolated.url });
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
    await isolated.drop();
  });

  beforeEach(async () => {
    await client.query('DROP TABLE IF EXISTS escrows, indexer_state');
    await applySchema(client);
  });

  async function insertEscrow(
    overrides: Partial<Record<'id' | 'sender' | 'amount', string>> = {},
  ) {
    await client.query(
      `INSERT INTO escrows
         (id, sender, beneficiary, token, amount, cancel_deadline, expires_at,
          status, created_tx, created_block)
       VALUES ($1, $2, $3, $4, $5, 7200, 604800, 'Pending', '0xabc', 1)`,
      [
        overrides.id ?? '1',
        overrides.sender ?? SENDER,
        BENEFICIARY,
        TOKEN,
        overrides.amount ?? '1000000',
      ],
    );
  }

  async function columns(table: string) {
    const { rows } = await client.query(
      `SELECT column_name, data_type, numeric_precision, numeric_scale, is_nullable
         FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2`,
      [isolated.schema, table],
    );
    return Object.fromEntries(rows.map((row) => [row.column_name, row]));
  }

  it('creates the escrows table with the types from SPEC section 3.4', async () => {
    const cols = await columns('escrows');

    expect(Object.keys(cols).sort()).toEqual(
      [
        'id',
        'sender',
        'beneficiary',
        'token',
        'amount',
        'cancel_deadline',
        'expires_at',
        'status',
        'created_tx',
        'created_block',
        'resolved_tx',
        'resolved_block',
        'updated_at',
      ].sort(),
    );
    expect(cols.id.data_type).toBe('numeric');
    expect(cols.amount.data_type).toBe('numeric');
    expect(cols.amount.numeric_precision).toBe(78);
    expect(cols.amount.numeric_scale).toBe(0);
    expect(cols.cancel_deadline.data_type).toBe('bigint');
    expect(cols.expires_at.data_type).toBe('bigint');
    expect(cols.created_block.data_type).toBe('bigint');
    expect(cols.resolved_block.data_type).toBe('bigint');
    expect(cols.updated_at.data_type).toBe('timestamp with time zone');
  });

  it('allows null only in the resolved columns', async () => {
    const cols = await columns('escrows');

    const nullable = Object.keys(cols).filter(
      (name) => cols[name].is_nullable === 'YES',
    );
    expect(nullable.sort()).toEqual(['resolved_block', 'resolved_tx']);
  });

  it('creates indexer_state with a last_block bigint', async () => {
    const cols = await columns('indexer_state');

    expect(Object.keys(cols).sort()).toEqual([
      'id',
      'last_block',
      'updated_at',
    ]);
    expect(cols.id.data_type).toBe('integer');
    expect(cols.last_block.data_type).toBe('bigint');
  });

  it('indexes sender, beneficiary and status', async () => {
    const { rows } = await client.query(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname = $1 AND tablename = 'escrows'`,
      [isolated.schema],
    );
    const definitions = rows.map((row) => row.indexdef as string).join('\n');

    expect(definitions).toContain('(sender)');
    expect(definitions).toContain('(beneficiary)');
    expect(definitions).toContain('(status)');
  });

  it('can be applied again without changing anything', async () => {
    await insertEscrow();
    await client.query(
      'INSERT INTO indexer_state (id, last_block) VALUES (1, 5)',
    );

    await applySchema(client);
    await applySchema(client);

    const escrows = await client.query(
      'SELECT count(*)::int AS n FROM escrows',
    );
    const state = await client.query('SELECT last_block FROM indexer_state');
    expect(escrows.rows[0].n).toBe(1);
    expect(state.rows[0].last_block).toBe('5');
  });

  it('stores a uint256 amount and a uint256 id without losing digits', async () => {
    await insertEscrow({ id: UINT256_MAX, amount: UINT256_MAX });

    const { rows } = await client.query('SELECT id, amount FROM escrows');
    expect(rows[0].id).toBe(UINT256_MAX);
    expect(rows[0].amount).toBe(UINT256_MAX);
  });

  it('rejects a second escrow with the same id', async () => {
    await insertEscrow();
    await expect(insertEscrow()).rejects.toThrow();
  });

  it('rejects an address that is not lowercase', async () => {
    await expect(
      insertEscrow({ sender: SENDER.toUpperCase().replace('0X', '0x') }),
    ).rejects.toThrow();
  });

  it('allows a single indexer_state row with id 1', async () => {
    await client.query(
      'INSERT INTO indexer_state (id, last_block) VALUES (1, 5)',
    );

    await expect(
      client.query('INSERT INTO indexer_state (id, last_block) VALUES (2, 5)'),
    ).rejects.toThrow();
    await expect(
      client.query('INSERT INTO indexer_state (id, last_block) VALUES (1, 6)'),
    ).rejects.toThrow();
  });
});
