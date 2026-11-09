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

Re-run on 2026-11-09, after `createEscrowWithPermit` was added (task T-12), with the command of the CI job (the two detectors triaged above left out): 100 detectors, 8 contracts analyzed, 1 new result, `reentrancy-benign`, triaged as finding 6. The five findings above are about code that did not change.

## Triage

| # | Detector | Location | Verdict |
| --- | --- | --- | --- |
| 1 | `incorrect-equality` | `getEscrow`: `escrow.status == Status.None` | False positive |
| 2 | `timestamp` | `cancel`: `block.timestamp >= cancelDeadline` | Accepted, by design |
| 3 | `timestamp` | `reclaimExpired`: `block.timestamp < expiresAt` | Accepted, by design |
| 4 | `timestamp` | `_pendingForBeneficiary` (used by `confirm` and `reject`): `block.timestamp >= expiresAt` | Accepted, by design |
| 5 | `timestamp` | `getEscrow`: `escrow.status == Status.None` | False positive |
| 6 | `reentrancy-benign` | `createEscrowWithPermit`: state written after the external call to the token's `permit` | Accepted, guarded |

### 1 and 5: `escrow.status == Status.None` in `getEscrow`

Slither warns about strict equality because it can be broken by sending a token amount to a contract (the "balance equality" pattern). That is not what this is. The comparison is between an enum and its zero value, and it is how SPEC §2.2 detects an id that does not exist: `None` is the zero value, so a missing id needs no extra mapping. No balance or amount is compared, and nobody can change the status of an escrow other than through the functions in SPEC §2.3. Finding 5 flags the same line under the `timestamp` detector, because the function also reads `createdAt`; it does not compare any time value.

Action: none.

### 2, 3 and 4: `block.timestamp` comparisons

The time rules are the product: the 2 hour cancel window and the 7 day TTL (SPEC §2.3). Slither flags any comparison that uses `block.timestamp`. A block producer can shift a timestamp by a few seconds at most, and the windows are hours and days, so the practical effect is that an action near a boundary may land one block earlier or later. The strict and inclusive comparisons are chosen so that at exactly `E` only `reclaimExpired` succeeds, with no gap and no overlap. The boundary tests (`D - 1`, `D`, `E - 1`, `E`) pin this down for every time dependent function.

Action: none. Accepted as a known property of any time based protocol, as noted in SPEC §4.1.

### 6: `reentrancy-benign` in `createEscrowWithPermit`

Slither reports that `createEscrowWithPermit` calls `permit` on the token (through `_permit`) and then writes `_escrows[id]` and `nextId` (in `_deposit`). That is true, and it cannot be avoided: the deposit logic has to measure the amount received before it writes (SPEC §2.6), and the token is chosen by the caller.

Why it is benign:

* Every state changing function is `nonReentrant`, including this one. During the call to `permit` the token cannot re-enter `createEscrow`, `createEscrowWithPermit`, `cancel`, `confirm`, `reject` or `reclaimExpired`; the call would revert with `ReentrancyGuardReentrantCall`. Two tests prove it from this entry point: `test_CreateWithPermit_BlocksReentrantCreateEscrow` and `test_CreateWithPermit_BlocksReentrantCreateWithPermit`.
* The only functions the token can call during `permit` are views (`getEscrow`, `nextId` and the constants), which change nothing. The one thing a view could show is the state before the pending write. Nothing in this contract or in the API reads state in the middle of a token call.
* Funds are never at risk from this ordering: payouts use the amount stored in the escrow, and a token only affects the escrows made with that token.

Slither did not report the same ordering for the token calls of `createEscrow` (`balanceOf` and `safeTransferFrom` before the write); the reasoning above applies to those calls as well.

Action: none in the contract. The detector `reentrancy-benign` is left out of the CI job, see "In CI".

## Detectors that reported nothing

Apart from finding 6, no findings for reentrancy (`reentrancy-eth`, `reentrancy-no-eth` and `reentrancy-events` stay silent), unchecked transfers, arbitrary `send` or `transferFrom`, uninitialized state, shadowing or access control. This matches the design: `ReentrancyGuard` on every state changing function, `SafeERC20` for every transfer, status written before any outbound transfer, and no privileged roles.

