// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {EscrowManager} from "../../src/EscrowManager.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockPermitERC20} from "../mocks/MockPermitERC20.sol";
import {EscrowHandler} from "./EscrowHandler.sol";

/// @dev Invariants I1 to I3 of SPEC §2.9, checked after random sequences of handler calls. Escrows are created
/// with both create functions, the permit one always with `tokenP`.
contract EscrowInvariantsTest is Test {
    EscrowManager internal escrow;
    MockERC20 internal tokenA;
    MockERC20 internal tokenB;
    MockPermitERC20 internal tokenP;
    EscrowHandler internal handler;

    function setUp() public {
        escrow = new EscrowManager();
        tokenA = new MockERC20();
        tokenB = new MockERC20();
        tokenP = new MockPermitERC20();
        handler = new EscrowHandler(escrow, tokenA, tokenB, tokenP);

        bytes4[] memory selectors = new bytes4[](7);
        selectors[0] = handler.create.selector;
        selectors[1] = handler.cancel.selector;
        selectors[2] = handler.confirm.selector;
        selectors[3] = handler.reject.selector;
        selectors[4] = handler.reclaim.selector;
        selectors[5] = handler.warp.selector;
        selectors[6] = handler.createWithPermit.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
    }

    /// @dev I1: per token, the contract balance equals the sum of the `Pending` amounts.
    function invariant_I1_BalanceEqualsPendingAmounts() public view {
        _assertBalanceMatchesPending(address(tokenA));
        _assertBalanceMatchesPending(address(tokenB));
        _assertBalanceMatchesPending(address(tokenP));
    }

    /// @dev I2: an escrow outside `Pending` never changes status.
    function invariant_I2_ResolvedStatusNeverChanges() public view {
        assertFalse(handler.resolvedTwice());

        uint256 count = escrow.nextId() - 1;
        for (uint256 id = 1; id <= count; id++) {
            if (!handler.resolved(id)) continue;
            (EscrowManager.Escrow memory e,,) = escrow.getEscrow(id);
            assertTrue(e.status != EscrowManager.Status.Pending);
            assertEq(uint8(e.status), uint8(handler.finalStatus(id)));
        }
    }

    /// @dev I3: payout to the beneficiary plus refund to the sender equals the amount, and only one is nonzero.
    function invariant_I3_PayoutPlusRefundEqualsAmount() public view {
        uint256 count = escrow.nextId() - 1;
        for (uint256 id = 1; id <= count; id++) {
            if (!handler.resolved(id)) continue;
            (EscrowManager.Escrow memory e,,) = escrow.getEscrow(id);
            uint256 paid = handler.paidToBeneficiary(id);
            uint256 refunded = handler.refundedToSender(id);

            assertEq(paid + refunded, e.amount);
            assertTrue(paid == 0 || refunded == 0);
            if (e.status == EscrowManager.Status.Released) {
                assertEq(paid, e.amount);
            } else {
                assertEq(refunded, e.amount);
            }
        }
    }

    function _assertBalanceMatchesPending(address token) internal view {
        uint256 pendingSum;
        uint256 count = escrow.nextId() - 1;
        for (uint256 id = 1; id <= count; id++) {
            (EscrowManager.Escrow memory e,,) = escrow.getEscrow(id);
            if (e.status == EscrowManager.Status.Pending && e.token == token) pendingSum += e.amount;
        }
        assertEq(MockERC20(token).balanceOf(address(escrow)), pendingSum);
    }
}
