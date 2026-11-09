import { ConfigError, loadConfig } from './config';

const valid = {
  RPC_URL: 'http://127.0.0.1:8545',
  DATABASE_URL: 'postgres://escrow:secret@localhost:5432/escrow',
  CONFIRMATIONS: '2',
  BATCH_SIZE: '500',
  POLL_INTERVAL_MS: '1000',
};

describe('loadConfig', () => {
  it('parses a valid environment and applies the agreed defaults', () => {
    expect(loadConfig(valid)).toEqual({
      rpcUrl: 'http://127.0.0.1:8545',
      databaseUrl: 'postgres://escrow:secret@localhost:5432/escrow',
      confirmations: 2,
      batchSize: 500,
      pollIntervalMs: 1000,
      // The defaults are written out on purpose: they are the values in SPEC section 4.3 and
      // section 7, so changing the constants in config.ts must fail this test.
      healthMaxExtraLagBlocks: 10,
      deploymentFile: '/shared/deployment.json',
    });
  });

  it('accepts overrides for the optional settings', () => {
    const config = loadConfig({
      ...valid,
      HEALTH_MAX_EXTRA_LAG_BLOCKS: '25',
      DEPLOYMENT_FILE: '/tmp/deployment.json',
    });
    expect(config.healthMaxExtraLagBlocks).toBe(25);
    expect(config.deploymentFile).toBe('/tmp/deployment.json');
  });

  it('accepts zero confirmations and zero extra lag', () => {
    const config = loadConfig({
      ...valid,
      CONFIRMATIONS: '0',
      HEALTH_MAX_EXTRA_LAG_BLOCKS: '0',
    });
    expect(config.confirmations).toBe(0);
    expect(config.healthMaxExtraLagBlocks).toBe(0);
  });

  it('accepts https and postgresql URLs', () => {
    const config = loadConfig({
      ...valid,
      RPC_URL: 'https://rpc.example.org',
      DATABASE_URL: 'postgresql://u:p@db:5432/escrow',
    });
    expect(config.rpcUrl).toBe('https://rpc.example.org');
    expect(config.databaseUrl).toBe('postgresql://u:p@db:5432/escrow');
  });

  it.each([
    'RPC_URL',
    'DATABASE_URL',
    'CONFIRMATIONS',
    'BATCH_SIZE',
    'POLL_INTERVAL_MS',
  ])('requires %s', (name) => {
    const env: Record<string, string | undefined> = { ...valid };
    delete env[name];
    expect(() => loadConfig(env)).toThrow(`${name} is required`);
  });

  it('treats an empty value as missing', () => {
    expect(() => loadConfig({ ...valid, BATCH_SIZE: '  ' })).toThrow(
      'BATCH_SIZE is required',
    );
  });

  it.each(['abc', '1.5', '-1', '1e3', '0x10'])(
    'rejects %p as an integer',
    (value) => {
      expect(() => loadConfig({ ...valid, CONFIRMATIONS: value })).toThrow(
        'CONFIRMATIONS must be an integer >= 0',
      );
    },
  );

  it('rejects a zero batch size and a zero poll interval', () => {
    expect(() => loadConfig({ ...valid, BATCH_SIZE: '0' })).toThrow(
      'BATCH_SIZE must be an integer >= 1',
    );
    expect(() => loadConfig({ ...valid, POLL_INTERVAL_MS: '0' })).toThrow(
      'POLL_INTERVAL_MS must be an integer >= 1',
    );
  });

  it('rejects integers beyond the safe range', () => {
    expect(() =>
      loadConfig({ ...valid, CONFIRMATIONS: '9007199254740993' }),
    ).toThrow('CONFIRMATIONS must be an integer');
  });

  it('rejects URLs that are malformed or use the wrong protocol', () => {
    expect(() => loadConfig({ ...valid, RPC_URL: 'not a url' })).toThrow(
      'RPC_URL must be a valid URL',
    );
    expect(() =>
      loadConfig({ ...valid, RPC_URL: 'ws://127.0.0.1:8546' }),
    ).toThrow('RPC_URL must use http or https');
    expect(() =>
      loadConfig({ ...valid, DATABASE_URL: 'http://localhost/escrow' }),
    ).toThrow('DATABASE_URL must use postgres or postgresql');
  });

  it('reports every problem at once with a ConfigError', () => {
    let error: unknown;
    try {
      loadConfig({});
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ConfigError);
    const message = (error as ConfigError).message;
    for (const name of [
      'RPC_URL',
      'DATABASE_URL',
      'CONFIRMATIONS',
      'BATCH_SIZE',
      'POLL_INTERVAL_MS',
    ]) {
      expect(message).toContain(`${name} is required`);
    }
  });

  it('never echoes the database URL or its password in an error', () => {
    let message = '';
    try {
      loadConfig({
        ...valid,
        DATABASE_URL: 'mysql://escrow:topsecret@localhost/escrow',
      });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('DATABASE_URL must use');
    expect(message).not.toContain('topsecret');
  });
});
