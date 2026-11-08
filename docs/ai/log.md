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

## 2026-11-07: T-05 Slither, formatting and deploy script done

Request: implement T-05.

Summary:

* `contracts/script/Deploy.s.sol` only deploys `EscrowManager` from the account `forge script` broadcasts with, so no key is in the repository. `test/DeployScript.t.sol` runs it. The developer deployed to a local Anvil with `--unlocked --sender 0xf39F...2266`; forge's broadcast file held the address (`.transactions[0].contractAddress`, lowercase) and the exact block (`.receipts[0].blockNumber`, hex `0x1`).
* Slither 0.11.6 (installed with Homebrew) found 5 results from 2 detectors on `src/`: `incorrect-equality` and `timestamp`. None needs a code change. Triage is in `docs/slither.md`: the `Status.None` comparison is a false positive, and the `block.timestamp` comparisons are the required time rules.
* `forge fmt --check` is clean and all 74 tests pass.

Decisions to review:

* The developer chose to keep the deploy script minimal and let the T-09 `deploy` service read forge's broadcast file with `jq`, instead of having the script write its own JSON. The block is exact this way and `foundry.toml` needs no `fs_permissions`. T-09 must convert the hex block to decimal for `START_BLOCK`.
* Slither excludes `lib/`, `test/` and `script/` (`--filter-paths`). OpenZeppelin is audited upstream and used as installed.
* No `slither-disable` comments were added to the contract, so future runs keep reporting these findings and they are re-triaged from the table rather than hidden.
* `broadcast/*/31337/` is already in `contracts/.gitignore`, so Anvil deployments are not committed.

## 2026-11-07: contracts/Makefile

Request: consider a Makefile for the long forge, anvil and slither commands.

Summary: added `contracts/Makefile` (agreed location, since Foundry commands run from `contracts/`) with the targets `build`, `test`, `test-deep`, `fmt`, `fmt-check`, `slither`, `anvil`, `deploy-local` and `deploy-info`. `RPC_URL`, `DEPLOYER` and `BROADCAST` can be overridden, for example `make deploy-local RPC_URL=...`. `make -n` was used to check the expanded commands without running them.

Decisions to review:

* It is a convenience layer that is not in the spec and adds no dependencies. `DEPLOYER` is Anvil's public first test account.
* CLAUDE.md "Commands" still lists the raw commands. It was not edited; adding the `make` targets there would keep the two in sync.
* `test-deep` is the 256 x 500 invariant run; T-10 (CI) can use it.

## 2026-11-07: Makefile referenced in CLAUDE.md and README

Request: reference the Makefile usage in CLAUDE.md and the README.

Summary: the CLAUDE.md "Commands" section now lists the `make` targets, says to prefer them over the raw commands and to update the list whenever a target changes. The README has a new "Contracts" section with a table of the targets, the Foundry and Slither requirements, and a note to clone with submodules. SPEC §7 already asks the README for test commands, so this is a first part; API commands come later.

Decisions to review:

* CLAUDE.md now tells future sessions to prefer `make` targets. The raw commands appear in the Makefile comments rather than in CLAUDE.md.
* The README says to clone with `--recurse-submodules` because the libraries are git submodules.

## 2026-11-07: T-06 API scaffold, config and schema

Request: scaffold the NestJS API, validate its configuration, read the deployment from a file and create the §3.4 schema. Later request: use `@nestjs/config` instead of a hand-written config provider.

Summary: `api/` was scaffolded by the developer with pnpm (CommonJS, jest), then `@nestjs/mau`, the `deploy` script and the sample controller and service were removed. Added `viem`, `pg`, `@types/pg` and `@nestjs/config`. `loadConfig` validates `RPC_URL`, `DATABASE_URL`, `CONFIRMATIONS`, `BATCH_SIZE`, `POLL_INTERVAL_MS`, `HEALTH_MAX_EXTRA_LAG_BLOCKS` (default 10) and `DEPLOYMENT_FILE` (default `/shared/deployment.json`), collects every error in one `ConfigError` and never echoes URLs. It runs inside a `registerAs('app', ...)` factory, so `@nestjs/config` loads `.env` and injects the result with `appConfig.KEY`. `loadDeployment` reads `{ address, startBlock }` from the JSON file and the app refuses to boot if it is missing or malformed. `database/schema.sql` creates `escrows` and `indexer_state` with `IF NOT EXISTS` and is applied by `DatabaseModule` at startup. `api/.env.example` documents the variables.

