// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {EscrowManager} from "../src/EscrowManager.sol";
import {EscrowFixture} from "./utils/EscrowFixture.sol";

/// @dev Once an escrow leaves `Pending` it can never change again (SPEC §2.3, invariant I2).
contract ResolvedEscrowFinalityTest is EscrowFixture {
    /// @dev Every action reverts with `NotPending` once the escrow has `status`.
    function _assertNothingCanChange(uint256 id, EscrowManager.Status status) internal {
        bytes memory err = abi.encodeWithSelector(EscrowManager.NotPending.selector, id, status);
        vm.expectRevert(err);
        _cancel(id);
        vm.expectRevert(err);
        _confirm(id);
        vm.expectRevert(err);
        _reject(id);
        vm.expectRevert(err);
        _reclaim(id);
    }

    function test_ResolvedEscrow_CannotChange_AfterCancel() public {
        uint256 id = _createDefault();
        _cancel(id);
        _assertNothingCanChange(id, EscrowManager.Status.CancelledBySender);
    }

    function test_ResolvedEscrow_CannotChange_AfterConfirm() public {
        uint256 id = _createDefault();
        _confirm(id);
        _assertNothingCanChange(id, EscrowManager.Status.Released);
    }

    function test_ResolvedEscrow_CannotChange_AfterReject() public {
        uint256 id = _createDefault();
        _reject(id);
        _assertNothingCanChange(id, EscrowManager.Status.Rejected);
    }

    function test_ResolvedEscrow_CannotChange_AfterReclaim() public {
        uint256 id = _createDefault();
        (, uint256 e) = _deadlines(id);
        vm.warp(e);
        _reclaim(id);
        _assertNothingCanChange(id, EscrowManager.Status.Expired);
    }
}
