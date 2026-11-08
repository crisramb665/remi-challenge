// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {EscrowManager} from "../src/EscrowManager.sol";

/// @notice Deploys `EscrowManager`. The deployer is the account `forge script` broadcasts from, so no key lives
/// in the repository. Against Anvil use its first default account, for example:
///
///   forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast --unlocked \
///     --sender 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
///
/// The contract address and the exact deploy block are read from the file forge writes at
/// `broadcast/Deploy.s.sol/<chainId>/run-latest.json`: `.transactions[0].contractAddress` and
/// `.receipts[0].blockNumber` (hex).
contract Deploy is Script {
    function run() external returns (EscrowManager escrow) {
        vm.startBroadcast();
        escrow = new EscrowManager();
        vm.stopBroadcast();

        console.log("EscrowManager deployed at", address(escrow));
    }
}