Verification: `pnpm --dir api format` and `lint` clean; `test` 44 passed (35 without a database, the 9 schema tests run with `TEST_DATABASE_URL`); `test:e2e` 4 passed (invalid config and missing deployment stop the boot; schema created and deployment exposed on a good boot); `build` succeeds and `dist/database/schema.sql` is copied by the `assets` entry in `nest-cli.json`. Database tests ran against a throwaway `postgres:16-alpine` container, each test file in its own Postgres schema.

Decisions to review:

* `registerAs` plus the custom function is used instead of `ConfigModule`'s `validate` option, so validated values are not written back into `process.env`.
* `CONFIRMATIONS`, `BATCH_SIZE` and `POLL_INTERVAL_MS` are required and have no defaults, as the spec lists no values. Only `HEALTH_MAX_EXTRA_LAG_BLOCKS` and `DEPLOYMENT_FILE` have defaults.
* The schema adds constraints beyond §3.4: `NOT NULL` on the required columns, `CHECK (x = lower(x))` on the address columns, and `updated_at DEFAULT now()`. `resolved_tx` and `resolved_block` stay nullable. `amount` is `numeric(78,0)` so it holds any uint256.
* Database tests are skipped, with a warning, when `TEST_DATABASE_URL` is unset. T-10 (CI) must set it so they never skip silently.
* `@parcel/watcher` build scripts are disabled in `api/pnpm-workspace.yaml`; its prebuilt binary is used.
* The deployment address is lowercased when read, to match the lowercase addresses in the database.

## 2026-11-07: T-07 Ingestion and projection

Request: implement the ingestion loop and the projection into Postgres (SPEC §3.1 and §3.2), working one task at a time with the developer running the commands.

Summary: built in four small steps, each with tests, under `api/src/indexer/`:

* `range.ts`: pure `computeRange` (safe head = head minus confirmations, clamped to `BATCH_SIZE`, first run starts at the deploy block, null when nothing is confirmed). 12 unit tests.
* `projection.ts` and `events.ts`: `applyRange` applies one range and moves the checkpoint in one transaction. It sorts events by `(blockNumber, logIndex)`, inserts `EscrowCreated` with `ON CONFLICT (id) DO NOTHING`, updates transitions `WHERE id = $1 AND status = 'Pending'` (`EscrowCancelled` becomes `CancelledBySender`), lowercases addresses, and upserts `indexer_state`. 18 database tests, including replay as a no-op and rollback of the whole range, checkpoint included, when one event fails.
* `escrow.abi.ts` and `decode.ts`: the five events from §2.7 and `toEscrowEvents`, which validates positions and argument types. 11 tests, including a round trip through viem's own encoder and decoder and a check that the event hashes equal the ones `cast keccak` computes from the contract signatures.
* `chain-reader.ts`, `indexer.service.ts`, `indexer.module.ts`: `IndexerService.runOnce()` and a polling loop started on application bootstrap. It sleeps `POLL_INTERVAL_MS` only when caught up or after an error, and the sleep is interrupted on shutdown. 10 database tests against a fake in-memory chain.

Also changed: `AppModule` imports `IndexerModule`; `DatabaseModule` now closes the pool in `onApplicationShutdown` (after every `onModuleDestroy`) so the indexer stops first; the boot e2e test overrides `CHAIN_READER` with an empty chain.

Verification: `format` and `lint` clean (0 warnings, 0 errors); `test` 95 passed across 7 suites; `test:e2e` 4 passed; `build` clean. Database tests ran against the throwaway `postgres:16-alpine` container.

Decisions to review:

* `ChainReader` is a small interface between the loop and viem. It is not in the spec, but it lets the loop be tested without a node, and it keeps every RPC call in one file. It has one implementation and is not meant as an extension point. The real viem reader is only exercised end to end in T-09. The rationale is documented on the interface in `chain-reader.ts`.
* The event ABI is written by hand from §2.7. `decode.spec.ts` pins the hashes of the contract signatures, so a mismatch with the contract fails a test, but the hashes in the test are copied values and must be updated if an event changes.
* Failures are logged and retried after `POLL_INTERVAL_MS`, with no backoff and no retry limit. A range that can never be applied would be retried forever; the log line shows why. viem's HTTP transport retries each request 3 times on its own (150 ms base delay), so a short blip is absorbed before the loop sees it. The reasoning and the "with more time" version are in the comment in `IndexerService.run()`.
* `applyRange` sorts the events itself, so ordering does not depend on the caller.
* Limitations that the spec also accepts: a reorg deeper than `CONFIRMATIONS` leaves the projection wrong (§3.3), and if the chain is reset while the database keeps its checkpoint (head below the checkpoint) the indexer stays idle. A fresh stack with a fresh volume is not affected.
* A `BATCH_SIZE` larger than the node allows per `getLogs` call makes every round fail; lower it in that case.
