import { BadRequestException } from '@nestjs/common';
import { EffectiveStatus, STORED_STATUSES } from './escrow-view';

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

const UINT256_MAX = 2n ** 256n - 1n;
const STATUS_FILTERS: readonly string[] = [
  ...STORED_STATUSES,
  'PendingExpired',
];

/** Validated filters of `GET /escrows` (SPEC 4.3). Addresses are lowercase, like in the database. */
export interface ListQuery {
  sender?: string;
  beneficiary?: string;
  status?: EffectiveStatus;
  limit: number;
  cursor?: string;
}

/**
 * Escrow ids are positive integers (the contract starts at 1) that fit a uint256. They are kept as
 * decimal strings, because the id column is `numeric` and the API shows ids as strings.
 */
export function parseEscrowId(raw: string): string {
  return parseDecimalId(raw, 'Invalid escrow id');
}

/** The cursor is the id of the last escrow of the previous page. */
export function parseCursor(raw: string): string {
  return parseDecimalId(raw, 'Invalid cursor');
}

export function parseAddress(raw: string, name: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(raw)) {
    throw new BadRequestException(`Invalid ${name} address`);
  }
  return raw.toLowerCase();
}

export function parseStatus(raw: string): EffectiveStatus {
  if (!STATUS_FILTERS.includes(raw)) {
    throw new BadRequestException(
      `Invalid status, expected one of: ${STATUS_FILTERS.join(', ')}`,
    );
  }
  return raw as EffectiveStatus;
}

export function parseLimit(raw: string): number {
  const limit = /^[0-9]{1,4}$/.test(raw) ? Number(raw) : NaN;
  if (!(limit >= 1 && limit <= MAX_LIMIT)) {
    throw new BadRequestException(
      `Invalid limit, expected an integer from 1 to ${MAX_LIMIT}`,
    );
  }
  return limit;
}

/**
 * Validates the query string of `GET /escrows`. Absent parameters are skipped; a parameter that is
 * present but empty, repeated or malformed is a 400. Unknown parameters are ignored.
 */
export function parseListQuery(query: Record<string, unknown>): ListQuery {
  const result: ListQuery = { limit: DEFAULT_LIMIT };

  const sender = single(query, 'sender');
  if (sender !== undefined) result.sender = parseAddress(sender, 'sender');

  const beneficiary = single(query, 'beneficiary');
  if (beneficiary !== undefined) {
    result.beneficiary = parseAddress(beneficiary, 'beneficiary');
  }

  const status = single(query, 'status');
  if (status !== undefined) result.status = parseStatus(status);

  const limit = single(query, 'limit');
  if (limit !== undefined) result.limit = parseLimit(limit);

  const cursor = single(query, 'cursor');
  if (cursor !== undefined) result.cursor = parseCursor(cursor);

  return result;
}

function parseDecimalId(raw: string, message: string): string {
  if (!/^[1-9][0-9]{0,77}$/.test(raw) || BigInt(raw) > UINT256_MAX) {
    throw new BadRequestException(message);
  }
  return raw;
}

function single(
  query: Record<string, unknown>,
  name: string,
): string | undefined {
  const value = query[name];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new BadRequestException(`Invalid ${name}: give it once as text`);
  }
  return value;
}
