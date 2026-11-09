import { EscrowRow, STORED_STATUSES, toEscrowView } from './escrow-view';

const D = 1_000n; // cancel deadline
const E = 5_000n; // expiry

function row(overrides: Partial<EscrowRow> = {}): EscrowRow {
  return {
    id: '7',
    sender: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
    beneficiary: '0x70997970c51812dc3a010c7d01b50e0d17dc79c8',
    token: '0x5fbdb2315678afecb367f032d93f642f64180aa3',
    amount:
      '115792089237316195423570985008687907853269984665640564039457584007913129639935',
    cancel_deadline: D.toString(),
    expires_at: E.toString(),
    status: 'Pending',
    created_tx: `0x${'ab'.repeat(32)}`,
    resolved_tx: null,
    ...overrides,
  };
}

describe('toEscrowView', () => {
  describe('a Pending escrow around its deadlines', () => {
    // [label, now, canCancel, canConfirmAndReject, canReclaim, effectiveStatus]
    it.each([
      ['D - 1', D - 1n, true, true, false, 'Pending'],
      ['D', D, false, true, false, 'Pending'],
      ['E - 1', E - 1n, false, true, false, 'Pending'],
      ['E', E, false, false, true, 'PendingExpired'],
      ['E + 1', E + 1n, false, false, true, 'PendingExpired'],
    ] as const)(
      'at now = %s',
      (_label, now, canCancel, canAct, canReclaim, effectiveStatus) => {
        expect(toEscrowView(row(), now)).toMatchObject({
          status: 'Pending',
          effectiveStatus,
          canCancel,
          canConfirm: canAct,
          canReject: canAct,
          canReclaim,
        });
      },
    );

    it('lets the beneficiary act during the cancel window', () => {
      const view = toEscrowView(row(), 1n);

      expect(view.canCancel).toBe(true);
      expect(view.canConfirm).toBe(true);
      expect(view.canReject).toBe(true);
    });
  });

  describe('a resolved escrow', () => {
    const resolved = STORED_STATUSES.filter((status) => status !== 'Pending');

    it.each(resolved)('%s allows no action at any time', (status) => {
      for (const now of [1n, D - 1n, D, E - 1n, E, E + 1_000_000n]) {
        expect(toEscrowView(row({ status }), now)).toMatchObject({
          status,
          effectiveStatus: status,
          canCancel: false,
          canConfirm: false,
          canReject: false,
          canReclaim: false,
        });
      }
    });
  });

  describe('fields', () => {
    it('returns deadlines as numbers and ids as strings', () => {
      const view = toEscrowView(row(), 1n);

      expect(view.id).toBe('7');
      expect(view.cancelDeadline).toBe(1000);
      expect(view.expiresAt).toBe(5000);
    });

    it('shows the creation transaction and no resolution transaction while Pending', () => {
      expect(toEscrowView(row(), 1n).transactions).toEqual({
        created: `0x${'ab'.repeat(32)}`,
        resolved: null,
      });
    });

    it('shows both transactions once resolved', () => {
      const resolvedTx = `0x${'cd'.repeat(32)}`;

      expect(
        toEscrowView(row({ status: 'Released', resolved_tx: resolvedTx }), 1n)
          .transactions,
      ).toEqual({ created: `0x${'ab'.repeat(32)}`, resolved: resolvedTx });
    });

    it('rejects a status the contract does not have', () => {
      expect(() => toEscrowView(row({ status: 'Frozen' }), 1n)).toThrow(
        'unknown status: Frozen',
      );
    });
  });
});
