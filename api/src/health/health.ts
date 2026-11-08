/** The body of `GET /health` (SPEC 4.3). */
export interface HealthBody {
  status: 'ok' | 'degraded';
  chainId: number | null;
  lastIndexedBlock: number | null;
  chainHead: number | null;
  lagBlocks: number | null;
}

export interface HealthInput {
  /** Last block the indexer finished, or null before its first range. */
  checkpoint: bigint | null;
  /** Deploy block of the contract, where indexing starts. */
  startBlock: bigint;
  /** What the node reported, or null when it could not be reached. */
  node: { head: bigint; chainId: number } | null;
  confirmations: number;
  maxExtraLagBlocks: number;
}

/**
 * Decides the health report (SPEC 4.3):
 *
 * - `lagBlocks` is the chain head minus the last indexed block. Before the first checkpoint the
 *   last indexed block counts as `startBlock - 1`, so a fresh start is measured from the deploy.
 * - The status is `degraded` when the node is unreachable, or when the lag is larger than
 *   `confirmations + maxExtraLagBlocks`. The indexer always trails the head by the confirmations,
 *   so only the extra part signals a problem.
 */
export function buildHealth(input: HealthInput): HealthBody {
  const lastIndexedBlock =
    input.checkpoint === null ? null : Number(input.checkpoint);

  if (input.node === null) {
    return {
      status: 'degraded',
      chainId: null,
      lastIndexedBlock,
      chainHead: null,
      lagBlocks: null,
    };
  }

  const indexed = input.checkpoint ?? input.startBlock - 1n;
  const lag = input.node.head - indexed;
  const allowed = BigInt(input.confirmations + input.maxExtraLagBlocks);

  return {
    status: lag > allowed ? 'degraded' : 'ok',
    chainId: input.node.chainId,
    lastIndexedBlock,
    chainHead: Number(input.node.head),
    lagBlocks: Number(lag),
  };
}
