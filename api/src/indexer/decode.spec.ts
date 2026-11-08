import {
  encodeAbiParameters,
  encodeEventTopics,
  parseAbiParameters,
  parseEventLogs,
  toEventSelector,
} from 'viem';
import { DecodedLog, toEscrowEvents } from './decode';
import { escrowEvents } from './escrow.abi';

const SENDER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const BENEFICIARY = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const TOKEN = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const CONTRACT = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512';
const TX = `0x${'ab'.repeat(32)}` as const;
const BLOCK_HASH = `0x${'cd'.repeat(32)}` as const;

function rawLog(
  topics: readonly (`0x${string}` | `0x${string}`[] | null)[],
  data: `0x${string}` = '0x',
) {
  const logTopics = topics.map((topic) => {
    if (typeof topic !== 'string') throw new Error('Expected a single topic');
    return topic;
  });
  return {
    address: CONTRACT,
    topics: logTopics,
    data,
    blockNumber: 12n,
    logIndex: 3,
    transactionHash: TX,
    transactionIndex: 0,
    blockHash: BLOCK_HASH,
    removed: false,
  } as never;
}

function decodedLog(
  eventName: string,
  args: Record<string, unknown>,
  overrides: Partial<DecodedLog> = {},
): DecodedLog {
  return {
    eventName,
    args,
    blockNumber: 12n,
    logIndex: 3,
    transactionHash: TX,
    ...overrides,
  };
}

describe('escrowEvents ABI', () => {
  // Hashes of the signatures in contracts/src/EscrowManager.sol, computed with `cast keccak`.
  // A wrong type here (for example uint256 instead of uint64) would make getLogs match nothing.
  it('has the same event signatures as the contract', () => {
    const selectors = Object.fromEntries(
      escrowEvents.map((event) => [event.name, toEventSelector(event)]),
    );

    expect(selectors).toEqual({
      EscrowCreated:
        '0x33b1e44a50f56e1a3d182304a3763b87bfedd444f1ec2d5451235926fa0ebe70',
      EscrowCancelled:
        '0x0d977c6b1a383ac5ce532b4a668d0ef9ad38478e1a5ff28abb221f4b682b2643',
      EscrowReleased:
        '0x69833829d5691ae09424af7d16f73adf033451149ea9c2fc6fcb4c44108eef67',
      EscrowRejected:
        '0x553761f03d0f31b0f2921be0776c815cc8879c29c990736e529634a2c26add88',
      EscrowExpired:
        '0xd5cd72c28e94c6cff9e62a102ab911b3f19f124e11084cb9d830789bc180723f',
    });
  });
});

describe('toEscrowEvents with logs decoded by viem', () => {
  it('maps an EscrowCreated log', () => {
    const topics = encodeEventTopics({
      abi: escrowEvents,
      eventName: 'EscrowCreated',
      args: { id: 7n, sender: SENDER, beneficiary: BENEFICIARY },
    });
    const data = encodeAbiParameters(
      parseAbiParameters(
        'address token, uint256 amount, uint64 cancelDeadline, uint64 expiresAt',
      ),
      [TOKEN, 2n ** 256n - 1n, 1_700_007_200n, 1_700_604_800n],
    );

    const logs = parseEventLogs({
      abi: escrowEvents,
      logs: [rawLog(topics, data)],
    });

    expect(toEscrowEvents(logs)).toEqual([
      {
        type: 'EscrowCreated',
        id: 7n,
        sender: SENDER,
        beneficiary: BENEFICIARY,
        token: TOKEN,
        amount: 2n ** 256n - 1n,
        cancelDeadline: 1_700_007_200n,
        expiresAt: 1_700_604_800n,
        blockNumber: 12n,
        logIndex: 3,
        txHash: TX,
      },
    ]);
  });

  it.each([
    'EscrowCancelled',
    'EscrowReleased',
    'EscrowRejected',
    'EscrowExpired',
  ] as const)('maps an %s log', (eventName) => {
    const topics = encodeEventTopics({
      abi: escrowEvents,
      eventName,
      args: { id: 9n },
    });

    const logs = parseEventLogs({ abi: escrowEvents, logs: [rawLog(topics)] });

    expect(toEscrowEvents(logs)).toEqual([
      {
        type: eventName,
        id: 9n,
        blockNumber: 12n,
        logIndex: 3,
        txHash: TX,
      },
    ]);
  });
});

describe('toEscrowEvents with hand-made logs', () => {
  it('keeps the order of the logs it receives', () => {
    const events = toEscrowEvents([
      decodedLog('EscrowReleased', { id: 2n }, { logIndex: 5 }),
      decodedLog('EscrowCancelled', { id: 1n }, { logIndex: 1 }),
    ]);

    expect(events.map((event) => event.id)).toEqual([2n, 1n]);
  });

  it('returns an empty list when there are no logs', () => {
    expect(toEscrowEvents([])).toEqual([]);
  });

  it('rejects a log without a block position', () => {
    expect(() =>
      toEscrowEvents([
        decodedLog('EscrowReleased', { id: 1n }, { blockNumber: null }),
      ]),
    ).toThrow('no block position');
    expect(() =>
      toEscrowEvents([
        decodedLog('EscrowReleased', { id: 1n }, { logIndex: null }),
      ]),
    ).toThrow('no block position');
    expect(() =>
      toEscrowEvents([
        decodedLog('EscrowReleased', { id: 1n }, { transactionHash: null }),
      ]),
    ).toThrow('no block position');
  });

  it('rejects an event it does not know', () => {
    expect(() => toEscrowEvents([decodedLog('Transfer', {})])).toThrow(
      'Unexpected event Transfer',
    );
  });

  it('rejects an argument of the wrong type', () => {
    expect(() =>
      toEscrowEvents([decodedLog('EscrowReleased', { id: '1' })]),
    ).toThrow('EscrowReleased.id is not a bigint');
    expect(() =>
      toEscrowEvents([
        decodedLog('EscrowCreated', {
          id: 1n,
          sender: 5,
          beneficiary: BENEFICIARY,
          token: TOKEN,
          amount: 1n,
          cancelDeadline: 1n,
          expiresAt: 2n,
        }),
      ]),
    ).toThrow('EscrowCreated.sender is not a string');
  });
});
