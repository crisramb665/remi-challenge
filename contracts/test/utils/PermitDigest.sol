// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {MockPermitERC20} from "../mocks/MockPermitERC20.sol";

/// @dev The EIP-712 digest a holder signs to approve a spender through `permit`. The caller signs it with
/// `vm.sign`, so this library needs no cheatcodes.
library PermitDigest {
    bytes32 internal constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    /// @dev Digest for the holder's current nonce.
    function digest(MockPermitERC20 token, address owner, address spender, uint256 value, uint256 deadline)
        internal
        view
        returns (bytes32)
    {
        bytes32 structHash =
            keccak256(abi.encode(PERMIT_TYPEHASH, owner, spender, value, token.nonces(owner), deadline));
        return keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash));
    }
}
