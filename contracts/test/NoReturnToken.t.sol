// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {EscrowManager} from "../src/EscrowManager.sol";
import {EscrowFixture} from "./utils/EscrowFixture.sol";
import {MockNoReturnERC20} from "./mocks/MockNoReturnERC20.sol";

/// @dev Tokens that return no `bool` work through the whole lifecycle thanks to `SafeERC20` (SPEC §2.5).
contract NoReturnTokenTest is EscrowFixture {
    MockNoReturnERC20 internal nrToken;

    function setUp() public override {
        super.setUp();
        nrToken = new MockNoReturnERC20();
        nrToken.mint(alice, FUNDS);
        vm.prank(alice);
        nrToken.approve(address(escrow), type(uint256).max);
    }

    function _createNoReturn() internal returns (uint256) {
        return _create(address(nrToken), bob, AMOUNT);
    }

    function test_NoReturnToken_CreateLocksFunds() public {
        uint256 id = _createNoReturn();

        (EscrowManager.Escrow memory e,,) = escrow.getEscrow(id);
        assertEq(e.token, address(nrToken));
        assertEq(e.amount, AMOUNT);
        assertEq(nrToken.balanceOf(address(escrow)), AMOUNT);
        assertEq(nrToken.balanceOf(alice), FUNDS - AMOUNT);
    }

    function test_NoReturnToken_ConfirmPaysBeneficiary() public {
        uint256 id = _createNoReturn();
        _confirm(id);

        _assertStatus(id, EscrowManager.Status.Released);
        assertEq(nrToken.balanceOf(bob), AMOUNT);
        assertEq(nrToken.balanceOf(address(escrow)), 0);
    }

    function test_NoReturnToken_RejectRefundsSender() public {
        uint256 id = _createNoReturn();
        _reject(id);

        _assertStatus(id, EscrowManager.Status.Rejected);
        assertEq(nrToken.balanceOf(alice), FUNDS);
        assertEq(nrToken.balanceOf(address(escrow)), 0);
    }

    function test_NoReturnToken_CancelRefundsSender() public {
        uint256 id = _createNoReturn();
        _cancel(id);

        _assertStatus(id, EscrowManager.Status.CancelledBySender);
        assertEq(nrToken.balanceOf(alice), FUNDS);
        assertEq(nrToken.balanceOf(address(escrow)), 0);
    }

    function test_NoReturnToken_ReclaimRefundsSender() public {
        uint256 id = _createNoReturn();
        (, uint256 e) = _deadlines(id);

        vm.warp(e);
        _reclaim(id);

        _assertStatus(id, EscrowManager.Status.Expired);
        assertEq(nrToken.balanceOf(alice), FUNDS);
        assertEq(nrToken.balanceOf(address(escrow)), 0);
    }
}
