import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigError } from './config';
import { loadDeployment } from './deployment';

const ADDRESS = '0x5FbDB2315678afecb367f032d93F642f64180aa3';

describe('loadDeployment', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'deployment-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function write(content: string): string {
    const path = join(dir, 'deployment.json');
    writeFileSync(path, content);
    return path;
  }

  it('reads the address and the start block', () => {
    const path = write(JSON.stringify({ address: ADDRESS, startBlock: 7 }));
    expect(loadDeployment(path)).toEqual({
      address: ADDRESS.toLowerCase(),
      startBlock: 7,
    });
  });

  it('lowercases the address', () => {
    const path = write(JSON.stringify({ address: ADDRESS, startBlock: 1 }));
    expect(loadDeployment(path).address).toBe(ADDRESS.toLowerCase());
  });

  it('accepts block zero', () => {
    const path = write(JSON.stringify({ address: ADDRESS, startBlock: 0 }));
    expect(loadDeployment(path).startBlock).toBe(0);
  });

  it('fails with a ConfigError when the file is missing', () => {
    const path = join(dir, 'missing.json');
    expect(() => loadDeployment(path)).toThrow(ConfigError);
    expect(() => loadDeployment(path)).toThrow(
      `Cannot read the deployment file at ${path}`,
    );
  });

  it('fails when the file is not JSON', () => {
    expect(() => loadDeployment(write('0x5fbd...'))).toThrow(
      'is not valid JSON',
    );
  });

  it.each([
    ['a missing address', { startBlock: 1 }],
    ['a short address', { address: '0x1234', startBlock: 1 }],
    ['an address without 0x', { address: ADDRESS.slice(2), startBlock: 1 }],
    ['a non hex address', { address: `0x${'g'.repeat(40)}`, startBlock: 1 }],
  ])('rejects %s', (_label, content) => {
    expect(() => loadDeployment(write(JSON.stringify(content)))).toThrow(
      'address must be a 0x-prefixed 20 byte hex string',
    );
  });

  it.each([
    ['a missing start block', { address: ADDRESS }],
    ['a negative start block', { address: ADDRESS, startBlock: -1 }],
    ['a fractional start block', { address: ADDRESS, startBlock: 1.5 }],
    ['a hex string start block', { address: ADDRESS, startBlock: '0x1' }],
  ])('rejects %s', (_label, content) => {
    expect(() => loadDeployment(write(JSON.stringify(content)))).toThrow(
      'startBlock must be a non-negative integer',
    );
  });

  it('rejects JSON that is not an object', () => {
    expect(() => loadDeployment(write('null'))).toThrow(ConfigError);
    expect(() => loadDeployment(write('[]'))).toThrow(ConfigError);
  });
});
