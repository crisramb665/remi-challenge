import { Pool, PoolClient } from 'pg';
import {
  EscrowCreatedEvent,
  EscrowEvent,
  EscrowTransitionEvent,
  TransitionType,
} from './events';
import { BlockRange } from './range';

/** Status written to the database for each transition event (the contract's `Status` names). */
const FINAL_STATUS: Record<TransitionType, string> = {
  EscrowCancelled: 'CancelledBySender',
  EscrowReleased: 'Released',
  EscrowRejected: 'Rejected',
  EscrowExpired: 'Expired',
};

/** Last block fully indexed, or null before the first range has been applied. */
export async function readCheckpoint(pool: Pool): Promise<bigint | null> {
  const { rows } = await pool.query<{ last_block: string }>(
    'SELECT last_block FROM indexer_state WHERE id = 1',
  );
  return rows.length === 0 ? null : BigInt(rows[0].last_block);
}

/**
 * Applies the events of one block range and moves the checkpoint to the end of the range, all in
 * one database transaction (SPEC section 3.2). If anything fails nothing is written, so the range
 * is processed again. Replaying a range is safe because of the guards in each statement.
 */
export async function applyRange(
  pool: Pool,
  range: BlockRange,
  events: EscrowEvent[],
): Promise<void> {
  const ordered = [...events].sort(compareByPosition);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    for (const event of ordered) {
      if (event.type === 'EscrowCreated') await insertEscrow(client, event);
      else await resolveEscrow(client, event);
    }
    await writeCheckpoint(client, range.to);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function compareByPosition(a: EscrowEvent, b: EscrowEvent): number {
  if (a.blockNumber !== b.blockNumber) {
    return a.blockNumber < b.blockNumber ? -1 : 1;
  }
  return a.logIndex - b.logIndex;
}

async function insertEscrow(
  client: PoolClient,
  event: EscrowCreatedEvent,
): Promise<void> {
  await client.query(
    `INSERT INTO escrows
       (id, sender, beneficiary, token, amount, cancel_deadline, expires_at,
        status, created_tx, created_block)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'Pending', $8, $9)
     ON CONFLICT (id) DO NOTHING`,
    [
      event.id.toString(),
      event.sender.toLowerCase(),
      event.beneficiary.toLowerCase(),
      event.token.toLowerCase(),
      event.amount.toString(),
      event.cancelDeadline.toString(),
      event.expiresAt.toString(),
      event.txHash,
      event.blockNumber.toString(),
    ],
  );
}

async function resolveEscrow(
  client: PoolClient,
  event: EscrowTransitionEvent,
): Promise<void> {
  await client.query(
    `UPDATE escrows
        SET status = $2, resolved_tx = $3, resolved_block = $4, updated_at = now()
      WHERE id = $1 AND status = 'Pending'`,
    [
      event.id.toString(),
      FINAL_STATUS[event.type],
      event.txHash,
      event.blockNumber.toString(),
    ],
  );
}

async function writeCheckpoint(
  client: PoolClient,
  lastBlock: bigint,
): Promise<void> {
  await client.query(
    `INSERT INTO indexer_state (id, last_block, updated_at)
     VALUES (1, $1, now())
     ON CONFLICT (id) DO UPDATE SET last_block = EXCLUDED.last_block, updated_at = now()`,
    [lastBlock.toString()],
  );
}
