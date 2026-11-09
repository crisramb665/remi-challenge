import request from 'supertest';
import { ApiApp, START_BLOCK, startApi } from './support/api-app';
import { describeWithDb } from './support/isolated-schema';

// The status rules (thresholds, nulls, negative lag) are tested in src/health/health.spec.ts.
// These tests only prove the endpoint reads the database and the node and returns that report.
describeWithDb('GET /health', () => {
  let api: ApiApp;

  beforeAll(async () => {
    api = await startApi();
  });

  afterAll(async () => {
    await api.stop();
  });

  beforeEach(async () => {
    await api.reset();
  });

  const health = () => request(api.app.getHttpServer()).get('/health');

  it('reports ok with the lag of the indexer', async () => {
    await api.pool.query(
      'INSERT INTO indexer_state (id, last_block) VALUES (1, 120)',
    );
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

  it('reports degraded, with the unknown values as null, when the node is down', async () => {
    await api.pool.query(
      'INSERT INTO indexer_state (id, last_block) VALUES (1, 120)',
    );
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
});
