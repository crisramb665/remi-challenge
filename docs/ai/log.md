# AI log

## 2026-11-07: Task document from spec

Request: create a TASK document based on `docs/SPEC.md` for spec-driven development, grouping tasks to keep the list short.

Summary: created `docs/TASKS.md` with 9 tasks (T-01 to T-09) across contract, indexer, API and integration. Each task names its spec sections, dependencies and acceptance criteria. Includes a traceability table and the OpenZeppelin rules from SPEC §2.6 and CLAUDE.md.

Decisions to review:

* Open questions at the end of `docs/TASKS.md`.
* Deploy script added to T-05; the spec implies it through `START_BLOCK` but does not list it.

## 2026-11-07: Open questions resolved

Request: record the developer's answers to the open questions in `docs/TASKS.md`.

Summary: added a "Resolved decisions" section and folded the answers into the acceptance criteria for T-01, T-06 and T-08: audited OpenZeppelin 5.x tag, `viem` and `pg` without an ORM, `status=Pending` excludes `PendingExpired`, `400` for an invalid cursor, and the `HEALTH_MAX_EXTRA_LAG_BLOCKS` health rule (default 10). Docker Compose and the e2e script are confirmed in scope through CLAUDE.md. Open questions are now empty.

Decisions to review:

* Three answers add API behavior that SPEC §4 does not state: the `Pending` filter rule, the invalid-cursor `400` and the health threshold. They are recorded only in `docs/TASKS.md`. Consider adding them to `docs/SPEC.md`, since it is the source of truth.

## 2026-11-07: Spec reconciled with resolved decisions

Request: update `docs/SPEC.md` with the answered questions and the API behavior.

Summary: SPEC §2.6 now requires an audited OpenZeppelin 5.x tag. §3.1 names `viem` and `pg` with no ORM. §4.3 says the list endpoint filters on `effectiveStatus` (so `status=Pending` excludes `PendingExpired`), returns `400` for an invalid cursor, and defines the health rule `lagBlocks > CONFIRMATIONS + HEALTH_MAX_EXTRA_LAG_BLOCKS` (default 10). `docs/TASKS.md` now points to these sections.

Decisions to review:

* Wording: filtering on `effectiveStatus` means `status=PendingExpired` returns only expired pending escrows, and the other statuses are unaffected.
* Deploy script and Docker/e2e scope were left out of the spec on purpose; they come from CLAUDE.md.

## 2026-11-07: README and TASKS aligned with CLAUDE.md and SPEC §7

Request: update the README and fix inconsistencies in `docs/TASKS.md` against the current CLAUDE.md and SPEC.

Summary:

* TASKS: traceability now covers §5, §6 and §7. T-05 deploy script writes address and deploy block to an output file. T-06 reads them from the shared volume instead of `CONTRACT_ADDRESS`/`START_BLOCK` config. T-09 now follows SPEC §7 and the CLAUDE.md Docker conventions. A new T-10 covers CI and the README. Resolved decisions point to §7.
* README: links TASKS, adds `pg` (no ORM), the audited OpenZeppelin pin and the compose services. The `scripts/` folder is removed because the e2e script lives at the root. "AI prompts" is replaced by the AI log.

Decisions to review:

* T-06 assumes the API reads the address and deploy block from a file on the shared volume. The file name and format are not in the spec.
* The README file is named `README.MD`. I kept that name.

## 2026-11-07: README rename and T-01

Request: rename `README.MD` to `README.md` and start the tasks. T-01 was redone after the first attempt, this time with the developer running every command.

Summary:

* T-01 done. Foundry project in `contracts/` with solc `0.8.24`, remappings and a `.gitignore`. Dependencies are git submodules: OpenZeppelin `v5.6.1` (commit `5fd1781`) and forge-std `v1.17.0` (commit `f3dae6e`).
* `src/EscrowManager.sol` has the constants, `Status`, the `Escrow` struct, storage, all errors and events with NatSpec, it inherits OZ `ReentrancyGuard`, and it has `getEscrow`.
* Tests: constants, `nextId == 1`, and `EscrowNotFound` for ids 0 and 1. `forge fmt --check` is clean, `forge build` has no warnings and 4 tests pass.

