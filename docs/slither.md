# Slither findings

Static analysis of `contracts/src` with Slither. Every finding is triaged below.

## Run

* Date: 2026-11-07
* Slither `0.11.6`, Solidity `0.8.24`, OpenZeppelin `v5.6.1`
* Command, from `contracts/`:

```
slither . --filter-paths "lib/|test/|script/"
```

* Scope: `src/EscrowManager.sol`. The OpenZeppelin library in `lib/` is excluded because it is audited upstream and we use it as installed. Tests and scripts are excluded because they are not deployed.
* Result: 102 detectors, 7 contracts analyzed, 5 results from 2 detectors. No finding needs a code change.

## Triage

| # | Detector | Location | Verdict |
| --- | --- | --- | --- |
| 1 | `incorrect-equality` | `getEscrow`: `escrow.status == Status.None` | False positive |
| 2 | `timestamp` | `cancel`: `block.timestamp >= cancelDeadline` | Accepted, by design |
| 3 | `timestamp` | `reclaimExpired`: `block.timestamp < expiresAt` | Accepted, by design |
| 4 | `timestamp` | `_pendingForBeneficiary` (used by `confirm` and `reject`): `block.timestamp >= expiresAt` | Accepted, by design |
| 5 | `timestamp` | `getEscrow`: `escrow.status == Status.None` | False positive |

### 1 and 5: `escrow.status == Status.None` in `getEscrow`

Slither warns about strict equality because it can be broken by sending a token amount to a contract (the "balance equality" pattern). That is not what this is. The comparison is between an enum and its zero value, and it is how SPEC §2.2 detects an id that does not exist: `None` is the zero value, so a missing id needs no extra mapping. No balance or amount is compared, and nobody can change the status of an escrow other than through the functions in SPEC §2.3. Finding 5 flags the same line under the `timestamp` detector, because the function also reads `createdAt`; it does not compare any time value.

Action: none.

### 2, 3 and 4: `block.timestamp` comparisons

The time rules are the product: the 2 hour cancel window and the 7 day TTL (SPEC §2.3). Slither flags any comparison that uses `block.timestamp`. A block producer can shift a timestamp by a few seconds at most, and the windows are hours and days, so the practical effect is that an action near a boundary may land one block earlier or later. The strict and inclusive comparisons are chosen so that at exactly `E` only `reclaimExpired` succeeds, with no gap and no overlap. The boundary tests (`D - 1`, `D`, `E - 1`, `E`) pin this down for every time dependent function.

Action: none. Accepted as a known property of any time based protocol, as noted in SPEC §4.1.

## Detectors that reported nothing

No findings for reentrancy, unchecked transfers, arbitrary `send` or `transferFrom`, uninitialized state, shadowing or access control. This matches the design: `ReentrancyGuard` on every state changing function, `SafeERC20` for every transfer, status written before any outbound transfer, and no privileged roles.

## Re-running

Run the command above after any change to `contracts/src`. A new finding needs a row in the table with a verdict before the change is accepted.
