// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev ERC-20 that, once armed, calls back into a target during the next transfer and bubbles up any revert.
/// For tests only.
contract MockReentrantERC20 is ERC20 {
    address public target;
    bytes public payload;

    constructor() ERC20("Reentrant", "REENT") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @dev The next transfer between two accounts runs `payload_` against `target_` first. It fires only once.
    function arm(address target_, bytes calldata payload_) external {
        target = target_;
        payload = payload_;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (target != address(0) && from != address(0) && to != address(0)) {
            address callee = target;
            target = address(0);
            (bool ok, bytes memory ret) = callee.call(payload);
            if (!ok) {
                assembly ("memory-safe") {
                    revert(add(ret, 0x20), mload(ret))
                }
            }
        }
        super._update(from, to, value);
    }
}
