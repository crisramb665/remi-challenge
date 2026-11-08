// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {EscrowManager} from "../src/EscrowManager.sol";
import {EscrowFixture} from "./utils/EscrowFixture.sol";

/// @dev `confirm`: beneficiary only, strictly before the expiry `E`, allowed during the cancel window.
contract ConfirmEscrowTest is EscrowFixture {
    function test_Confirm_PaysBeneficiary() public {
        uint256 id = _createDefault();

        vm.expectEmit(true, false, false, false, address(escrow));
        emit EscrowManager.EscrowReleased(id);
        _confirm(id);

        _assertStatus(id, EscrowManager.Status.Released);
        assertEq(token.balanceOf(bob), AMOUNT);
        assertEq(token.balanceOf(alice), FUNDS - AMOUNT);
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    function test_Confirm_AllowedDuringCancelWindow() public {
        uint256 id = _createDefault();
        (uint256 d,) = _deadlines(id);

        vm.warp(d - 1);
        _confirm(id);

        _assertStatus(id, EscrowManager.Status.Released);
    }

    function test_Confirm_SucceedsOneSecondBeforeExpiry() public {
        uint256 id = _createDefault();
        (, uint256 e) = _deadlines(id);

        vm.warp(e - 1);
        _confirm(id);

        _assertStatus(id, EscrowManager.Status.Released);
    }

    function test_Confirm_RevertsAtExpiry() public {
        uint256 id = _createDefault();
        (, uint256 e) = _deadlines(id);

        vm.warp(e);
        vm.expectRevert(abi.encodeWithSelector(EscrowManager.TtlElapsed.selector, id, e));
        _confirm(id);
    }

    function test_Confirm_RevertsWhenNotFound() public {
        vm.expectRevert(abi.encodeWithSelector(EscrowManager.EscrowNotFound.selector, 99));
        _confirm(99);
    }

    function test_Confirm_RevertsWhenNotBeneficiary() public {
        uint256 id = _createDefault();

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(EscrowManager.NotBeneficiary.selector, id));
        escrow.confirm(id);
    }

    function test_Confirm_ChecksBeneficiaryBeforeTtl() public {
        uint256 id = _createDefault();
        (, uint256 e) = _deadlines(id);

        vm.warp(e);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(EscrowManager.NotBeneficiary.selector, id));
        escrow.confirm(id);
    }
}
