import { parseAbi } from 'viem';

/**
 * The events the indexer reads, copied from SPEC section 2.7 and `EscrowManager.sol`. If an event
 * changes in the contract this must change too; `decode.spec.ts` pins the signatures.
 */
export const escrowEvents = parseAbi([
  'event EscrowCreated(uint256 indexed id, address indexed sender, address indexed beneficiary, address token, uint256 amount, uint64 cancelDeadline, uint64 expiresAt)',
  'event EscrowCancelled(uint256 indexed id)',
  'event EscrowReleased(uint256 indexed id)',
  'event EscrowRejected(uint256 indexed id)',
  'event EscrowExpired(uint256 indexed id)',
]);
