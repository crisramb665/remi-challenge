import request from 'supertest';
import { describeWithDb } from './support/isolated-schema';
import { ApiApp, startApi } from './support/api-app';

const ALICE = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';
const BOB = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
const CAROL = '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc';
const TOKEN = '0x5fbdb2315678afecb367f032d93f642f64180aa3';
const CREATED_TX = `0x${'ab'.repeat(32)}`;
const RESOLVED_TX = `0x${'cd'.repeat(32)}`;
const D = 1000; // cancel deadline of every seeded escrow
const E = 5000; // expiry of every seeded escrow

interface Seed {
  sender: string;
  beneficiary: string;
  status: string;
  amount: string;
  expiresAt: number;
}

// The derived fields (src/escrows/escrow-view.spec.ts), the input rules (query.spec.ts) and the SQL
// (escrows.repository.spec.ts) are tested one by one. These tests only prove what HTTP adds: the
// response body, the node's clock as `now`, the status codes and that the pieces are connected.
describeWithDb('GET /escrows', () => {
  let api: ApiApp;

  beforeAll(async () => {
    api = await startApi();
  });

  afterAll(async () => {
    await api.stop();
  });

  beforeEach(async () => {
    await api.reset();
    api.chain.timestamp = 100n;
  });

  async function seed(id: string | number, overrides: Partial<Seed> = {}) {
    const row: Seed = {
      sender: ALICE,
      beneficiary: BOB,
      status: 'Pending',
      amount: '1000000',
      expiresAt: E,
      ...overrides,
    };
    const resolved = row.status !== 'Pending';
    await api.pool.query(
      `INSERT INTO escrows
         (id, sender, beneficiary, token, amount, cancel_deadline, expires_at,
          status, created_tx, created_block, resolved_tx, resolved_block)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 5, $10, $11)`,
      [
        id.toString(),
        row.sender,
        row.beneficiary,
        TOKEN,
        row.amount,
        D,
        row.expiresAt,
        row.status,
        CREATED_TX,
        resolved ? RESOLVED_TX : null,
        resolved ? 9 : null,
      ],
    );
  }

  const get = (path: string) => request(api.app.getHttpServer()).get(path);
  const idsOf = (body: { items: { id: string }[] }) =>
    body.items.map((item) => item.id);

  describe('/escrows/:id', () => {
    it('returns the escrow with its derived fields', async () => {
      await seed(1);
      api.chain.timestamp = 999n;

      const response = await get('/escrows/1').expect(200);

      expect(response.body).toEqual({
        id: '1',
        sender: ALICE,
        beneficiary: BOB,
        token: TOKEN,
        amount: '1000000',
        cancelDeadline: D,
        expiresAt: E,
        status: 'Pending',
        effectiveStatus: 'Pending',
        canCancel: true,
        canConfirm: true,
        canReject: true,
        canReclaim: false,
        transactions: { created: CREATED_TX, resolved: null },
      });
    });

    it('follows the clock of the node, not the server clock', async () => {
      await seed(1);

      api.chain.timestamp = 100n;
      expect((await get('/escrows/1')).body.effectiveStatus).toBe('Pending');

      api.chain.timestamp = 9_999_999_999n;
      expect((await get('/escrows/1')).body.effectiveStatus).toBe(
        'PendingExpired',
      );
    });

    it('returns 404 for an id that does not exist', async () => {
      await seed(1);

      await get('/escrows/2').expect(404);
    });

    it.each([
      ['letters', 'abc'],
      ['zero', '0'],
    ])('returns 400 for an invalid id (%s)', async (_label, id) => {
      await get(`/escrows/${id}`).expect(400);
    });

    it('returns 503 when the node is unreachable', async () => {
      await seed(1);
      api.chain.down = true;

      await get('/escrows/1').expect(503);
    });
  });

  describe('list', () => {
    it('returns the newest first, with the same shape as a single escrow', async () => {
      await seed(1);
      await seed(2);
      api.chain.timestamp = 999n;

      const { body } = await get('/escrows').expect(200);
      const single = (await get('/escrows/2')).body;

      expect(idsOf(body)).toEqual(['2', '1']);
      expect(body.items[0]).toEqual(single);
      expect(body.nextCursor).toBeNull();
    });

    it('defaults to 20 results and accepts up to 100', async () => {
      for (let id = 1; id <= 25; id++) await seed(id);

      const first = (await get('/escrows').expect(200)).body;
      expect(first.items).toHaveLength(20);
      expect(first.nextCursor).toBe('6');

      const all = (await get('/escrows?limit=100').expect(200)).body;
      expect(all.items).toHaveLength(25);
      expect(all.nextCursor).toBeNull();
    });

    it('filters by sender and beneficiary, in any letter case', async () => {
      await seed(1, { sender: ALICE, beneficiary: BOB });
      await seed(2, { sender: BOB, beneficiary: ALICE });
      await seed(3, { sender: ALICE, beneficiary: CAROL });
      const checksummed = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

      expect(
        idsOf((await get(`/escrows?sender=${checksummed}`).expect(200)).body),
      ).toEqual(['3', '1']);
      expect(
        idsOf((await get(`/escrows?beneficiary=${CAROL}`).expect(200)).body),
      ).toEqual(['3']);
    });

    it('filters by the effective status, so Pending leaves out PendingExpired', async () => {
      await seed(1, { expiresAt: 500 }); // expired at block time 600
      await seed(2, { expiresAt: 9000 });
      await seed(3, { status: 'Released' });
      api.chain.timestamp = 600n;

      const pending = await get('/escrows?status=Pending').expect(200);
      const expired = await get('/escrows?status=PendingExpired').expect(200);
      const released = await get('/escrows?status=Released').expect(200);

      expect(idsOf(pending.body)).toEqual(['2']);
      expect(idsOf(expired.body)).toEqual(['1']);
      expect(expired.body.items[0].effectiveStatus).toBe('PendingExpired');
      expect(idsOf(released.body)).toEqual(['3']);
    });

    it.each([
      ['sender', 'sender=nope'],
      ['status', 'status=Frozen'],
      ['cursor', 'cursor=abc'],
      ['limit', 'limit=0'],
    ])('returns 400 for an invalid %s', async (_label, query) => {
      await get(`/escrows?${query}`).expect(400);
    });

    it('returns 503 when the node is unreachable', async () => {
      await seed(1);
      api.chain.down = true;

      await get('/escrows').expect(503);
    });
  });
});
