import { buildHealth, HealthInput } from './health';

const base: HealthInput = {
  checkpoint: 120n,
  startBlock: 3n,
  node: { head: 121n, chainId: 31337 },
  confirmations: 2,
  maxExtraLagBlocks: 10,
};

describe('buildHealth', () => {
  it('reports the example of the spec', () => {
    expect(buildHealth(base)).toEqual({
      status: 'ok',
      chainId: 31337,
      lastIndexedBlock: 120,
      chainHead: 121,
      lagBlocks: 1,
    });
  });

  describe('the degraded threshold, confirmations + extra lag (2 + 10)', () => {
    it.each([
      [0n, 'ok'],
      [11n, 'ok'],
      [12n, 'ok'],
      [13n, 'degraded'],
      [100n, 'degraded'],
    ] as const)('with a lag of %s blocks it is %s', (lag, status) => {
      expect(
        buildHealth({ ...base, node: { head: 120n + lag, chainId: 1 } }),
      ).toMatchObject({ status, lagBlocks: Number(lag) });
    });

    it('follows a custom extra lag', () => {
      const strict = { ...base, maxExtraLagBlocks: 0 };

      expect(
        buildHealth({ ...strict, node: { head: 122n, chainId: 1 } }).status,
      ).toBe('ok');
      expect(
        buildHealth({ ...strict, node: { head: 123n, chainId: 1 } }).status,
      ).toBe('degraded');
    });
  });

  describe('when the node is unreachable', () => {
    it('is degraded and reports what it cannot know as null', () => {
      expect(buildHealth({ ...base, node: null })).toEqual({
        status: 'degraded',
        chainId: null,
        lastIndexedBlock: 120,
        chainHead: null,
        lagBlocks: null,
      });
    });

    it('keeps lastIndexedBlock null before the first checkpoint', () => {
      expect(
        buildHealth({ ...base, checkpoint: null, node: null }),
      ).toMatchObject({ status: 'degraded', lastIndexedBlock: null });
    });
  });

  describe('before the first checkpoint', () => {
    const fresh = { ...base, checkpoint: null, startBlock: 3n };

    it('shows no indexed block and counts the lag from the block before the deploy', () => {
      expect(
        buildHealth({ ...fresh, node: { head: 10n, chainId: 1 } }),
      ).toEqual({
        status: 'ok',
        chainId: 1,
        lastIndexedBlock: null,
        chainHead: 10,
        lagBlocks: 8,
      });
    });

    it('is degraded when the chain is far ahead of the deploy', () => {
      expect(
        buildHealth({ ...fresh, node: { head: 100n, chainId: 1 } }),
      ).toMatchObject({ status: 'degraded', lagBlocks: 98 });
    });

    it('works for a contract deployed at genesis', () => {
      expect(
        buildHealth({
          ...fresh,
          startBlock: 0n,
          node: { head: 5n, chainId: 1 },
        }),
      ).toMatchObject({ status: 'ok', lagBlocks: 6 });
    });
  });

  it('shows a negative lag as it is when the head is behind the checkpoint', () => {
    expect(
      buildHealth({ ...base, node: { head: 100n, chainId: 1 } }),
    ).toMatchObject({ status: 'ok', lagBlocks: -20 });
  });
});
