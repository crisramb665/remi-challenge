import { Pool } from 'pg';
import {
  createIsolatedSchema,
  describeWithDb,
  IsolatedSchema,
} from '../../test/support/isolated-schema';
import { applySchema } from '../database/schema';
import { EscrowsRepository } from './escrows.repository';

const ALICE = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';
const BOB = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
const CAROL = '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc';

interface Seed {
  sender: string;
  beneficiary: string;
  status: string;
  expires_at: number;
}

describeWithDb('EscrowsRepository', () => {
  let isolated: IsolatedSchema;
  let pool: Pool;
  let repository: EscrowsRepository;

  beforeAll(async () => {
    isolated = await createIsolatedSchema();
    pool = new Pool({ connectionString: isolated.url });
    repository = new EscrowsRepository(pool);
  });

  afterAll(async () => {
    await pool.end();
    await isolated.drop();
  });

  beforeEach(async () => {
    await pool.query('DROP TABLE IF EXISTS escrows, indexer_state');
    await applySchema(pool);
  });

  async function seed(id: string | number, overrides: Partial<Seed> = {}) {
    const row: Seed = {
      sender: ALICE,
      beneficiary: BOB,
      status: 'Pending',
      expires_at: 5000,
      ...overrides,
    };
    await pool.query(
      `INSERT INTO escrows
         (id, sender, beneficiary, token, amount, cancel_deadline, expires_at,
          status, created_tx, created_block, resolved_tx, resolved_block)
       VALUES ($1, $2, $3, $4, 1000, 1000, $5, $6, $7, 5, $8, $9)`,
      [
        id.toString(),
        row.sender,
        row.beneficiary,
        '0x5fbdb2315678afecb367f032d93f642f64180aa3',
        row.expires_at,
        row.status,
        `0x${'ab'.repeat(32)}`,
        row.status === 'Pending' ? null : `0x${'cd'.repeat(32)}`,
        row.status === 'Pending' ? null : 9,
      ],
    );
  }

  const ids = (rows: { id: string }[]) => rows.map((row) => row.id);
  const list = (
    params: Partial<Parameters<EscrowsRepository['list']>[0]> = {},
  ) => repository.list({ limit: 20, now: 1000n, ...params });

  describe('findById', () => {
    it('returns the stored fields', async () => {
      await seed(3);

      expect(await repository.findById('3')).toEqual({
        id: '3',
        sender: ALICE,
        beneficiary: BOB,
        token: '0x5fbdb2315678afecb367f032d93f642f64180aa3',
        amount: '1000',
        cancel_deadline: '1000',
        expires_at: '5000',
        status: 'Pending',
        created_tx: `0x${'ab'.repeat(32)}`,
        resolved_tx: null,
      });
    });

    it('returns null for an id that does not exist', async () => {
      await seed(3);

      expect(await repository.findById('4')).toBeNull();
    });
  });

  describe('list ordering and paging', () => {
    it('returns an empty page when there are no escrows', async () => {
      expect(await list()).toEqual({ rows: [], nextCursor: null });
    });

    it('orders by id descending, comparing ids as numbers', async () => {
      for (const id of [2, 9, 10, 100]) await seed(id);

      expect(ids((await list()).rows)).toEqual(['100', '10', '9', '2']);
    });

    it('walks through the pages with the cursor', async () => {
      for (const id of [1, 2, 3, 4, 5]) await seed(id);

      const first = await list({ limit: 2 });
      expect(ids(first.rows)).toEqual(['5', '4']);
      expect(first.nextCursor).toBe('4');

      const second = await list({ limit: 2, cursor: first.nextCursor! });
      expect(ids(second.rows)).toEqual(['3', '2']);
      expect(second.nextCursor).toBe('2');

      const third = await list({ limit: 2, cursor: second.nextCursor! });
      expect(ids(third.rows)).toEqual(['1']);
      expect(third.nextCursor).toBeNull();
    });

    it('has no next cursor when a page ends exactly at the last escrow', async () => {
      for (const id of [1, 2, 3, 4]) await seed(id);

      const second = await list({ limit: 2, cursor: '3' });

      expect(ids(second.rows)).toEqual(['2', '1']);
      expect(second.nextCursor).toBeNull();
    });

    it('returns only escrows below the cursor, even if the cursor id does not exist', async () => {
      for (const id of [1, 5, 9]) await seed(id);

      expect(ids((await list({ cursor: '7' })).rows)).toEqual(['5', '1']);
    });
  });

  describe('list filters', () => {
    beforeEach(async () => {
      await seed(1, { sender: ALICE, beneficiary: BOB });
      await seed(2, { sender: BOB, beneficiary: ALICE });
      await seed(3, { sender: ALICE, beneficiary: CAROL });
      await seed(4, { sender: CAROL, beneficiary: BOB });
    });

    it('filters by sender', async () => {
      expect(ids((await list({ sender: ALICE })).rows)).toEqual(['3', '1']);
    });

    it('filters by beneficiary', async () => {
      expect(ids((await list({ beneficiary: BOB })).rows)).toEqual(['4', '1']);
    });

    it('combines sender, beneficiary and cursor', async () => {
      expect(
        ids((await list({ sender: ALICE, beneficiary: BOB })).rows),
      ).toEqual(['1']);
      expect(ids((await list({ sender: ALICE, cursor: '3' })).rows)).toEqual([
        '1',
      ]);
    });
  });

  describe('list status filter', () => {
    beforeEach(async () => {
      await seed(1, { status: 'Pending', expires_at: 5000 });
      await seed(2, { status: 'Pending', expires_at: 9000 });
      await seed(3, { status: 'Released', expires_at: 100 });
      await seed(4, { status: 'CancelledBySender', expires_at: 100 });
      await seed(5, { status: 'Expired', expires_at: 100 });
      await seed(6, { status: 'Rejected', expires_at: 100 });
    });

    it('Pending leaves out escrows whose expiry has passed', async () => {
      expect(ids((await list({ status: 'Pending', now: 4999n })).rows)).toEqual(
        ['2', '1'],
      );
      expect(ids((await list({ status: 'Pending', now: 5000n })).rows)).toEqual(
        ['2'],
      );
    });

    it('PendingExpired holds the Pending escrows whose expiry has passed', async () => {
      expect(
        ids((await list({ status: 'PendingExpired', now: 4999n })).rows),
      ).toEqual([]);
      expect(
        ids((await list({ status: 'PendingExpired', now: 5000n })).rows),
      ).toEqual(['1']);
      expect(
        ids((await list({ status: 'PendingExpired', now: 9000n })).rows),
      ).toEqual(['2', '1']);
    });

    it('Pending and PendingExpired never overlap and together hold every Pending escrow', async () => {
      for (const now of [0n, 4999n, 5000n, 8999n, 9000n, 99999n]) {
        const pending = ids((await list({ status: 'Pending', now })).rows);
        const expired = ids(
          (await list({ status: 'PendingExpired', now })).rows,
        );

        expect(pending.filter((id) => expired.includes(id))).toEqual([]);
        expect([...pending, ...expired].sort()).toEqual(['1', '2']);
      }
    });

    it.each([
      ['Released', ['3']],
      ['CancelledBySender', ['4']],
      ['Expired', ['5']],
      ['Rejected', ['6']],
    ] as const)('%s ignores the time', async (status, expected) => {
      for (const now of [0n, 5000n, 99999n]) {
        expect(ids((await list({ status, now })).rows)).toEqual(expected);
      }
    });

    it('combines the status with the other filters', async () => {
      await seed(7, { sender: CAROL, status: 'Pending', expires_at: 9000 });

      expect(
        ids((await list({ status: 'Pending', sender: CAROL, now: 1n })).rows),
      ).toEqual(['7']);
    });
  });
});
