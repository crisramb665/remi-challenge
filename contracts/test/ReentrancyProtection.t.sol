// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EscrowManager} from "../src/EscrowManager.sol";
import {EscrowFixture} from "./utils/EscrowFixture.sol";
import {MockReentrantERC20} from "./mocks/MockReentrantERC20.sol";

/// @dev A token that calls back into the contract during a transfer cannot reenter any state changing function.
contract ReentrancyProtectionTest is EscrowFixture {
    MockReentrantERC20 internal rToken;

    function setUp() public override {
        super.setUp();
        rToken = new MockReentrantERC20();
        rToken.mint(alice, FUNDS);
        vm.prank(alice);
        rToken.approve(address(escrow), type(uint256).max);
    }

    function _createWithReentrantToken() internal returns (uint256) {
        return _create(address(rToken), bob, AMOUNT);
    }

    function _expectBlocked() internal {
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
    }

    function test_CreateEscrow_BlocksReentrantCreate() public {
        rToken.arm(address(escrow), abi.encodeCall(escrow.createEscrow, (address(rToken), bob, 1)));

        _expectBlocked();
        _createWithReentrantToken();

        assertEq(escrow.nextId(), 1);
        assertEq(rToken.balanceOf(address(escrow)), 0);
    }

    function test_Cancel_BlocksReentrantCancel() public {
        uint256 id = _createWithReentrantToken();
        rToken.arm(address(escrow), abi.encodeCall(escrow.cancel, (id)));

        _expectBlocked();
        _cancel(id);

        _assertStatus(id, EscrowManager.Status.Pending);
    }

    function test_Confirm_BlocksReentrantConfirm() public {
        uint256 id = _createWithReentrantToken();
        rToken.arm(address(escrow), abi.encodeCall(escrow.confirm, (id)));

        _expectBlocked();
        _confirm(id);

        _assertStatus(id, EscrowManager.Status.Pending);
    }

    function test_Reject_BlocksReentrantReject() public {
        uint256 id = _createWithReentrantToken();
        rToken.arm(address(escrow), abi.encodeCall(escrow.reject, (id)));

        _expectBlocked();
        _reject(id);

        _assertStatus(id, EscrowManager.Status.Pending);
    }

    function test_ReclaimExpired_BlocksReentrantReclaim() public {
        uint256 id = _createWithReentrantToken();
        (, uint256 e) = _deadlines(id);
        rToken.arm(address(escrow), abi.encodeCall(escrow.reclaimExpired, (id)));

        vm.warp(e);
        _expectBlocked();
        _reclaim(id);

        _assertStatus(id, EscrowManager.Status.Pending);
    }

    function test_Confirm_BlocksReentrantCancel() public {
        uint256 id = _createWithReentrantToken();
        rToken.arm(address(escrow), abi.encodeCall(escrow.cancel, (id)));

        _expectBlocked();
        _confirm(id);

        _assertStatus(id, EscrowManager.Status.Pending);
    }

    function test_Cancel_BlocksReentrantConfirm() public {
        uint256 id = _createWithReentrantToken();
        rToken.arm(address(escrow), abi.encodeCall(escrow.confirm, (id)));

        _expectBlocked();
        _cancel(id);

        _assertStatus(id, EscrowManager.Status.Pending);
    }
}
