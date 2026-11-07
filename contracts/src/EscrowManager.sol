// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title EscrowManager
/// @notice Holds many ERC-20 escrows between a sender and a beneficiary.
contract EscrowManager is ReentrancyGuard {
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
    /// @notice The token is the zero address.
    error InvalidToken();
    /// @notice The contract received a different amount than requested.
    error UnsupportedToken();
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
}
