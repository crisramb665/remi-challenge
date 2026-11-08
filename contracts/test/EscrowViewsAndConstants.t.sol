// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {EscrowManager} from "../src/EscrowManager.sol";
import {EscrowFixture} from "./utils/EscrowFixture.sol";

/// @dev Constants, initial state and the `getEscrow` view.
contract EscrowViewsAndConstantsTest is EscrowFixture {
    function test_Constants() public view {
        assertEq(escrow.CANCEL_WINDOW(), 2 hours);
        assertEq(escrow.TTL(), 7 days);
    }

    function test_NextIdStartsAtOne() public view {
        assertEq(escrow.nextId(), 1);
    }

    function test_GetEscrow_RevertsWhenNotFound() public {
        vm.expectRevert(abi.encodeWithSelector(EscrowManager.EscrowNotFound.selector, 1));
        escrow.getEscrow(1);
    }

    function test_GetEscrow_RevertsForIdZero() public {
        vm.expectRevert(abi.encodeWithSelector(EscrowManager.EscrowNotFound.selector, 0));
        escrow.getEscrow(0);
    }
}
