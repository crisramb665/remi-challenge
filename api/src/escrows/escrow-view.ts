/** Statuses stored in the database, named like the contract's `Status` enum (SPEC 2.2). */
export const STORED_STATUSES = [
  'Pending',
  'Released',
  'Rejected',
  'CancelledBySender',
  'Expired',
] as const;

export type StoredStatus = (typeof STORED_STATUSES)[number];

/** What the API shows: the stored status, or `PendingExpired` for a Pending escrow past its TTL. */
export type EffectiveStatus = StoredStatus | 'PendingExpired';

/** A row of the `escrows` table as `pg` returns it: bigint and numeric columns arrive as strings. */
export interface EscrowRow {
  id: string;
  sender: string;
  beneficiary: string;
  token: string;
  amount: string;
  cancel_deadline: string;
  expires_at: string;
  status: string;
  created_tx: string;
  resolved_tx: string | null;
}

/** The body of `GET /escrows/:id` (SPEC 4.3). Amounts are strings because uint256 exceeds a JS number. */
export interface EscrowView {
  id: string;
  sender: string;
  beneficiary: string;
  token: string;
  amount: string;
  cancelDeadline: number;
  expiresAt: number;
  status: StoredStatus;
  effectiveStatus: EffectiveStatus;
  canCancel: boolean;
  canConfirm: boolean;
  canReject: boolean;
  canReclaim: boolean;
  transactions: { created: string; resolved: string | null };
}

function isStoredStatus(value: string): value is StoredStatus {
  return (STORED_STATUSES as readonly string[]).includes(value);
}

/**
 * Builds the API object for a stored escrow at time `now`, the timestamp of the latest block
 * (SPEC 4.1). With D the cancel deadline and E the expiry (SPEC 4.2):
 *
 * - canCancel: Pending and now < D
 * - canConfirm and canReject: Pending and now < E
 * - canReclaim: Pending and now >= E
 * - effectiveStatus is PendingExpired for a Pending escrow with now >= E
 */
export function toEscrowView(row: EscrowRow, now: bigint): EscrowView {
  if (!isStoredStatus(row.status)) {
    throw new Error(`Escrow ${row.id} has an unknown status: ${row.status}`);
  }

  const cancelDeadline = BigInt(row.cancel_deadline);
  const expiresAt = BigInt(row.expires_at);
  const pending = row.status === 'Pending';
  const expired = pending && now >= expiresAt;

  return {
    id: row.id,
    sender: row.sender,
    beneficiary: row.beneficiary,
    token: row.token,
    amount: row.amount,
    cancelDeadline: Number(cancelDeadline),
    expiresAt: Number(expiresAt),
    status: row.status,
    effectiveStatus: expired ? 'PendingExpired' : row.status,
    canCancel: pending && now < cancelDeadline,
    canConfirm: pending && now < expiresAt,
    canReject: pending && now < expiresAt,
    canReclaim: expired,
    transactions: { created: row.created_tx, resolved: row.resolved_tx },
  };
}
