// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @dev ERC-20 with EIP-2612 `permit` and a public mint, for tests only.
contract MockPermitERC20 is ERC20, ERC20Permit {
    constructor() ERC20("Permit", "PRM") ERC20Permit("Permit") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
