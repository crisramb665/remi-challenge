// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev ERC-20 with no `permit` but a fallback function that accepts any other call, as WETH9 does, so a call to
/// `permit` succeeds and does nothing. For tests only.
contract MockFallbackERC20 is ERC20 {
    constructor() ERC20("Fallback", "FALL") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    fallback() external {}
}