Decisions to review:

* OpenZeppelin tag: the latest audit in the OZ `audits/` folder covers `v5.6.0` (February 2026). `v5.6.1` only fixes an overflow in `InteroperableAddress`, which this project does not use, so I pinned `v5.6.1`. `v5.7.0` exists but has no audit listed.
* Libraries are submodules, not ignored files, so the repository records the exact versions. `forge init` first installed an unpinned forge-std as plain files; it was removed and reinstalled with `forge install` at `v1.17.0`.
* The contract is named `EscrowManager`, not `Escrow`. A contract named `Escrow` triggers a shadowing warning with the `struct Escrow` from SPEC §2.2. The spec does not name the contract.
* `getEscrow` returns `(Escrow memory, uint64 cancelDeadline, uint64 expiresAt)`. The spec does not fix the return shape. `uint64` matches the event. The casts carry `forge-lint` disable comments because `createdAt` is `uint40`, so they cannot truncate.
* Tests for `getEscrow` on an existing escrow wait for `createEscrow` in T-02.

## 2026-11-07: T-02 progress: no-code token, SPEC §2.4, test refactor, InvalidToken NatSpec

Request: (1) support tests for a token with no code after the developer changed line 120 of `EscrowManager.sol`; (2) update SPEC §2.4; (3) refactor repeated `vm.prank(alice)` in the test file; (4) add `test_DirectTransferDoesNotAffectEscrow` and update the `InvalidToken` NatSpec.

Summary:

* `createEscrow` now reverts with `InvalidToken` for `address(0)` or an address with no code. Four tests cover an EOA, an undeployed contract address and the check order.
* SPEC §2.4 updated to match the code, at the developer's request.
* `EscrowManagerTest` uses a `_create` helper plus `AMOUNT` and `eoa` shared values instead of repeating `vm.prank(alice)`.
* `InvalidToken` NatSpec now reads "The token is the zero address or has no code."
* `test_DirectTransferDoesNotAffectEscrow` is not written yet. It needs `confirm`, which belongs to T-03, and contract logic was not to change. Agreed with the developer to write it in T-03; it was added to the T-03 acceptance criteria in `docs/TASKS.md`.

Decisions to review:

* The `InvalidToken` no-code check is an addition to the original spec; §2.4 was updated to describe it.
* A token that has code but no `balanceOf` still reverts with empty data. Left as is on purpose.
* T-02 is not ticked yet: `forge fmt`, `forge build` and `forge test` still have to be run by the developer.

## 2026-11-07: T-02 `createEscrow` done

Request: implement T-02 and verify it.

Summary: `createEscrow(token, beneficiary, amount)` validates in the order `ZeroAmount`, `InvalidBeneficiary`, `InvalidToken` (zero address or no code), measures the received amount around OZ `safeTransferFrom` and reverts with `UnsupportedToken` on a mismatch. It stores the escrow as `Pending`, increments `nextId` and emits `EscrowCreated` with both deadlines. It is `nonReentrant` (OZ). Test mocks `MockERC20` and `MockFeeOnTransferERC20` live in `contracts/test/mocks/`. The developer ran `forge fmt`, `forge build` and `forge test`: all 19 tests pass.

Decisions to review:

* The balance check subtracts `before` from `after` with checked arithmetic. A token whose balance falls during the transfer would revert with a panic instead of `UnsupportedToken`. Only a malicious token can do that and it only affects its own escrow, so it was left as is.
* `MockFeeOnTransferERC20` is reused by T-04.
* `test_DirectTransferDoesNotAffectEscrow` is deferred to T-03 because it needs `confirm`.

## 2026-11-07: T-03 resolution functions done, tests split

Request: implement T-03, then split the growing test contract into smaller, specifically named test contracts.

Summary:

