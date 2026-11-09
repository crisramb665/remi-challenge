import { computeRange, RangeInput } from './range';

const base: RangeInput = {
  head: 100n,
  confirmations: 2,
  batchSize: 500,
  lastProcessedBlock: 50n,
  startBlock: 10n,
};

describe('computeRange', () => {
  it('starts one block after the last processed block', () => {
    expect(computeRange({ ...base, lastProcessedBlock: 50n })).toEqual({
      from: 51n,
      to: 98n,
    });
  });

  it('starts at the deploy block on the first run', () => {
    expect(computeRange({ ...base, lastProcessedBlock: null })).toEqual({
      from: 10n,
      to: 98n,
    });
  });

  it('stops at the safe head, which is the head minus the confirmations', () => {
    expect(computeRange({ ...base, head: 60n, confirmations: 5 })).toEqual({
      from: 51n,
      to: 55n,
    });
  });

  it('clamps the range to the batch size', () => {
    expect(computeRange({ ...base, batchSize: 10 })).toEqual({
      from: 51n,
      to: 60n,
    });
  });

  it('returns a single block when it is the only one confirmed', () => {
    expect(computeRange({ ...base, head: 53n })).toEqual({
      from: 51n,
      to: 51n,
    });
  });

  it('returns null when the next block is not confirmed yet', () => {
    expect(computeRange({ ...base, head: 52n })).toBeNull();
  });

  it('returns null when the indexer is already at the head', () => {
    expect(
      computeRange({ ...base, head: 52n, lastProcessedBlock: 50n }),
    ).toBeNull();
    expect(
      computeRange({ ...base, head: 100n, lastProcessedBlock: 98n }),
    ).toBeNull();
  });

  it('returns null when the chain is shorter than the confirmations', () => {
    expect(
      computeRange({
        ...base,
        head: 1n,
        confirmations: 5,
        lastProcessedBlock: null,
        startBlock: 0n,
      }),
    ).toBeNull();
  });

  it('indexes the head itself when there are no confirmations', () => {
    expect(computeRange({ ...base, confirmations: 0, head: 51n })).toEqual({
      from: 51n,
      to: 51n,
    });
  });

  it('covers block 0 on the first run of a chain deployed at genesis', () => {
    expect(
      computeRange({
        ...base,
        head: 3n,
        confirmations: 0,
        lastProcessedBlock: null,
        startBlock: 0n,
      }),
    ).toEqual({ from: 0n, to: 3n });
  });

  it('does not overlap consecutive ranges', () => {
    const first = computeRange({ ...base, batchSize: 10 });
    const second = computeRange({
      ...base,
      batchSize: 10,
      lastProcessedBlock: first!.to,
    });

    expect(second!.from).toBe(first!.to + 1n);
  });
});
