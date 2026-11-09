// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EscrowManager} from "../src/EscrowManager.sol";
import {EscrowFixture} from "./utils/EscrowFixture.sol";
import {PermitDigest} from "./utils/PermitDigest.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockPermitERC20} from "./mocks/MockPermitERC20.sol";
import {MockFallbackERC20} from "./mocks/MockFallbackERC20.sol";
import {MockFeeOnTransferERC20} from "./mocks/MockFeeOnTransferERC20.sol";
import {MockReentrantERC20} from "./mocks/MockReentrantERC20.sol";

/// @dev `createEscrowWithPermit` (SPEC §2.3 to §2.5). The sender is `signer`, who holds a key so it can sign, and
/// the beneficiary is bob. The permit token starts without any allowance.
contract CreateEscrowWithPermitTest is EscrowFixture {
    struct Permit {
        uint256 deadline;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    MockPermitERC20 internal pToken;
    address internal signer;
    uint256 internal signerKey;

    function setUp() public override {
        super.setUp();
        pToken = new MockPermitERC20();
        (signer, signerKey) = makeAddrAndKey("signer");
        pToken.mint(signer, FUNDS);
    }

    /// @dev A valid signature by `key` over a permit of `amount` for the escrow contract, for the current nonce.
    function _permit(uint256 key, address owner, uint256 amount, uint256 deadline)
        internal
        view
        returns (Permit memory p)
    {
        (p.v, p.r, p.s) = vm.sign(key, PermitDigest.digest(pToken, owner, address(escrow), amount, deadline));
        p.deadline = deadline;
    }

    /// @dev A signature that no token accepts.
    function _garbage() internal view returns (Permit memory) {
        return Permit({deadline: block.timestamp + 1 hours, v: 27, r: bytes32(uint256(1)), s: bytes32(uint256(2))});
    }

    function _createWithPermit(address from, address token_, address beneficiary, uint256 amount, Permit memory p)
        internal
        returns (uint256)
    {
        vm.prank(from);
        return escrow.createEscrowWithPermit(token_, beneficiary, amount, p.deadline, p.v, p.r, p.s);
    }

    // ---------------------------------------------------------------------------------------------
    // Happy path
    // ---------------------------------------------------------------------------------------------

    function test_CreateWithPermit_StoresEscrowAndMovesFunds() public {
        Permit memory p = _permit(signerKey, signer, AMOUNT, block.timestamp + 1 hours);

        uint256 id = _createWithPermit(signer, address(pToken), bob, AMOUNT, p);

        assertEq(id, 1);
        assertEq(escrow.nextId(), 2);
        (EscrowManager.Escrow memory e,,) = escrow.getEscrow(id);
        assertEq(e.sender, signer);
        assertEq(e.beneficiary, bob);
        assertEq(e.token, address(pToken));
        assertEq(e.amount, AMOUNT);
        assertEq(uint8(e.status), uint8(EscrowManager.Status.Pending));
        assertEq(uint256(e.createdAt), block.timestamp);
        assertEq(pToken.balanceOf(signer), FUNDS - AMOUNT);
        assertEq(pToken.balanceOf(address(escrow)), AMOUNT);
    }

    function test_CreateWithPermit_ConsumesTheNonceAndLeavesNoAllowance() public {
        Permit memory p = _permit(signerKey, signer, AMOUNT, block.timestamp + 1 hours);

        _createWithPermit(signer, address(pToken), bob, AMOUNT, p);

        assertEq(pToken.nonces(signer), 1);
        assertEq(pToken.allowance(signer, address(escrow)), 0);
    }

    function test_CreateWithPermit_EmitsEscrowCreated() public {
        Permit memory p = _permit(signerKey, signer, AMOUNT, block.timestamp + 1 hours);
        uint64 cancelDeadline = uint64(block.timestamp + escrow.CANCEL_WINDOW());
        uint64 expiresAt = uint64(block.timestamp + escrow.TTL());

        vm.expectEmit(true, true, true, true, address(escrow));
        emit EscrowManager.EscrowCreated(1, signer, bob, address(pToken), AMOUNT, cancelDeadline, expiresAt);
        _createWithPermit(signer, address(pToken), bob, AMOUNT, p);
    }

    function test_CreateWithPermit_AcceptsADeadlineEqualToNow() public {
        Permit memory p = _permit(signerKey, signer, AMOUNT, block.timestamp);

        assertEq(_createWithPermit(signer, address(pToken), bob, AMOUNT, p), 1);
    }

    function test_CreateWithPermit_CreatesTheSameEscrowAsCreateEscrow() public {
        vm.prank(signer);
        pToken.approve(address(escrow), AMOUNT);
        vm.prank(signer);
        uint256 plainId = escrow.createEscrow(address(pToken), bob, AMOUNT);

        Permit memory p = _permit(signerKey, signer, AMOUNT, block.timestamp);
        uint256 permitId = _createWithPermit(signer, address(pToken), bob, AMOUNT, p);

        assertEq(permitId, plainId + 1);
        (EscrowManager.Escrow memory a, uint64 aCancel, uint64 aExpiry) = escrow.getEscrow(plainId);
        (EscrowManager.Escrow memory b, uint64 bCancel, uint64 bExpiry) = escrow.getEscrow(permitId);
        assertEq(abi.encode(a, aCancel, aExpiry), abi.encode(b, bCancel, bExpiry));
    }

    function test_CreateWithPermit_EscrowCanBeConfirmedByTheBeneficiary() public {
        Permit memory p = _permit(signerKey, signer, AMOUNT, block.timestamp + 1 hours);
        uint256 id = _createWithPermit(signer, address(pToken), bob, AMOUNT, p);

        vm.prank(bob);
        escrow.confirm(id);

        assertEq(pToken.balanceOf(bob), AMOUNT);
        assertEq(pToken.balanceOf(address(escrow)), 0);
        _assertStatus(id, EscrowManager.Status.Released);
    }

    function testFuzz_CreateWithPermit_LocksExactAmount(uint256 amount) public {
        amount = bound(amount, 1, FUNDS);
        Permit memory p = _permit(signerKey, signer, amount, block.timestamp + 1 hours);

        uint256 id = _createWithPermit(signer, address(pToken), bob, amount, p);

        (EscrowManager.Escrow memory e,,) = escrow.getEscrow(id);
        assertEq(e.amount, amount);
        assertEq(pToken.balanceOf(address(escrow)), amount);
        assertEq(pToken.allowance(signer, address(escrow)), 0);
    }

    // ---------------------------------------------------------------------------------------------
    // The permit
    // ---------------------------------------------------------------------------------------------

    function test_CreateWithPermit_RevertsOnExpiredDeadline() public {
        vm.warp(1_000_000);
        Permit memory p = _permit(signerKey, signer, AMOUNT, block.timestamp - 1);

        vm.expectRevert(EscrowManager.PermitFailed.selector);
        _createWithPermit(signer, address(pToken), bob, AMOUNT, p);

        assertEq(escrow.nextId(), 1);
    }

    function test_CreateWithPermit_RevertsOnWrongSigner() public {
        (, uint256 otherKey) = makeAddrAndKey("other");
        Permit memory p = _permit(otherKey, signer, AMOUNT, block.timestamp + 1 hours);

        vm.expectRevert(EscrowManager.PermitFailed.selector);
        _createWithPermit(signer, address(pToken), bob, AMOUNT, p);
    }

    function test_CreateWithPermit_RevertsWhenTheSignatureIsForAnotherAmount() public {
        Permit memory p = _permit(signerKey, signer, AMOUNT - 1, block.timestamp + 1 hours);

        vm.expectRevert(EscrowManager.PermitFailed.selector);
        _createWithPermit(signer, address(pToken), bob, AMOUNT, p);
    }

    function test_CreateWithPermit_RevertsOnReplayedSignature() public {
        Permit memory p = _permit(signerKey, signer, AMOUNT, block.timestamp + 1 hours);
        _createWithPermit(signer, address(pToken), bob, AMOUNT, p);

        vm.expectRevert(EscrowManager.PermitFailed.selector);
        _createWithPermit(signer, address(pToken), bob, AMOUNT, p);

        assertEq(escrow.nextId(), 2);
    }

    /// @dev Someone submits the signature first. The signer's own permit call then reverts (the nonce is used),
    /// but the allowance is already set, so the escrow is still created.
    function test_CreateWithPermit_SucceedsWhenSomeoneSubmittedTheSignatureFirst() public {
        Permit memory p = _permit(signerKey, signer, AMOUNT, block.timestamp + 1 hours);
        vm.prank(makeAddr("attacker"));
        pToken.permit(signer, address(escrow), AMOUNT, p.deadline, p.v, p.r, p.s);
        assertEq(pToken.allowance(signer, address(escrow)), AMOUNT);

        uint256 id = _createWithPermit(signer, address(pToken), bob, AMOUNT, p);

        assertEq(id, 1);
        assertEq(pToken.balanceOf(address(escrow)), AMOUNT);
    }

    // ---------------------------------------------------------------------------------------------
    // Tokens without a working permit
    // ---------------------------------------------------------------------------------------------

    function test_CreateWithPermit_RevertsOnTokenWithoutPermit() public {
        MockERC20 plain = new MockERC20();
        plain.mint(signer, FUNDS);

        vm.expectRevert(EscrowManager.PermitFailed.selector);
        _createWithPermit(signer, address(plain), bob, AMOUNT, _garbage());
    }

    /// @dev The call to `permit` hits the fallback function and succeeds without approving anything.
    function test_CreateWithPermit_RevertsOnTokenWithAFallbackFunction() public {
        MockFallbackERC20 fallbackToken = new MockFallbackERC20();
        fallbackToken.mint(signer, FUNDS);

        vm.expectRevert(EscrowManager.PermitFailed.selector);
        _createWithPermit(signer, address(fallbackToken), bob, AMOUNT, _garbage());

        assertEq(fallbackToken.balanceOf(address(escrow)), 0);
    }

    function test_CreateWithPermit_UsesAnExistingAllowanceWithoutAValidSignature() public {
        vm.prank(signer);
        pToken.approve(address(escrow), AMOUNT);

        uint256 id = _createWithPermit(signer, address(pToken), bob, AMOUNT, _garbage());

        assertEq(id, 1);
        assertEq(pToken.balanceOf(address(escrow)), AMOUNT);
    }

    function test_CreateWithPermit_RevertsWhenTheExistingAllowanceIsOneShort() public {
        vm.prank(signer);
        pToken.approve(address(escrow), AMOUNT - 1);

        vm.expectRevert(EscrowManager.PermitFailed.selector);
        _createWithPermit(signer, address(pToken), bob, AMOUNT, _garbage());
    }

    function test_CreateWithPermit_WorksOnATokenWithoutPermitWhenTheAllowanceExists() public {
        // alice approved the escrow contract for `token` in the fixture.
        vm.prank(alice);
        uint256 id = escrow.createEscrowWithPermit(address(token), bob, AMOUNT, 0, 0, bytes32(0), bytes32(0));

        assertEq(id, 1);
        assertEq(token.balanceOf(address(escrow)), AMOUNT);
    }

    function test_CreateWithPermit_RevertsOnFeeOnTransferToken() public {
        MockFeeOnTransferERC20 feeToken = new MockFeeOnTransferERC20();
        feeToken.mint(signer, FUNDS);
        vm.prank(signer);
        feeToken.approve(address(escrow), AMOUNT);

        vm.expectRevert(EscrowManager.UnsupportedToken.selector);
        _createWithPermit(signer, address(feeToken), bob, AMOUNT, _garbage());

        assertEq(escrow.nextId(), 1);
    }

    // ---------------------------------------------------------------------------------------------
    // Validation happens before the token is called, in the same order as createEscrow
    // ---------------------------------------------------------------------------------------------

    function test_CreateWithPermit_RevertsOnZeroAmount() public {
        vm.expectRevert(EscrowManager.ZeroAmount.selector);
        _createWithPermit(signer, address(pToken), bob, 0, _garbage());
    }

    function test_CreateWithPermit_RevertsOnInvalidBeneficiary() public {
        vm.expectRevert(EscrowManager.InvalidBeneficiary.selector);
        _createWithPermit(signer, address(pToken), address(0), AMOUNT, _garbage());

        vm.expectRevert(EscrowManager.InvalidBeneficiary.selector);
        _createWithPermit(signer, address(pToken), signer, AMOUNT, _garbage());
    }

    /// @dev For an address with no code, calling `permit` would revert in the caller and the revert could not be
    /// caught, so the token check has to run first.
    function test_CreateWithPermit_RevertsOnInvalidToken() public {
        vm.expectRevert(EscrowManager.InvalidToken.selector);
        _createWithPermit(signer, address(0), bob, AMOUNT, _garbage());

        vm.expectRevert(EscrowManager.InvalidToken.selector);
        _createWithPermit(signer, makeAddr("eoa"), bob, AMOUNT, _garbage());
    }

    function test_CreateWithPermit_ChecksAmountBeforeBeneficiaryBeforeToken() public {
        vm.expectRevert(EscrowManager.ZeroAmount.selector);
        _createWithPermit(signer, address(0), address(0), 0, _garbage());

        vm.expectRevert(EscrowManager.InvalidBeneficiary.selector);
        _createWithPermit(signer, address(0), address(0), AMOUNT, _garbage());
    }

    // ---------------------------------------------------------------------------------------------
    // Reentrancy
    // ---------------------------------------------------------------------------------------------

    function test_CreateWithPermit_BlocksReentrantCreateEscrow() public {
        MockReentrantERC20 rToken = new MockReentrantERC20();
        rToken.mint(signer, FUNDS);
        vm.prank(signer);
        rToken.approve(address(escrow), AMOUNT);
        rToken.arm(address(escrow), abi.encodeCall(escrow.createEscrow, (address(rToken), bob, 1)));

        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        _createWithPermit(signer, address(rToken), bob, AMOUNT, _garbage());

        assertEq(escrow.nextId(), 1);
        assertEq(rToken.balanceOf(address(escrow)), 0);
    }

    function test_CreateWithPermit_BlocksReentrantCreateWithPermit() public {
        MockReentrantERC20 rToken = new MockReentrantERC20();
        rToken.mint(signer, FUNDS);
        vm.prank(signer);
        rToken.approve(address(escrow), AMOUNT);
        rToken.arm(
            address(escrow),
            abi.encodeCall(
                escrow.createEscrowWithPermit, (address(rToken), bob, 1, block.timestamp, 27, bytes32(0), bytes32(0))
            )
        );

        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        _createWithPermit(signer, address(rToken), bob, AMOUNT, _garbage());

        assertEq(escrow.nextId(), 1);
    }
}