* `cancel`, `confirm`, `reject` and `reclaimExpired` follow the SPEC §2.3 table. The shared checks live in two private helpers: `_pending` (`EscrowNotFound`, then `NotPending`) and `_pendingForBeneficiary` (adds `NotBeneficiary`, then `TtlElapsed`). Each function writes the status and emits its event before the `safeTransfer`, and is `nonReentrant` (OZ).
* Tests are split by concern under `contracts/test/`, sharing the abstract `utils/EscrowFixture.sol`: `EscrowViewsAndConstants` (4), `CreateEscrow` (15), `CancelEscrow` (9), `ConfirmEscrow` (7), `RejectEscrow` (7), `ReclaimExpiredEscrow` (5), `ResolvedEscrowFinality` (4), `DirectTokenTransfer` (1).
* Covered: happy paths with events, boundaries at `D - 1`, `D`, `E - 1` and `E`, the error order for every function, finality after each resolution, and `test_DirectTransferDoesNotAffectEscrow` (SPEC §2.6, §2.9).
* The developer ran `forge fmt`, `forge build` and `forge test -vvv`: 52 tests pass.

Decisions to review:

* The private helpers `_pending` and `_pendingForBeneficiary` are small abstractions added to avoid repeating the check order four times.
* The `EscrowCancelled`, `EscrowReleased`, `EscrowRejected` and `EscrowExpired` events are emitted before the token transfer to keep checks-effects-interactions strict. Event order relative to the `Transfer` event is therefore events first, then the token's `Transfer`.
* `EscrowManager.t.sol` was removed and split. Test names were kept unchanged.
* At the developer's explicit permission for that one step, the assistant ran the file renames itself.

## 2026-11-07: T-04 token mocks and invariants done

Request: implement T-04, reduce the invariant run size, and add ghost counters so the fuzzing is shown to reach the success paths.

Summary:

* Mocks in `contracts/test/mocks/`: `MockNoReturnERC20` (no `bool` returns) and `MockReentrantERC20` (calls back into a target during a transfer and bubbles up the revert). The fee-on-transfer mock and its `UnsupportedToken` test already existed from T-02.
* `NoReturnToken.t.sol` (5 tests) runs the whole lifecycle with the no-`bool` token. `ReentrancyProtection.t.sol` (7 tests) shows each of the five state changing functions rejects reentrancy with OZ's `ReentrancyGuardReentrantCall`, including two cross-function cases.
* `invariant/EscrowHandler.sol` creates and resolves escrows with random actors, amounts and time jumps across two tokens, and records the exact payout and refund of each resolution. `invariant/EscrowInvariants.t.sol` checks I1, I2 and I3 from SPEC §2.9.
* Coverage: the handler counts successful resolutions per outcome (`resolutionsByStatus`). It picks the legitimate caller and a pending escrow three times out of four, and a third of the time jumps are under an hour, so the 2 hour cancel window is reachable. `invariant/EscrowHandler.t.sol` (6 tests) proves every resolution path, a wrong caller and an already resolved escrow behave as expected.
* `foundry.toml` sets `[invariant] runs = 64, depth = 100` with the reason in a comment. Foundry's defaults (256 x 500) ran for minutes because every invariant loops over all escrows after every call.
* The developer ran the full suite: 73 tests pass in about 2.4 seconds.

Decisions to review:

* The invariant size is smaller than Foundry's defaults. A heavier run is available with `FOUNDRY_INVARIANT_RUNS=256 FOUNDRY_INVARIANT_DEPTH=500`; T-10 (CI) should decide whether CI uses it.
* Foundry resets storage after each run, so the counters cannot give totals across the whole campaign. The deterministic coverage tests are what guarantee reachability; the weighted caller, id and time choices raise how often the fuzzer gets there.
* `MockNoReturnERC20` is a small hand-written token because OpenZeppelin ships no token without return values. It lives in `test/mocks/` only. The rule against reimplementing OpenZeppelin applies to `src/`.
* The `ReentrancyGuard` tests rely on OpenZeppelin 5.x `SafeERC20` bubbling up the token's revert data, which `v5.6.1` does.
