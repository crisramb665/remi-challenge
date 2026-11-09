// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title EscrowManager
/// @notice Holds many ERC-20 escrows between a sender and a beneficiary.
contract EscrowManager is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Lifecycle of an escrow. `None` marks an id that does not exist.
    enum Status {
        None,
        Pending,
        Released,
        Rejected,
        CancelledBySender,
        Expired
    }

    struct Escrow {
        address sender;
        uint40 createdAt;
        Status status;
        address beneficiary;
        address token;
        uint256 amount;
    }

    /// @notice Time after creation during which the sender may cancel.
    uint256 public constant CANCEL_WINDOW = 2 hours;
    /// @notice Time after creation after which the escrow expires.
    uint256 public constant TTL = 7 days;

    mapping(uint256 => Escrow) private _escrows;

    /// @notice Id assigned to the next escrow. Ids start at 1.
    uint256 public nextId = 1;

    /// @notice The amount is zero.
    error ZeroAmount();
    /// @notice The beneficiary is the zero address or the sender.
    error InvalidBeneficiary();
    /// @notice The token is the zero address or has no code.
    error InvalidToken();
    /// @notice The contract received a different amount than requested.
    error UnsupportedToken();
    /// @notice After the permit was attempted, the caller's allowance to this contract is below the amount.
    error PermitFailed();
    /// @notice No escrow exists with this id.
    /// @param id Escrow id.
    error EscrowNotFound(uint256 id);
    /// @notice The escrow already left `Pending`.
    /// @param id Escrow id.
    /// @param status Current status.
    error NotPending(uint256 id, Status status);
    /// @notice The caller is not the sender.
    /// @param id Escrow id.
    error NotSender(uint256 id);
    /// @notice The caller is not the beneficiary.
    /// @param id Escrow id.
    error NotBeneficiary(uint256 id);
    /// @notice The cancel window has closed.
    /// @param id Escrow id.
    /// @param cancelDeadline Timestamp at which the window closed.
    error CancelWindowClosed(uint256 id, uint256 cancelDeadline);
    /// @notice The escrow reached its expiry time.
    /// @param id Escrow id.
    /// @param expiresAt Expiry timestamp.
    error TtlElapsed(uint256 id, uint256 expiresAt);
    /// @notice The escrow has not reached its expiry time.
    /// @param id Escrow id.
    /// @param expiresAt Expiry timestamp.
    error NotExpiredYet(uint256 id, uint256 expiresAt);

    /// @notice Emitted when an escrow is created and funded.
    /// @param id Escrow id.
    /// @param sender Account that funded the escrow.
    /// @param beneficiary Account that can confirm or reject.
    /// @param token ERC-20 token held.
    /// @param amount Amount held.
    /// @param cancelDeadline End of the cancel window.
    /// @param expiresAt Expiry timestamp.
    event EscrowCreated(
        uint256 indexed id,
        address indexed sender,
        address indexed beneficiary,
        address token,
        uint256 amount,
        uint64 cancelDeadline,
        uint64 expiresAt
    );
    /// @notice Emitted when the sender cancels.
    /// @param id Escrow id.
    event EscrowCancelled(uint256 indexed id);
    /// @notice Emitted when the beneficiary confirms and receives the funds.
    /// @param id Escrow id.
    event EscrowReleased(uint256 indexed id);
    /// @notice Emitted when the beneficiary rejects and the sender is refunded.
    /// @param id Escrow id.
    event EscrowRejected(uint256 indexed id);
    /// @notice Emitted when the sender reclaims an expired escrow.
    /// @param id Escrow id.
    event EscrowExpired(uint256 indexed id);

    /// @notice Locks `amount` of `token` from the caller for `beneficiary`.
    /// @dev The transfer happens before the state write because the received
    /// amount must be measured. `nonReentrant` covers that window.
    /// @param token ERC-20 token to lock.
    /// @param beneficiary Account that can confirm or reject.
    /// @param amount Amount to lock. Must be received in full by this contract.
    /// @return id Id of the new escrow.
    function createEscrow(address token, address beneficiary, uint256 amount)
        external
        nonReentrant
        returns (uint256 id)
    {
        _checkCreate(token, beneficiary, amount);
        id = _deposit(token, beneficiary, amount);
    }

    /// @notice Same as `createEscrow`, but the caller approves this contract with an EIP-2612 signature
    /// instead of a separate `approve` transaction.
    /// @dev The result of `permit` is ignored on purpose and the allowance is what counts: anyone can submit
    /// the signature first, which makes the caller's own `permit` revert although the allowance is set, and a
    /// token with a fallback function but no `permit` accepts the call and does nothing. If the allowance is
    /// below `amount` afterwards the call reverts with `PermitFailed`. An allowance that already covers
    /// `amount` is enough whatever the signature. The token checks the signature, the nonce and the deadline.
    /// @param token ERC-20 token to lock. Should implement EIP-2612.
    /// @param beneficiary Account that can confirm or reject.
    /// @param amount Amount to lock. Must be received in full by this contract.
    /// @param deadline Time until which the signature is valid.
    /// @param v Recovery id of the caller's signature over a permit for `amount`.
    /// @param r First half of the signature.
    /// @param s Second half of the signature.
    /// @return id Id of the new escrow.
    function createEscrowWithPermit(
        address token,
        address beneficiary,
        uint256 amount,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant returns (uint256 id) {
        _checkCreate(token, beneficiary, amount);
        _permit(token, amount, deadline, v, r, s);
        id = _deposit(token, beneficiary, amount);
    }

    /// @dev The checks both create functions run before the token is called, in this order.
    function _checkCreate(address token, address beneficiary, uint256 amount) private view {
        if (amount == 0) revert ZeroAmount();
        if (beneficiary == address(0) || beneficiary == msg.sender) revert InvalidBeneficiary();
        if (token == address(0) || token.code.length == 0) revert InvalidToken();
    }

    /// @dev Attempts the permit for exactly `amount` and requires the allowance it should have created.
    function _permit(address token, uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s) private {
        try IERC20Permit(token).permit(msg.sender, address(this), amount, deadline, v, r, s) {} catch {}
        if (IERC20(token).allowance(msg.sender, address(this)) < amount) revert PermitFailed();
    }

    /// @dev Pulls `amount` from the caller, checks that all of it arrived, and stores the escrow. Used by both
    /// create functions, so the deposit logic exists once.
    function _deposit(address token, address beneficiary, uint256 amount) private returns (uint256 id) {
        uint256 balanceBefore = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        if (IERC20(token).balanceOf(address(this)) - balanceBefore != amount) {
            revert UnsupportedToken();
        }

        id = nextId++;
        // casting to 'uint40' is safe because block timestamps fit in 40 bits for millennia
        // forge-lint: disable-next-line(unsafe-typecast)
        uint40 createdAt = uint40(block.timestamp);
        _escrows[id] = Escrow({
            sender: msg.sender,
            createdAt: createdAt,
            status: Status.Pending,
            beneficiary: beneficiary,
            token: token,
            amount: amount
        });

        // casting to 'uint64' is safe because createdAt is uint40 and the constants are small
        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 cancelDeadline = uint64(createdAt + CANCEL_WINDOW);
        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 expiresAt = uint64(createdAt + TTL);
        emit EscrowCreated(id, msg.sender, beneficiary, token, amount, cancelDeadline, expiresAt);
    }

    /// @notice Cancels a pending escrow and refunds the sender.
    /// @dev Only the sender, strictly before `createdAt + CANCEL_WINDOW`.
    /// @param id Escrow id.
    function cancel(uint256 id) external nonReentrant {
        Escrow storage e = _pending(id);
        if (msg.sender != e.sender) revert NotSender(id);
        uint256 cancelDeadline = e.createdAt + CANCEL_WINDOW;
        if (block.timestamp >= cancelDeadline) revert CancelWindowClosed(id, cancelDeadline);

        e.status = Status.CancelledBySender;
        emit EscrowCancelled(id);
        IERC20(e.token).safeTransfer(e.sender, e.amount);
    }

    /// @notice Releases a pending escrow to the beneficiary.
    /// @dev Only the beneficiary, strictly before `createdAt + TTL`. Allowed during the cancel window.
    /// @param id Escrow id.
    function confirm(uint256 id) external nonReentrant {
        Escrow storage e = _pendingForBeneficiary(id);

        e.status = Status.Released;
        emit EscrowReleased(id);
        IERC20(e.token).safeTransfer(e.beneficiary, e.amount);
    }

    /// @notice Rejects a pending escrow and refunds the sender.
    /// @dev Only the beneficiary, strictly before `createdAt + TTL`. Allowed during the cancel window.
    /// @param id Escrow id.
    function reject(uint256 id) external nonReentrant {
        Escrow storage e = _pendingForBeneficiary(id);

        e.status = Status.Rejected;
        emit EscrowRejected(id);
        IERC20(e.token).safeTransfer(e.sender, e.amount);
    }

    /// @notice Refunds the sender of an escrow that reached its expiry time.
    /// @dev Only the sender, from `createdAt + TTL` onwards.
    /// @param id Escrow id.
    function reclaimExpired(uint256 id) external nonReentrant {
        Escrow storage e = _pending(id);
        if (msg.sender != e.sender) revert NotSender(id);
        uint256 expiresAt = e.createdAt + TTL;
        if (block.timestamp < expiresAt) revert NotExpiredYet(id, expiresAt);

        e.status = Status.Expired;
        emit EscrowExpired(id);
        IERC20(e.token).safeTransfer(e.sender, e.amount);
    }

    /// @notice Returns an escrow and its derived deadlines.
    /// @param id Escrow id.
    /// @return escrow Stored fields.
    /// @return cancelDeadline `createdAt + CANCEL_WINDOW`.
    /// @return expiresAt `createdAt + TTL`.
    function getEscrow(uint256 id)
        external
        view
        returns (Escrow memory escrow, uint64 cancelDeadline, uint64 expiresAt)
    {
        escrow = _escrows[id];
        if (escrow.status == Status.None) revert EscrowNotFound(id);
        // casting to 'uint64' is safe because createdAt is uint40 and the constants are small
        // forge-lint: disable-next-line(unsafe-typecast)
        cancelDeadline = uint64(escrow.createdAt + CANCEL_WINDOW);
        // forge-lint: disable-next-line(unsafe-typecast)
        expiresAt = uint64(escrow.createdAt + TTL);
    }

    /// @dev Loads an escrow that exists and is `Pending`. Covers the first two checks of every resolution.
    function _pending(uint256 id) private view returns (Escrow storage e) {
        e = _escrows[id];
        if (e.status == Status.None) revert EscrowNotFound(id);
        if (e.status != Status.Pending) revert NotPending(id, e.status);
    }

    /// @dev `_pending` plus the beneficiary and TTL checks shared by `confirm` and `reject`.
    function _pendingForBeneficiary(uint256 id) private view returns (Escrow storage e) {
        e = _pending(id);
        if (msg.sender != e.beneficiary) revert NotBeneficiary(id);
        uint256 expiresAt = e.createdAt + TTL;
        if (block.timestamp >= expiresAt) revert TtlElapsed(id, expiresAt);
    }
}
