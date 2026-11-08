export interface BlockRange {
  from: bigint;
  to: bigint;
}

export interface RangeInput {
  /** Latest block number reported by the node. */
  head: bigint;
  confirmations: number;
  batchSize: number;
  /** Last block already indexed, or null on the first run. */
  lastProcessedBlock: bigint | null;
  /** Block where the contract was deployed. */
  startBlock: bigint;
}

/**
 * Next range of blocks to index (SPEC section 3.1), or null when there is nothing to do yet.
 *
 * Only blocks with `confirmations` confirmations are indexed, and a range never holds more than
 * `batchSize` blocks. On the first run the range starts at the deploy block.
 */
export function computeRange(input: RangeInput): BlockRange | null {
  const safeHead = input.head - BigInt(input.confirmations);
  const from =
    input.lastProcessedBlock === null
      ? input.startBlock
      : input.lastProcessedBlock + 1n;
  const batchEnd = from + BigInt(input.batchSize) - 1n;
  const to = batchEnd < safeHead ? batchEnd : safeHead;

  return from > to ? null : { from, to };
}
