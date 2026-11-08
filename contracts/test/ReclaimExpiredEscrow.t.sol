// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {EscrowManager} from "../src/EscrowManager.sol";
import {EscrowFixture} from "./utils/EscrowFixture.sol";

/// @dev `reclaimExpired`: sender only, from the expiry `E` onwards.
contract ReclaimExpiredEscrowTest is EscrowFixture {
    function test_ReclaimExpired_RefundsSenderAtExpiry() public {
        uint256 id = _createDefault();
        (, uint256 e) = _deadlines(id);

        vm.warp(e);
        vm.expectEmit(true, false, false, false, address(escrow));
        emit EscrowManager.EscrowExpired(id);
        _reclaim(id);

        _assertStatus(id, EscrowManager.Status.Expired);
        assertEq(token.balanceOf(alice), FUNDS);
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    function test_ReclaimExpired_RevertsOneSecondBeforeExpiry() public {
        uint256 id = _createDefault();
        (, uint256 e) = _deadlines(id);

        vm.warp(e - 1);
        vm.expectRevert(abi.encodeWithSelector(EscrowManager.NotExpiredYet.selector, id, e));
        _reclaim(id);
    }

    function test_ReclaimExpired_RevertsWhenNotFound() public {
        vm.expectRevert(abi.encodeWithSelector(EscrowManager.EscrowNotFound.selector, 99));
        _reclaim(99);
    }

    function test_ReclaimExpired_RevertsWhenNotSender() public {
        uint256 id = _createDefault();
        (, uint256 e) = _deadlines(id);

        vm.warp(e);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(EscrowManager.NotSender.selector, id));
        escrow.reclaimExpired(id);
    }

    function test_ReclaimExpired_ChecksSenderBeforeExpiry() public {
        uint256 id = _createDefault();
        (, uint256 e) = _deadlines(id);

        vm.warp(e - 1);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(EscrowManager.NotSender.selector, id));
        escrow.reclaimExpired(id);
    }
}
