// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {EscrowManager} from "../src/EscrowManager.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockFeeOnTransferERC20} from "./mocks/MockFeeOnTransferERC20.sol";

contract EscrowManagerTest is Test {
    EscrowManager internal escrow;
    MockERC20 internal token;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal eoa = makeAddr("eoa");

    uint256 internal constant FUNDS = 1_000e18;
    uint256 internal constant AMOUNT = 100e18;

    function setUp() public {
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

    function test_CreateEscrow_StoresEscrowAndMovesFunds() public {
        uint256 id = _create(address(token), bob, AMOUNT);

        assertEq(id, 1);
        assertEq(escrow.nextId(), 2);
        assertEq(token.balanceOf(alice), FUNDS - AMOUNT);
        assertEq(token.balanceOf(address(escrow)), AMOUNT);

        (EscrowManager.Escrow memory e, uint64 cancelDeadline, uint64 expiresAt) = escrow.getEscrow(id);
        assertEq(e.sender, alice);
        assertEq(e.beneficiary, bob);
        assertEq(e.token, address(token));
        assertEq(e.amount, AMOUNT);
        assertEq(e.createdAt, block.timestamp);
        assertEq(uint8(e.status), uint8(EscrowManager.Status.Pending));
        assertEq(cancelDeadline, block.timestamp + 2 hours);
        assertEq(expiresAt, block.timestamp + 7 days);
    }

    function test_CreateEscrow_EmitsEscrowCreated() public {
        vm.expectEmit(true, true, true, true, address(escrow));
        emit EscrowManager.EscrowCreated(
            1, alice, bob, address(token), AMOUNT, uint64(block.timestamp + 2 hours), uint64(block.timestamp + 7 days)
        );
        _create(address(token), bob, AMOUNT);
    }

    function test_CreateEscrow_AssignsIncreasingIds() public {
        uint256 first = _create(address(token), bob, AMOUNT);
        uint256 second = _create(address(token), bob, 2 * AMOUNT);

        assertEq(first, 1);
        assertEq(second, 2);
        assertEq(escrow.nextId(), 3);
    }

    function test_CreateEscrow_RevertsOnZeroAmount() public {
        vm.expectRevert(EscrowManager.ZeroAmount.selector);
        _create(address(token), bob, 0);
    }

    function test_CreateEscrow_RevertsOnZeroBeneficiary() public {
        vm.expectRevert(EscrowManager.InvalidBeneficiary.selector);
        _create(address(token), address(0), AMOUNT);
    }

    function test_CreateEscrow_RevertsWhenBeneficiaryIsSender() public {
        vm.expectRevert(EscrowManager.InvalidBeneficiary.selector);
        _create(address(token), alice, AMOUNT);
    }

    function test_CreateEscrow_RevertsOnZeroToken() public {
        vm.expectRevert(EscrowManager.InvalidToken.selector);
        _create(address(0), bob, AMOUNT);
    }

    function test_CreateEscrow_RevertsWhenTokenIsEoa() public {
        vm.expectRevert(EscrowManager.InvalidToken.selector);
        _create(eoa, bob, AMOUNT);

        assertEq(escrow.nextId(), 1);
    }

    function test_CreateEscrow_RevertsWhenTokenIsUndeployedContractAddress() public {
        address notDeployed = vm.computeCreateAddress(alice, vm.getNonce(alice));

        vm.expectRevert(EscrowManager.InvalidToken.selector);
        _create(notDeployed, bob, AMOUNT);
    }

    function test_CreateEscrow_ChecksBeneficiaryBeforeNoCodeToken() public {
        vm.expectRevert(EscrowManager.InvalidBeneficiary.selector);
        _create(eoa, address(0), AMOUNT);
    }

    function test_CreateEscrow_ChecksAmountBeforeNoCodeToken() public {
        vm.expectRevert(EscrowManager.ZeroAmount.selector);
        _create(eoa, bob, 0);
    }

    function test_CreateEscrow_ChecksAmountBeforeBeneficiaryAndToken() public {
        vm.expectRevert(EscrowManager.ZeroAmount.selector);
        _create(address(0), address(0), 0);
    }

    function test_CreateEscrow_ChecksBeneficiaryBeforeToken() public {
        vm.expectRevert(EscrowManager.InvalidBeneficiary.selector);
        _create(address(0), address(0), AMOUNT);
    }

    function test_CreateEscrow_RevertsOnFeeOnTransferToken() public {
        MockFeeOnTransferERC20 feeToken = new MockFeeOnTransferERC20();
        feeToken.mint(alice, FUNDS);
        vm.prank(alice);
        feeToken.approve(address(escrow), type(uint256).max);

        vm.expectRevert(EscrowManager.UnsupportedToken.selector);
        _create(address(feeToken), bob, AMOUNT);

        assertEq(escrow.nextId(), 1);
    }

    function testFuzz_CreateEscrow_LocksExactAmount(uint96 amount) public {
        amount = uint96(bound(amount, 1, FUNDS));

        uint256 id = _create(address(token), bob, amount);

        (EscrowManager.Escrow memory e,,) = escrow.getEscrow(id);
        assertEq(e.amount, amount);
        assertEq(token.balanceOf(address(escrow)), amount);
        assertEq(token.balanceOf(alice), FUNDS - amount);
    }
}
