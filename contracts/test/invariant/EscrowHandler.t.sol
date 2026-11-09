// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {EscrowManager} from "../../src/EscrowManager.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockPermitERC20} from "../mocks/MockPermitERC20.sol";
import {EscrowHandler} from "./EscrowHandler.sol";

/// @dev Checks that the handler really reaches every resolution path, so the invariants are not passing
/// on sequences where nothing ever succeeds. Seed 1 selects the legitimate caller (see `EscrowHandler`).
contract EscrowHandlerCoverageTest is Test {
    EscrowManager internal escrow;
    EscrowHandler internal handler;

    uint256 internal constant LEGIT = 1;
    uint256 internal constant WRONG_CALLER = 0;

    function setUp() public {
        escrow = new EscrowManager();
        handler = new EscrowHandler(escrow, new MockERC20(), new MockERC20(), new MockPermitERC20());
        handler.create(0, 0, 0, 1e18);
    }

    /// @dev Escrow 2 is created with a signed permit, and then resolved like any other, with the payout recorded.
    function test_Handler_ReachesPermitCreateAndResolvesIt() public {
        handler.createWithPermit(0, 0, 2e18);

        assertEq(handler.createdWithPermit(), 1);
        assertEq(escrow.nextId(), 3);
        (EscrowManager.Escrow memory e,,) = escrow.getEscrow(2);
        assertEq(e.token, address(handler.tokenP()));
        assertEq(e.amount, 2e18);

        // idSeed 2 selects escrow 2, the first pending one from there.
        handler.confirm(2, LEGIT);
        assertEq(handler.resolutionsByStatus(EscrowManager.Status.Released), 1);
        assertEq(handler.paidToBeneficiary(2), 2e18);
    }

    function test_Handler_ReachesCancel() public {
        handler.cancel(1, LEGIT);
        assertEq(handler.resolutionsByStatus(EscrowManager.Status.CancelledBySender), 1);
    }

    function test_Handler_ReachesConfirm() public {
        handler.confirm(1, LEGIT);
        assertEq(handler.resolutionsByStatus(EscrowManager.Status.Released), 1);
    }

    function test_Handler_ReachesReject() public {
        handler.reject(1, LEGIT);
        assertEq(handler.resolutionsByStatus(EscrowManager.Status.Rejected), 1);
    }

    function test_Handler_ReachesReclaim() public {
        vm.warp(block.timestamp + 7 days);
        handler.reclaim(1, LEGIT);
        assertEq(handler.resolutionsByStatus(EscrowManager.Status.Expired), 1);
    }

    function test_Handler_WrongCallerResolvesNothing() public {
        // Seed 0 picks actor0, who is the sender, so only the beneficiary actions are wrong callers.
        handler.confirm(1, WRONG_CALLER);
        handler.reject(1, WRONG_CALLER);

        assertEq(handler.resolutionsByStatus(EscrowManager.Status.Released), 0);
        assertEq(handler.resolutionsByStatus(EscrowManager.Status.Rejected), 0);
        assertFalse(handler.resolved(1));
    }

    function test_Handler_ReachesResolvedEscrowAndChangesNothing() public {
        handler.confirm(1, LEGIT);

        // idSeed 0 targets the raw id, which is resolved now. Every attempt must fail.
        handler.cancel(0, LEGIT);
        handler.reject(0, LEGIT);
        handler.confirm(0, LEGIT);

        assertEq(handler.resolutionsByStatus(EscrowManager.Status.Released), 1);
        assertEq(handler.resolutionsByStatus(EscrowManager.Status.CancelledBySender), 0);
        assertEq(handler.resolutionsByStatus(EscrowManager.Status.Rejected), 0);
        assertFalse(handler.resolvedTwice());
    }
}
