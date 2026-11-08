import { Address, createPublicClient, http } from 'viem';
import { DecodedLog } from './decode';
import { escrowEvents } from './escrow.abi';
import { BlockRange } from './range';

export const CHAIN_READER = Symbol('CHAIN_READER');

/**
 * What the indexer needs from the node: the latest block number and the escrow logs of a range.
 *
 * Why an interface and not `viem` directly:
 * - The indexer loop (range, retries, shutdown) can be tested with an in-memory chain, without
 *   Anvil. `indexer.service.spec.ts` uses a fake that moves the head, adds logs and fails on demand.
 * - Everything that talks to the node sits in this one file. The rest of the indexer only sees
 *   `bigint` block numbers and `DecodedLog`s, so it does not depend on viem's types.
 * - It is not an extension point for other chains or contracts; there is one implementation.
 *
 * The viem implementation is not covered by unit tests. It is exercised against a real Anvil in
 * the end to end script (T-09), and `decode.spec.ts` pins the event ABI it relies on.
 *
 * The API will also need the timestamp of the latest block (SPEC 4.1), which would be added here.
 */
export interface ChainReader {
  getBlockNumber(): Promise<bigint>;
  /** Escrow logs of the contract in the range, decoded, in the order the node returns them. */
  getLogs(range: BlockRange): Promise<DecodedLog[]>;
}

export function createViemChainReader(
  rpcUrl: string,
  contract: Address,
): ChainReader {
  const client = createPublicClient({ transport: http(rpcUrl) });

  return {
    getBlockNumber: () => client.getBlockNumber(),
    getLogs: ({ from, to }) =>
      client.getLogs({
        address: contract,
        events: escrowEvents,
        fromBlock: from,
        toBlock: to,
        strict: true,
      }),
  };
}
