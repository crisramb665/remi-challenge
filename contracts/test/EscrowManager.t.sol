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

    uint256 internal constant FUNDS = 1_000e18;

    function setUp() public {
        escrow = new EscrowManager();
        token = new MockERC20();
        token.mint(alice, FUNDS);
        vm.prank(alice);
        token.approve(address(escrow), type(uint256).max);
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
        vm.prank(alice);
        uint256 id = escrow.createEscrow(address(token), bob, 100e18);

        assertEq(id, 1);
        assertEq(escrow.nextId(), 2);
        assertEq(token.balanceOf(alice), FUNDS - 100e18);
        assertEq(token.balanceOf(address(escrow)), 100e18);

        (EscrowManager.Escrow memory e, uint64 cancelDeadline, uint64 expiresAt) = escrow.getEscrow(id);
        assertEq(e.sender, alice);
        assertEq(e.beneficiary, bob);
        assertEq(e.token, address(token));
        assertEq(e.amount, 100e18);
        assertEq(e.createdAt, block.timestamp);
        assertEq(uint8(e.status), uint8(EscrowManager.Status.Pending));
        assertEq(cancelDeadline, block.timestamp + 2 hours);
        assertEq(expiresAt, block.timestamp + 7 days);
    }

    function test_CreateEscrow_EmitsEscrowCreated() public {
        vm.expectEmit(true, true, true, true, address(escrow));
        emit EscrowManager.EscrowCreated(
            1, alice, bob, address(token), 100e18, uint64(block.timestamp + 2 hours), uint64(block.timestamp + 7 days)
        );
        vm.prank(alice);
        escrow.createEscrow(address(token), bob, 100e18);
    }

    function test_CreateEscrow_AssignsIncreasingIds() public {
        vm.startPrank(alice);
        uint256 first = escrow.createEscrow(address(token), bob, 1e18);
        uint256 second = escrow.createEscrow(address(token), bob, 2e18);
        vm.stopPrank();

        assertEq(first, 1);
        assertEq(second, 2);
        assertEq(escrow.nextId(), 3);
    }

    function test_CreateEscrow_RevertsOnZeroAmount() public {
        vm.prank(alice);
        vm.expectRevert(EscrowManager.ZeroAmount.selector);
        escrow.createEscrow(address(token), bob, 0);
    }

    function test_CreateEscrow_RevertsOnZeroBeneficiary() public {
        vm.prank(alice);
        vm.expectRevert(EscrowManager.InvalidBeneficiary.selector);
        escrow.createEscrow(address(token), address(0), 1e18);
    }

    function test_CreateEscrow_RevertsWhenBeneficiaryIsSender() public {
        vm.prank(alice);
        vm.expectRevert(EscrowManager.InvalidBeneficiary.selector);
        escrow.createEscrow(address(token), alice, 1e18);
    }

    function test_CreateEscrow_RevertsOnZeroToken() public {
        vm.prank(alice);
        vm.expectRevert(EscrowManager.InvalidToken.selector);
        escrow.createEscrow(address(0), bob, 1e18);
    }

    function test_CreateEscrow_RevertsWhenTokenIsEoa() public {
        address eoa = makeAddr("eoa");

        vm.prank(alice);
        vm.expectRevert(EscrowManager.InvalidToken.selector);
        escrow.createEscrow(eoa, bob, 1e18);

        assertEq(escrow.nextId(), 1);
    }

    function test_CreateEscrow_RevertsWhenTokenIsUndeployedContractAddress() public {
        address notDeployed = computeCreateAddress(alice, vm.getNonce(alice));

        vm.prank(alice);
        vm.expectRevert(EscrowManager.InvalidToken.selector);
        escrow.createEscrow(notDeployed, bob, 1e18);
    }

    function test_CreateEscrow_ChecksBeneficiaryBeforeNoCodeToken() public {
        address eoa = makeAddr("eoa");

        vm.prank(alice);
        vm.expectRevert(EscrowManager.InvalidBeneficiary.selector);
        escrow.createEscrow(eoa, address(0), 1e18);
    }

    function test_CreateEscrow_ChecksAmountBeforeNoCodeToken() public {
        address eoa = makeAddr("eoa");

        vm.prank(alice);
        vm.expectRevert(EscrowManager.ZeroAmount.selector);
        escrow.createEscrow(eoa, bob, 0);
    }

    function test_CreateEscrow_ChecksAmountBeforeBeneficiaryAndToken() public {
        vm.prank(alice);
        vm.expectRevert(EscrowManager.ZeroAmount.selector);
        escrow.createEscrow(address(0), address(0), 0);
    }

    function test_CreateEscrow_ChecksBeneficiaryBeforeToken() public {
        vm.prank(alice);
        vm.expectRevert(EscrowManager.InvalidBeneficiary.selector);
        escrow.createEscrow(address(0), address(0), 1e18);
    }

    function test_CreateEscrow_RevertsOnFeeOnTransferToken() public {
        MockFeeOnTransferERC20 feeToken = new MockFeeOnTransferERC20();
        feeToken.mint(alice, FUNDS);
        vm.startPrank(alice);
        feeToken.approve(address(escrow), type(uint256).max);
        vm.expectRevert(EscrowManager.UnsupportedToken.selector);
        escrow.createEscrow(address(feeToken), bob, 100e18);
        vm.stopPrank();

        assertEq(escrow.nextId(), 1);
    }

    function testFuzz_CreateEscrow_LocksExactAmount(uint96 amount) public {
        amount = uint96(bound(amount, 1, FUNDS));

        vm.prank(alice);
        uint256 id = escrow.createEscrow(address(token), bob, amount);

        (EscrowManager.Escrow memory e,,) = escrow.getEscrow(id);
        assertEq(e.amount, amount);
        assertEq(token.balanceOf(address(escrow)), amount);
        assertEq(token.balanceOf(alice), FUNDS - amount);
    }
}
