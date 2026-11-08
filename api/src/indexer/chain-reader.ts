import { Address, createPublicClient, http } from 'viem';
import { DecodedLog } from './decode';
import { escrowEvents } from './escrow.abi';
import { BlockRange } from './range';

export const CHAIN_READER = Symbol('CHAIN_READER');

/** What the indexer needs from the node. Tests replace it with an in-memory chain. */
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
