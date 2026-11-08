// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {EscrowManager} from "../src/EscrowManager.sol";
import {EscrowFixture} from "./utils/EscrowFixture.sol";

/// @dev `reject`: beneficiary only, strictly before the expiry `E`, allowed during the cancel window.
contract RejectEscrowTest is EscrowFixture {
    function test_Reject_RefundsSender() public {
        uint256 id = _createDefault();

        vm.expectEmit(true, false, false, false, address(escrow));
        emit EscrowManager.EscrowRejected(id);
        _reject(id);

        _assertStatus(id, EscrowManager.Status.Rejected);
        assertEq(token.balanceOf(alice), FUNDS);
        assertEq(token.balanceOf(bob), 0);
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    function test_Reject_AllowedDuringCancelWindow() public {
        uint256 id = _createDefault();
        (uint256 d,) = _deadlines(id);

        vm.warp(d - 1);
        _reject(id);

        _assertStatus(id, EscrowManager.Status.Rejected);
    }

    function test_Reject_SucceedsOneSecondBeforeExpiry() public {
        uint256 id = _createDefault();
        (, uint256 e) = _deadlines(id);

        vm.warp(e - 1);
        _reject(id);

        _assertStatus(id, EscrowManager.Status.Rejected);
    }

    function test_Reject_RevertsAtExpiry() public {
        uint256 id = _createDefault();
        (, uint256 e) = _deadlines(id);

        vm.warp(e);
        vm.expectRevert(abi.encodeWithSelector(EscrowManager.TtlElapsed.selector, id, e));
        _reject(id);
    }

    function test_Reject_RevertsWhenNotFound() public {
        vm.expectRevert(abi.encodeWithSelector(EscrowManager.EscrowNotFound.selector, 99));
        _reject(99);
    }

    function test_Reject_RevertsWhenNotBeneficiary() public {
        uint256 id = _createDefault();

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(EscrowManager.NotBeneficiary.selector, id));
        escrow.reject(id);
    }

    function test_Reject_ChecksBeneficiaryBeforeTtl() public {
        uint256 id = _createDefault();
        (, uint256 e) = _deadlines(id);

        vm.warp(e);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(EscrowManager.NotBeneficiary.selector, id));
        escrow.reject(id);
    }
}
