// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {EscrowManager} from "../src/EscrowManager.sol";
import {EscrowFixture} from "./utils/EscrowFixture.sol";

/// @dev Tokens sent straight to the contract are not attributed to any escrow (SPEC §2.6, §2.9).
contract DirectTokenTransferTest is EscrowFixture {
    address internal carol = makeAddr("carol");

    function test_DirectTransferDoesNotAffectEscrow() public {
        uint256 donation = 30e18;
        token.mint(carol, donation);
        vm.prank(carol);
        assertTrue(token.transfer(address(escrow), donation));
        assertEq(token.balanceOf(address(escrow)), donation);

        vm.expectEmit(true, true, true, true, address(escrow));
        emit EscrowManager.EscrowCreated(
            1, alice, bob, address(token), AMOUNT, uint64(block.timestamp + 2 hours), uint64(block.timestamp + 7 days)
        );
        uint256 id = _create(address(token), bob, AMOUNT);

        (EscrowManager.Escrow memory e,,) = escrow.getEscrow(id);
        assertEq(e.amount, AMOUNT);
        assertEq(token.balanceOf(address(escrow)), donation + AMOUNT);

        _confirm(id);

        assertEq(token.balanceOf(bob), AMOUNT);
        assertEq(token.balanceOf(address(escrow)), donation);
    }
}
