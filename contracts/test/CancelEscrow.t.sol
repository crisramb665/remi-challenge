// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {EscrowManager} from "../src/EscrowManager.sol";
import {EscrowFixture} from "./utils/EscrowFixture.sol";

/// @dev `cancel`: sender only, strictly before the cancel deadline `D`.
contract CancelEscrowTest is EscrowFixture {
    function test_Cancel_RefundsSender() public {
        uint256 id = _createDefault();

        vm.expectEmit(true, false, false, false, address(escrow));
        emit EscrowManager.EscrowCancelled(id);
        _cancel(id);

        _assertStatus(id, EscrowManager.Status.CancelledBySender);
        assertEq(token.balanceOf(alice), FUNDS);
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    function test_Cancel_SucceedsOneSecondBeforeDeadline() public {
        uint256 id = _createDefault();
        (uint256 d,) = _deadlines(id);

        vm.warp(d - 1);
        _cancel(id);

        _assertStatus(id, EscrowManager.Status.CancelledBySender);
    }

    function test_Cancel_RevertsAtDeadline() public {
        uint256 id = _createDefault();
        (uint256 d,) = _deadlines(id);

        vm.warp(d);
        vm.expectRevert(abi.encodeWithSelector(EscrowManager.CancelWindowClosed.selector, id, d));
        _cancel(id);
    }

    function test_Cancel_RevertsAtExpiry() public {
        uint256 id = _createDefault();
        (uint256 d, uint256 e) = _deadlines(id);

        vm.warp(e);
        vm.expectRevert(abi.encodeWithSelector(EscrowManager.CancelWindowClosed.selector, id, d));
        _cancel(id);
    }

    function test_Cancel_RevertsWhenNotFound() public {
        vm.expectRevert(abi.encodeWithSelector(EscrowManager.EscrowNotFound.selector, 99));
        _cancel(99);
    }

    function test_Cancel_RevertsWhenNotSender() public {
        uint256 id = _createDefault();

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(EscrowManager.NotSender.selector, id));
        escrow.cancel(id);
    }

    function test_Cancel_ChecksNotFoundBeforeSender() public {
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(EscrowManager.EscrowNotFound.selector, 99));
        escrow.cancel(99);
    }

    function test_Cancel_ChecksPendingBeforeSender() public {
        uint256 id = _createDefault();
        _cancel(id);

        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(EscrowManager.NotPending.selector, id, EscrowManager.Status.CancelledBySender)
        );
        escrow.cancel(id);
    }

    function test_Cancel_ChecksSenderBeforeWindow() public {
        uint256 id = _createDefault();
        (uint256 d,) = _deadlines(id);

        vm.warp(d);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(EscrowManager.NotSender.selector, id));
        escrow.cancel(id);
    }
}
