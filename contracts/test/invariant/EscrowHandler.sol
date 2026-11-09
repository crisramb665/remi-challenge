// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {EscrowManager} from "../../src/EscrowManager.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockPermitERC20} from "../mocks/MockPermitERC20.sol";
import {PermitDigest} from "../utils/PermitDigest.sol";

/// @dev Fuzzing entry point for the invariant tests. It creates escrows, with `createEscrow` and with
/// `createEscrowWithPermit`, and tries to resolve them with random actors, amounts and time jumps, and records
/// what each successful resolution paid out. It never sends tokens to the escrow contract directly, so the
/// contract balance can be compared exactly with the pending amounts.
contract EscrowHandler is Test {
    enum Action {
        Cancel,
        Confirm,
        Reject,
        Reclaim
    }

    uint256 internal constant MAX_AMOUNT = 1_000_000e18;

    EscrowManager public escrow;
    MockERC20 public tokenA;
    MockERC20 public tokenB;
    /// @dev The token used by the permit creation path.
    MockPermitERC20 public tokenP;

    address[] internal _actors;
    /// @dev Private key of each actor, in the same order, so the handler can sign permits for them.
    uint256[] internal _actorKeys;

    // Ghost state, filled when the handler itself resolves an escrow.
    mapping(uint256 => bool) public resolved;
    mapping(uint256 => EscrowManager.Status) public finalStatus;
    mapping(uint256 => uint256) public paidToBeneficiary;
    mapping(uint256 => uint256) public refundedToSender;
    bool public resolvedTwice;
    // Successful resolutions per outcome. Failed attempts are caught on purpose, so the fuzzer's own
    // "reverts" column cannot tell whether an action ever succeeded; these counters can.
    mapping(EscrowManager.Status => uint256) public resolutionsByStatus;
    // Escrows created through `createEscrowWithPermit`, to show the fuzzer reaches that path.
    uint256 public createdWithPermit;

    constructor(EscrowManager escrow_, MockERC20 tokenA_, MockERC20 tokenB_, MockPermitERC20 tokenP_) {
        escrow = escrow_;
        tokenA = tokenA_;
        tokenB = tokenB_;
        tokenP = tokenP_;
        for (uint256 i = 0; i < 3; i++) {
            (address actor, uint256 key) = makeAddrAndKey(string.concat("actor", vm.toString(i)));
            _actors.push(actor);
            _actorKeys.push(key);
        }
    }

    function create(uint256 senderSeed, uint256 beneficiarySeed, uint256 tokenSeed, uint256 amount) external {
        uint256 senderIndex = senderSeed % _actors.length;
        address sender = _actors[senderIndex];
        // Any actor except the sender.
        address beneficiary = _actors[(senderIndex + 1 + (beneficiarySeed % (_actors.length - 1))) % _actors.length];
        MockERC20 token = tokenSeed % 2 == 0 ? tokenA : tokenB;
        amount = bound(amount, 1, MAX_AMOUNT);

        token.mint(sender, amount);
        vm.prank(sender);
        token.approve(address(escrow), amount);
        vm.prank(sender);
        escrow.createEscrow(address(token), beneficiary, amount);
    }

    /// @dev Like `create`, but the sender approves with a signed permit and the escrow is made by
    /// `createEscrowWithPermit`, always with the permit token.
    function createWithPermit(uint256 senderSeed, uint256 beneficiarySeed, uint256 amount) external {
        uint256 senderIndex = senderSeed % _actors.length;
        address beneficiary = _actors[(senderIndex + 1 + (beneficiarySeed % (_actors.length - 1))) % _actors.length];
        amount = bound(amount, 1, MAX_AMOUNT);

        tokenP.mint(_actors[senderIndex], amount);
        _createWithPermit(senderIndex, beneficiary, amount);
        createdWithPermit++;
    }

    function cancel(uint256 idSeed, uint256 callerSeed) external {
        _attempt(idSeed, callerSeed, Action.Cancel);
    }

    function confirm(uint256 idSeed, uint256 callerSeed) external {
        _attempt(idSeed, callerSeed, Action.Confirm);
    }

    function reject(uint256 idSeed, uint256 callerSeed) external {
        _attempt(idSeed, callerSeed, Action.Reject);
    }

    function reclaim(uint256 idSeed, uint256 callerSeed) external {
        _attempt(idSeed, callerSeed, Action.Reclaim);
    }

    /// @dev Moves time forward. A third of the jumps are under 1 hour, a third under 3 days and a third under
    /// 8 days, so the 2 hour cancel window, the 7 day TTL and the span between them are all reachable.
    function warp(uint256 secs) external {
        uint256 bucket = secs % 3;
        uint256 maxJump = bucket == 0 ? 1 hours : bucket == 1 ? 3 days : 8 days;
        vm.warp(block.timestamp + bound(secs, 0, maxJump));
    }

    /// @dev Signs a permit for `amount` as actor `index` and creates the escrow with it. Kept apart from
    /// `createWithPermit` so neither function holds too many variables.
    function _createWithPermit(uint256 index, address beneficiary, uint256 amount) private {
        address sender = _actors[index];
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(_actorKeys[index], PermitDigest.digest(tokenP, sender, address(escrow), amount, deadline));

        vm.prank(sender);
        escrow.createEscrowWithPermit(address(tokenP), beneficiary, amount, deadline, v, r, s);
    }

    /// @dev Tries an action. Three times out of four the caller is the legitimate party and the target is a
    /// pending escrow, so the success paths are reached often. The rest are random, to exercise wrong callers
    /// and already resolved escrows. Wrong callers, wrong times and resolved escrows revert and change nothing.
    function _attempt(uint256 idSeed, uint256 callerSeed, Action action) private {
        uint256 count = escrow.nextId() - 1;
        if (count == 0) return;
        uint256 id = _pickId(idSeed, count);

        (EscrowManager.Escrow memory before_,,) = escrow.getEscrow(id);
        address caller = callerSeed % 4 == 0
            ? _actors[(callerSeed / 4) % _actors.length]
            : (action == Action.Cancel || action == Action.Reclaim ? before_.sender : before_.beneficiary);
        MockERC20 token = MockERC20(before_.token);
        uint256 beneficiaryBefore = token.balanceOf(before_.beneficiary);
        uint256 senderBefore = token.balanceOf(before_.sender);

        vm.prank(caller);
        if (!_call(id, action)) return;

        if (resolved[id]) resolvedTwice = true;
        (EscrowManager.Escrow memory current,,) = escrow.getEscrow(id);
        resolved[id] = true;
        finalStatus[id] = current.status;
        resolutionsByStatus[current.status]++;
        paidToBeneficiary[id] = token.balanceOf(before_.beneficiary) - beneficiaryBefore;
        refundedToSender[id] = token.balanceOf(before_.sender) - senderBefore;
    }

    /// @dev One pick in four is the raw id, which may be resolved already. The others move on, wrapping around,
    /// to the first escrow that is still pending.
    function _pickId(uint256 idSeed, uint256 count) private view returns (uint256 id) {
        id = bound(idSeed, 1, count);
        if (idSeed % 4 == 0) return id;
        for (uint256 i = 0; i < count; i++) {
            uint256 candidate = ((id - 1 + i) % count) + 1;
            (EscrowManager.Escrow memory e,,) = escrow.getEscrow(candidate);
            if (e.status == EscrowManager.Status.Pending) return candidate;
        }
    }

    function _call(uint256 id, Action action) private returns (bool) {
        if (action == Action.Cancel) {
            try escrow.cancel(id) {
                return true;
            } catch {
                return false;
            }
        }
        if (action == Action.Confirm) {
            try escrow.confirm(id) {
                return true;
            } catch {
                return false;
            }
        }
        if (action == Action.Reject) {
            try escrow.reject(id) {
                return true;
            } catch {
                return false;
            }
        }
        try escrow.reclaimExpired(id) {
            return true;
        } catch {
            return false;
        }
    }
}
