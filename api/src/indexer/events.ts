/** Where a log was found. `(blockNumber, logIndex)` is the order events happened onchain. */
interface EventMeta {
  blockNumber: bigint;
  logIndex: number;
  txHash: string;
}

export interface EscrowCreatedEvent extends EventMeta {
  type: 'EscrowCreated';
  id: bigint;
  sender: string;
  beneficiary: string;
  token: string;
  amount: bigint;
  cancelDeadline: bigint;
  expiresAt: bigint;
}

export type TransitionType =
  'EscrowCancelled' | 'EscrowReleased' | 'EscrowRejected' | 'EscrowExpired';

export interface EscrowTransitionEvent extends EventMeta {
  type: TransitionType;
  id: bigint;
}

export type EscrowEvent = EscrowCreatedEvent | EscrowTransitionEvent;
