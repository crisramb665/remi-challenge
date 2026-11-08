import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { toEventSelector } from 'viem';
import { createViemChainReader } from './chain-reader';
import { escrowEvents } from './escrow.abi';

const CONTRACT = '0xe7f1725e7734ce288f8367e1bb143e90bb3f0512';
const TX = `0x${'ab'.repeat(32)}`;
const BLOCK_HASH = `0x${'cd'.repeat(32)}`;

type Handler = (params: unknown[]) => unknown;

interface RpcCall {
  method: string;
  params: unknown[];
}

/** A JSON-RPC endpoint in memory that records what viem asks and answers from `handlers`. */
async function startRpc(handlers: Record<string, Handler>) {
  const calls: RpcCall[] = [];
  const server: Server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk: Buffer) => (body += chunk.toString()));
    request.on('end', () => {
      const { id, method, params } = JSON.parse(body) as {
        id: number;
        method: string;
        params: unknown[];
      };
      calls.push({ method, params });
      const handler = handlers[method];
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify(
          handler
            ? { jsonrpc: '2.0', id, result: handler(params) }
            : { jsonrpc: '2.0', id, error: { code: -32601, message: method } },
        ),
      );
    });
  });
  await new Promise<void>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve()),
  );
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

describe('createViemChainReader', () => {
  let rpc: Awaited<ReturnType<typeof startRpc>> | null = null;

  afterEach(async () => {
    await rpc?.close();
    rpc = null;
  });

  it('reads the block number', async () => {
    rpc = await startRpc({ eth_blockNumber: () => '0x2a' });

    const reader = createViemChainReader(rpc.url, CONTRACT);

    expect(await reader.getBlockNumber()).toBe(42n);
  });

  it('reads the chain id', async () => {
    rpc = await startRpc({ eth_chainId: () => '0x7a69' });

    const reader = createViemChainReader(rpc.url, CONTRACT);

    expect(await reader.getChainId()).toBe(31337);
  });

  it('reads the number and timestamp of the latest block', async () => {
    rpc = await startRpc({
      eth_getBlockByNumber: () => ({
        number: '0x10',
        hash: BLOCK_HASH,
        parentHash: BLOCK_HASH,
        timestamp: '0x6553f100',
        transactions: [],
        gasLimit: '0x1c9c380',
        gasUsed: '0x0',
        miner: CONTRACT,
        nonce: '0x0000000000000000',
        difficulty: '0x0',
        totalDifficulty: '0x0',
        extraData: '0x',
        logsBloom: `0x${'00'.repeat(256)}`,
        sha3Uncles: BLOCK_HASH,
        size: '0x200',
        stateRoot: BLOCK_HASH,
        receiptsRoot: BLOCK_HASH,
        transactionsRoot: BLOCK_HASH,
        mixHash: BLOCK_HASH,
        uncles: [],
      }),
    });

    const reader = createViemChainReader(rpc.url, CONTRACT);

    expect(await reader.getLatestBlock()).toEqual({
      number: 16n,
      timestamp: 0x6553f100n,
    });
    expect(rpc.calls[0].params[0]).toBe('latest');
  });

  it('asks only for the contract and the five escrow events, in the given range', async () => {
    rpc = await startRpc({ eth_getLogs: () => [] });

    const reader = createViemChainReader(rpc.url, CONTRACT);
    await reader.getLogs({ from: 5n, to: 18n });

    expect(rpc.calls).toHaveLength(1);
    const filter = rpc.calls[0].params[0] as {
      address: string;
      fromBlock: string;
      toBlock: string;
      topics: string[][];
    };
    expect(filter.address.toLowerCase()).toBe(CONTRACT);
    expect(filter.fromBlock).toBe('0x5');
    expect(filter.toBlock).toBe('0x12');
    // One position holding every event hash, so a log matches if it is any of the five.
    expect(filter.topics).toEqual([escrowEvents.map(toEventSelector)]);
  });

  it('decodes the logs the node returns', async () => {
    const released = escrowEvents.find(
      (event) => event.name === 'EscrowReleased',
    )!;
    rpc = await startRpc({
      eth_getLogs: () => [
        {
          address: CONTRACT,
          topics: [toEventSelector(released), `0x${'0'.repeat(63)}9`],
          data: '0x',
          blockNumber: '0xc',
          blockHash: BLOCK_HASH,
          transactionHash: TX,
          transactionIndex: '0x0',
          logIndex: '0x3',
          removed: false,
        },
      ],
    });

    const reader = createViemChainReader(rpc.url, CONTRACT);
    const logs = await reader.getLogs({ from: 1n, to: 20n });

    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      eventName: 'EscrowReleased',
      args: { id: 9n },
      blockNumber: 12n,
      logIndex: 3,
      transactionHash: TX,
    });
  });

  it('fails when the node is unreachable', async () => {
    rpc = await startRpc({});
    const reader = createViemChainReader(rpc.url, CONTRACT);
    await rpc.close();

    await expect(reader.getBlockNumber()).rejects.toThrow();
  }, 15_000);
});
