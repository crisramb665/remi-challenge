import { BadRequestException } from '@nestjs/common';
import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  parseAddress,
  parseCursor,
  parseEscrowId,
  parseLimit,
  parseListQuery,
  parseStatus,
} from './query';

const UINT256_MAX = (2n ** 256n - 1n).toString();
const ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

describe('parseEscrowId', () => {
  it.each(['1', '7', '42', '1000000', UINT256_MAX])('accepts %s', (id) => {
    expect(parseEscrowId(id)).toBe(id);
  });

  it.each([
    ['zero', '0'],
    ['leading zero', '01'],
    ['negative', '-1'],
    ['plus sign', '+1'],
    ['decimal', '1.5'],
    ['hex', '0x1'],
    ['text', 'abc'],
    ['empty', ''],
    ['spaces', ' 1'],
    ['exponent', '1e3'],
    ['above uint256', (2n ** 256n).toString()],
    ['78 digits above uint256', '9'.repeat(78)],
    ['very long', '1'.repeat(200)],
  ])('rejects %s', (_label, id) => {
    expect(() => parseEscrowId(id)).toThrow(BadRequestException);
    expect(() => parseEscrowId(id)).toThrow('Invalid escrow id');
  });
});

describe('parseCursor', () => {
  it('accepts an id', () => {
    expect(parseCursor('12')).toBe('12');
  });

  it.each(['0', '-3', 'abc', '', '1.0'])(
    'rejects %s with its own message',
    (raw) => {
      expect(() => parseCursor(raw)).toThrow(BadRequestException);
      expect(() => parseCursor(raw)).toThrow('Invalid cursor');
    },
  );
});

describe('parseAddress', () => {
  it('accepts a checksummed address and lowercases it', () => {
    expect(parseAddress(ADDRESS, 'sender')).toBe(ADDRESS.toLowerCase());
  });

  it('accepts a lowercase and an uppercase address', () => {
    expect(parseAddress(ADDRESS.toLowerCase(), 'sender')).toBe(
      ADDRESS.toLowerCase(),
    );
    expect(parseAddress(`0x${ADDRESS.slice(2).toUpperCase()}`, 'sender')).toBe(
      ADDRESS.toLowerCase(),
    );
  });

  it.each([
    ['without 0x', ADDRESS.slice(2)],
    ['too short', ADDRESS.slice(0, -1)],
    ['too long', `${ADDRESS}0`],
    ['not hex', `0x${'g'.repeat(40)}`],
    ['empty', ''],
    ['zero x only', '0x'],
    ['with spaces', ` ${ADDRESS}`],
  ])('rejects an address %s', (_label, raw) => {
    expect(() => parseAddress(raw, 'sender')).toThrow('Invalid sender address');
  });

  it('names the parameter in the error', () => {
    expect(() => parseAddress('nope', 'beneficiary')).toThrow(
      'Invalid beneficiary address',
    );
  });
});

describe('parseStatus', () => {
  it.each([
    'Pending',
    'Released',
    'Rejected',
    'CancelledBySender',
    'Expired',
    'PendingExpired',
  ])('accepts %s', (status) => {
    expect(parseStatus(status)).toBe(status);
  });

  it.each(['pending', 'None', 'Cancelled', 'PENDING', '', 'Pending,Released'])(
    'rejects %s',
    (status) => {
      expect(() => parseStatus(status)).toThrow(BadRequestException);
    },
  );
});

describe('parseLimit', () => {
  it.each([
    ['1', 1],
    ['20', 20],
    ['99', 99],
    ['100', 100],
  ])('accepts %s', (raw, expected) => {
    expect(parseLimit(raw)).toBe(expected);
  });

  it.each([
    '0',
    '101',
    '1000',
    '-5',
    '2.5',
    'abc',
    '',
    '1e2',
    ' 5',
    '0x10',
    '00000',
  ])('rejects %s', (raw) => {
    expect(() => parseLimit(raw)).toThrow(BadRequestException);
    expect(() => parseLimit(raw)).toThrow(`from 1 to ${MAX_LIMIT}`);
  });
});

describe('parseListQuery', () => {
  it('uses the default limit and no filters for an empty query', () => {
    expect(parseListQuery({})).toEqual({ limit: DEFAULT_LIMIT });
  });

  it('reads every parameter', () => {
    expect(
      parseListQuery({
        sender: ADDRESS,
        beneficiary: ADDRESS.toUpperCase().replace('0X', '0x'),
        status: 'PendingExpired',
        limit: '50',
        cursor: '12',
      }),
    ).toEqual({
      sender: ADDRESS.toLowerCase(),
      beneficiary: ADDRESS.toLowerCase(),
      status: 'PendingExpired',
      limit: 50,
      cursor: '12',
    });
  });

  it('ignores parameters it does not know', () => {
    expect(parseListQuery({ page: '3', foo: 'bar' })).toEqual({
      limit: DEFAULT_LIMIT,
    });
  });

  it.each([
    ['sender', 'nope'],
    ['beneficiary', '0x123'],
    ['status', 'Frozen'],
    ['limit', '0'],
    ['limit', '101'],
    ['cursor', '0'],
    ['cursor', 'abc'],
  ])('returns 400 for an invalid %s (%s)', (name, value) => {
    expect(() => parseListQuery({ [name]: value })).toThrow(
      BadRequestException,
    );
  });

  it.each(['sender', 'beneficiary', 'status', 'limit', 'cursor'])(
    'treats an empty %s as invalid, not as no filter',
    (name) => {
      expect(() => parseListQuery({ [name]: '' })).toThrow(BadRequestException);
    },
  );

  it('rejects a repeated parameter', () => {
    expect(() => parseListQuery({ limit: ['1', '2'] })).toThrow(
      BadRequestException,
    );
    expect(() => parseListQuery({ sender: [ADDRESS, ADDRESS] })).toThrow(
      BadRequestException,
    );
  });

  it('rejects a nested object such as ?status[a]=b', () => {
    expect(() => parseListQuery({ status: { a: 'b' } })).toThrow(
      BadRequestException,
    );
  });
});
