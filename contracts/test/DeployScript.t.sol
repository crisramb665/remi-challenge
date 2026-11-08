// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {EscrowManager} from "../src/EscrowManager.sol";
import {Deploy} from "../script/Deploy.s.sol";

/// @dev The deploy script produces a working, fresh `EscrowManager`.
contract DeployScriptTest is Test {
    function test_Run_DeploysFreshEscrowManager() public {
        EscrowManager escrow = new Deploy().run();

        assertGt(address(escrow).code.length, 0);
        assertEq(escrow.nextId(), 1);
        assertEq(escrow.CANCEL_WINDOW(), 2 hours);
        assertEq(escrow.TTL(), 7 days);
    }
}
