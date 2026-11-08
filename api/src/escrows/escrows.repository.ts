import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';
import { EffectiveStatus, EscrowRow } from './escrow-view';

const COLUMNS = `id, sender, beneficiary, token, amount, cancel_deadline, expires_at,
  status, created_tx, resolved_tx`;

export interface ListParams {
  /** Lowercase address. */
  sender?: string;
  /** Lowercase address. */
  beneficiary?: string;
  /** Applies to the effective status, so `Pending` leaves out escrows that are `PendingExpired`. */
  status?: EffectiveStatus;
  limit: number;
  /** Only escrows with a smaller id are returned. */
  cursor?: string;
  /** Timestamp of the latest block, which decides what is expired. */
  now: bigint;
}

export interface EscrowPage {
  rows: EscrowRow[];
  /** Id of the last row when more escrows follow, otherwise null. */
  nextCursor: string | null;
}

/** Read side of the `escrows` projection. The indexer is the only writer. */
@Injectable()
export class EscrowsRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async findById(id: string): Promise<EscrowRow | null> {
    const { rows } = await this.pool.query<EscrowRow>(
      `SELECT ${COLUMNS} FROM escrows WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }

  async list(params: ListParams): Promise<EscrowPage> {
    const conditions: string[] = [];
    const values: string[] = [];
    const bind = (value: string) => {
      values.push(value);
      return `$${values.length}`;
    };

    if (params.sender !== undefined) {
      conditions.push(`sender = ${bind(params.sender)}`);
    }
    if (params.beneficiary !== undefined) {
      conditions.push(`beneficiary = ${bind(params.beneficiary)}`);
    }
    if (params.status !== undefined) {
      conditions.push(statusCondition(params.status, bind, params.now));
    }
    if (params.cursor !== undefined) {
      conditions.push(`id < ${bind(params.cursor)}`);
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    // One row more than asked for tells whether another page exists.
    const limit = bind((params.limit + 1).toString());
    const { rows } = await this.pool.query<EscrowRow>(
      `SELECT ${COLUMNS} FROM escrows ${where} ORDER BY id DESC LIMIT ${limit}`,
      values,
    );

    const hasMore = rows.length > params.limit;
    const page = hasMore ? rows.slice(0, params.limit) : rows;
    return {
      rows: page,
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }
}

function statusCondition(
  status: EffectiveStatus,
  bind: (value: string) => string,
  now: bigint,
): string {
  switch (status) {
    case 'Pending':
      return `(status = 'Pending' AND expires_at > ${bind(now.toString())})`;
    case 'PendingExpired':
      return `(status = 'Pending' AND expires_at <= ${bind(now.toString())})`;
    default:
      return `status = ${bind(status)}`;
  }
}
