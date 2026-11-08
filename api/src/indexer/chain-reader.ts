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
 * The viem implementation is tested in `chain-reader.spec.ts` against a minimal JSON-RPC server,
 * which checks the requests it sends and how it reads the answers. It runs against a real Anvil
 * in the end to end script (T-09), and `decode.spec.ts` pins the event ABI it relies on.
 *
 * The API also reads the latest block (for `now`, SPEC 4.1) and the chain id (for `/health`)
 * through this interface.
 */
export interface ChainReader {
  getBlockNumber(): Promise<bigint>;
  getChainId(): Promise<number>;
  /**
   * Latest block of the node, confirmed or not. Its timestamp is `now` for the derived fields
   * (SPEC 4.1), so it follows Anvil's clock when a script moves time forward.
   */
  getLatestBlock(): Promise<{ number: bigint; timestamp: bigint }>;
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
    getChainId: () => client.getChainId(),
    getLatestBlock: async () => {
      const { number, timestamp } = await client.getBlock();
      return { number, timestamp };
    },
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
