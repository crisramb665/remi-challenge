// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {EscrowManager} from "../../src/EscrowManager.sol";
import {MockERC20} from "../mocks/MockERC20.sol";

/// @dev Shared setup and helpers for the EscrowManager tests. Alice is the sender and bob the beneficiary.
abstract contract EscrowFixture is Test {
    EscrowManager internal escrow;
    MockERC20 internal token;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    uint256 internal constant FUNDS = 1_000e18;
    uint256 internal constant AMOUNT = 100e18;

    function setUp() public virtual {
        escrow = new EscrowManager();
        token = new MockERC20();
        token.mint(alice, FUNDS);
        vm.prank(alice);
        token.approve(address(escrow), type(uint256).max);
    }

    /// @dev Calls `createEscrow` as alice.
    function _create(address token_, address beneficiary, uint256 amount) internal returns (uint256) {
        vm.prank(alice);
        return escrow.createEscrow(token_, beneficiary, amount);
    }

    /// @dev Creates an escrow from alice to bob for `AMOUNT`.
    function _createDefault() internal returns (uint256) {
        return _create(address(token), bob, AMOUNT);
    }

    /// @dev The four actions, called by their legitimate caller.
    function _cancel(uint256 id) internal {
        vm.prank(alice);
        escrow.cancel(id);
    }

    function _confirm(uint256 id) internal {
        vm.prank(bob);
        escrow.confirm(id);
    }

    function _reject(uint256 id) internal {
        vm.prank(bob);
        escrow.reject(id);
    }

    function _reclaim(uint256 id) internal {
        vm.prank(alice);
        escrow.reclaimExpired(id);
    }

    /// @dev Cancel deadline `D` and expiry `E` of an escrow.
    function _deadlines(uint256 id) internal view returns (uint256 cancelDeadline, uint256 expiresAt) {
        (, uint64 d, uint64 e) = escrow.getEscrow(id);
        return (d, e);
    }

    function _assertStatus(uint256 id, EscrowManager.Status expected) internal view {
        (EscrowManager.Escrow memory e,,) = escrow.getEscrow(id);
        assertEq(uint8(e.status), uint8(expected));
    }
}
