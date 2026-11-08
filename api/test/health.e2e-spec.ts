import request from 'supertest';
import { ApiApp, START_BLOCK, startApi } from './support/api-app';
import { describeWithDb } from './support/isolated-schema';

describeWithDb('GET /health', () => {
  let api: ApiApp;

  beforeAll(async () => {
    // CONFIRMATIONS is 2 and HEALTH_MAX_EXTRA_LAG_BLOCKS defaults to 10, so lag 12 is the limit.
    api = await startApi();
  });

  afterAll(async () => {
    await api.stop();
  });

  beforeEach(async () => {
    await api.reset();
  });

  const health = () => request(api.app.getHttpServer()).get('/health');

  async function indexedUpTo(block: number) {
    await api.pool.query(
      'INSERT INTO indexer_state (id, last_block) VALUES (1, $1)',
      [block],
    );
  }

  it('reports ok with the lag of the indexer', async () => {
    await indexedUpTo(120);
    api.chain.head = 121n;

    const response = await health().expect(200);

    expect(response.body).toEqual({
      status: 'ok',
      chainId: 31337,
      lastIndexedBlock: 120,
      chainHead: 121,
      lagBlocks: 1,
    });
  });

  it('follows the checkpoint and the head as they move', async () => {
    await indexedUpTo(120);
    api.chain.head = 122n;
    expect((await health()).body).toMatchObject({
      lastIndexedBlock: 120,
      lagBlocks: 2,
    });

    await api.pool.query('UPDATE indexer_state SET last_block = 125');
    api.chain.head = 130n;
    expect((await health()).body).toMatchObject({
      lastIndexedBlock: 125,
      chainHead: 130,
      lagBlocks: 5,
    });
  });

  it('reports the chain id of the node', async () => {
    await indexedUpTo(10);
    api.chain.head = 11n;
    api.chain.chainId = 1337;

    expect((await health()).body.chainId).toBe(1337);
  });

  it.each([
    [132n, 'ok'],
    [133n, 'degraded'],
  ] as const)(
    'with the indexer at block 120 and the head at %s the status is %s (limit: a lag of 12)',
    async (head, status) => {
      await indexedUpTo(120);
      api.chain.head = head;

      const { body } = await health().expect(200);

      expect(body.status).toBe(status);
      expect(body.lagBlocks).toBe(Number(head) - 120);
    },
  );

  it('reports degraded, with the unknown values as null, when the node is down', async () => {
    await indexedUpTo(120);
    api.chain.down = true;

    const response = await health().expect(200);

    expect(response.body).toEqual({
      status: 'degraded',
      chainId: null,
      lastIndexedBlock: 120,
      chainHead: null,
      lagBlocks: null,
    });
  });

  it('recovers when the node comes back', async () => {
    await indexedUpTo(120);
    api.chain.head = 121n;
    api.chain.down = true;
    expect((await health()).body.status).toBe('degraded');

    api.chain.down = false;
    expect((await health()).body.status).toBe('ok');
  });

  it('shows no indexed block before the first checkpoint, measuring from the deploy block', async () => {
    api.chain.head = 10n;

    const response = await health().expect(200);

    expect(response.body).toEqual({
      status: 'ok',
      chainId: 31337,
      lastIndexedBlock: null,
      chainHead: 10,
      lagBlocks: 10 - (START_BLOCK - 1),
    });
  });

  it('is degraded before the first checkpoint when the chain is far ahead of the deploy', async () => {
    api.chain.head = 200n;

    expect((await health().expect(200)).body.status).toBe('degraded');
  });
});