## Re-running

Run the command above after any change to `contracts/src`. A new finding needs a row in the table with a verdict before the change is accepted.

## In CI

The `Slither` job in `.github/workflows/ci.yml` runs the same scope with Slither `0.11.6`, leaving out the three detectors triaged above and failing on anything else:

```
slither . --filter-paths "lib/|test/|script/" --exclude incorrect-equality,timestamp,reentrancy-benign --fail-pedantic
```

Checked locally before `createEscrowWithPermit` existed (2026-11-09), with the first two detectors left out:

* With `--exclude`: `100 detectors, 0 result(s) found`, exit code 0. The job passed.
* Without `--exclude`: `102 detectors, 5 result(s) found`, the first five rows of the table above, exit code 255. So the job does fail when Slither reports something.

After the permit function was added, the same command with only the first two detectors left out reported 1 result (`reentrancy-benign`, finding 6) and exit code 255, which is what led to the third exclusion. With the three left out, as in the job: `99 detectors, 8 contracts, 0 result(s) found`, exit code 0 (2026-11-09).

### Why it is set up this way

* **Every finding fails the job.** `--fail-pedantic` makes any result a failure, whatever its severity. A new finding from any of the other 100 detectors, including every High one and every Medium one except `incorrect-equality`, turns the job red until it is fixed or triaged in the table above.
* **The three accepted detectors are excluded.** Without that, the job would be red from the first run, because every accepted result comes from them. A job that is always red gets ignored, which is worse than a narrower check.
* **Why not fail only on High (`--fail-high`).** It would let a new Medium finding through, such as `reentrancy-no-eth` (a reentrancy that does not move ETH), which Slither classifies as Medium.
* **Why not a Slither triage database.** It needs an interactive step and a committed `slither.db.json`, which is more machinery than five findings in one contract justify.
* **Why not `slither-disable` comments in the contract.** The accepted lines would stay documented in the code, but it edits the contract source, and the findings would disappear from every local run. Keeping them visible means each run is re-triaged against the table above.

### Known blind spot

A new finding from `incorrect-equality`, `timestamp` or `reentrancy-benign` somewhere else in the contract would not fail the job, because those detectors are excluded as a whole:

* `timestamp` is Low impact, so missing a new one is minor. The contract's time rules are fixed by SPEC §2.3 and covered by the boundary tests.
* `reentrancy-benign` is Low impact and sits in the contract's main risk area: a new token call before a state write. The other three reentrancy detectors (`reentrancy-eth`, `reentrancy-no-eth`, `reentrancy-events`) stay active, and every state changing function is `nonReentrant` with tests per entry point, but a new late write after a token call would not turn the job red. A `slither-disable-start` and `slither-disable-end` pair around `createEscrowWithPermit`, with plain `slither . --fail-pedantic` for this detector, would keep CI watching the rest of the contract. It was not used, to keep the policy of one rule: an accepted detector is excluded in the workflow.
* `incorrect-equality` is Medium impact in Slither's classification. A real one would be, for example, comparing a token balance with `==`. This is the part that matters. The contract holds no balance comparisons by design (SPEC §2.6 and the direct-transfer test), and a reviewer sees any such line in a diff, but CI would not catch it.

It was accepted for this project because the contract is a single file with a small, spec-defined surface. The local command without `--exclude` still reports these detectors, and any new result needs a row in the table like any other finding.

### If the blind spot needs closing

Two options were considered and not built:

* **Baseline check.** Run Slither without `--exclude`, export JSON, and fail unless the results equal the five known ones, compared by detector and function name so line changes do not matter. The contract stays untouched, and a new accepted finding means updating the expected list next to its row here. It needs one local run to confirm the JSON shape first.
* **`slither-disable-next-line` comments** above the four accepted lines, with plain `slither . --fail-pedantic` in CI. Simpler, but with the drawbacks above.

### Changing the job

A finding that is accepted after triage is added to the table above, and its detector to `--exclude` in the workflow, in the same change.
