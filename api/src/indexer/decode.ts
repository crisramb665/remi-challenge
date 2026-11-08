import { EscrowEvent } from './events';

/** The part of a decoded viem log that the indexer needs. */
export interface DecodedLog {
  eventName: string;
  args: Record<string, unknown>;
  blockNumber: bigint | null;
  logIndex: number | null;
  transactionHash: string | null;
}

/** Turns decoded logs into the indexer's events, keeping the order they came in. */
export function toEscrowEvents(logs: readonly DecodedLog[]): EscrowEvent[] {
  return logs.map(toEscrowEvent);
}

function toEscrowEvent(log: DecodedLog): EscrowEvent {
  // Only pending logs lack a position, and the indexer reads confirmed blocks only.
  if (
    log.blockNumber === null ||
    log.logIndex === null ||
    log.transactionHash === null
  ) {
    throw new Error(`Log of ${log.eventName} has no block position`);
  }
  const meta = {
    blockNumber: log.blockNumber,
    logIndex: log.logIndex,
    txHash: log.transactionHash,
  };

  switch (log.eventName) {
    case 'EscrowCreated':
      return {
        type: log.eventName,
        ...meta,
        id: bigintArg(log, 'id'),
        sender: stringArg(log, 'sender'),
        beneficiary: stringArg(log, 'beneficiary'),
        token: stringArg(log, 'token'),
        amount: bigintArg(log, 'amount'),
        cancelDeadline: bigintArg(log, 'cancelDeadline'),
        expiresAt: bigintArg(log, 'expiresAt'),
      };
    case 'EscrowCancelled':
    case 'EscrowReleased':
    case 'EscrowRejected':
    case 'EscrowExpired':
      return { type: log.eventName, ...meta, id: bigintArg(log, 'id') };
    default:
      throw new Error(`Unexpected event ${log.eventName}`);
  }
}

function bigintArg(log: DecodedLog, name: string): bigint {
  const value = log.args[name];
  if (typeof value !== 'bigint') {
    throw new Error(`${log.eventName}.${name} is not a bigint`);
  }
  return value;
}

function stringArg(log: DecodedLog, name: string): string {
  const value = log.args[name];
  if (typeof value !== 'string') {
    throw new Error(`${log.eventName}.${name} is not a string`);
  }
  return value;
}
