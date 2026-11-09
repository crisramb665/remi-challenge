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

## 2026-11-08: T-08 Endpoints

Request: implement `GET /escrows/:id`, `GET /escrows` and `GET /health` (SPEC §4.1 to §4.4), one small step at a time with the developer running the commands. Also added the documentation task T-11 (`docs/ARCHITECTURE.md`) to `docs/TASKS.md`, to be done after T-09.

Questions asked because SPEC §4.3 is silent, answered by the developer (SPEC not edited):

* `GET /escrows` returns `{ "items": [...], "nextCursor": "<id>" | null }`.
* A `limit` outside 1 to 100, or not an integer, returns 400 (no clamping).
* Before the first checkpoint `/health` shows `lastIndexedBlock: null` and measures the lag from `startBlock - 1`.

Summary: built in five steps under `api/src/escrows/` and `api/src/health/`:

* `escrow-view.ts`: pure `toEscrowView(row, now)` with `effectiveStatus` and the four `can*` flags (§4.2). 16 tests at `D - 1`, `D`, `E - 1`, `E`, for every status.
* `query.ts`: pure parsers for ids, cursor, addresses, status and limit; any invalid value is a 400. Addresses are accepted in any letter case and lowercased. 69 test cases.
* `escrows.repository.ts`: the SQL. Orders by `id DESC`, pages with `id < cursor`, and fetches `limit + 1` rows so `nextCursor` is null on the last page. The `status` filter applies to the effective status using the same `now` (`Pending` means not yet expired, `PendingExpired` means expired). All values are query parameters. 23 database tests.
* `ChainReader` gained `getLatestBlock()` and `getChainId()`. `chain-reader.spec.ts` (6 tests) runs the real viem reader against a minimal JSON-RPC server, checking the requests it sends (contract address, hex block range, the filter with all five event hashes) and how it decodes the answers.
* `escrows.service.ts`, `escrows.controller.ts`, `health.ts` (pure `buildHealth`), `health.service.ts`, `health.controller.ts` and their modules. `now` is the timestamp of the latest block from the node, read once per request. `test/support/api-app.ts` starts the whole app on an isolated schema with a controllable fake node; `test/escrows.e2e-spec.ts` (38 tests) and `test/health.e2e-spec.ts` (9 tests) call it over HTTP with `supertest`. `supertest` came with the Nest scaffold, so no dependency was added.

Verification: `format` and `lint` clean (0 warnings, 0 errors, 43 files); `test` 234 passed in 12 suites; `test:e2e` 51 passed in 3 suites; `build` clean. Database tests ran against the throwaway `postgres:16-alpine` container.

Decisions to review:

* SPEC §4.3 still does not describe the `GET /escrows` body, the `limit` rule or the empty-health case. The answers are only in `docs/TASKS.md`. If the spec is meant to match, it needs a reconciliation edit; I did not make it.
* `GET /escrows` and `GET /escrows/:id` return 503 when the node cannot be reached, because `now` cannot be known and SPEC §4.1 rules out the server clock. This was my choice; the spec does not say. With viem's built-in retries a request can take about one second to fail.
* `/health` always answers 200; `degraded` is in the body. When the node is unreachable it reports `chainId`, `chainHead` and `lagBlocks` as null and keeps `lastIndexedBlock` from the database.
* A negative `lagBlocks` (node head below the checkpoint, for example after the chain is reset while the database keeps its data) is shown as is and counts as `ok`. It is visible but not flagged.
* An empty query value (`?sender=`), a repeated parameter (`?limit=1&limit=2`) and an id with leading zeros are all 400. Unknown parameters are ignored.
* Ids are validated up to `2^256 - 1`, because the contract's ids are `uint256`.
* Every request makes one RPC call (`getLatestBlock`), with no caching. Simple and always current; it costs one round trip per request.
* The viem reader is now tested against a fake JSON-RPC server, which is more than the T-07 entry said. It is still run against a real Anvil only in T-09.

## 2026-11-08: SPEC §4.3 reconciled with T-08

Request: reconcile SPEC §4.3 with the decisions taken and the behavior built in T-08, before starting T-09.

Summary: `docs/SPEC.md` §4.3 now states what the API does. `GET /escrows` documents the `{ items, nextCursor }` body (each item as in `GET /escrows/:id`, `nextCursor` null on the last page), that addresses are accepted in any letter case, and that an invalid `limit` is a 400 and is not clamped; an empty or repeated parameter is also invalid. `/health` documents that it always answers 200, which fields are null when the RPC is unreachable, and the empty-database case (`lastIndexedBlock: null`, lag from `startBlock - 1`). A closing line says `GET /escrows` and `GET /escrows/:id` return 503 when the RPC is unreachable. The three T-08 notes in `docs/TASKS.md` that said "SPEC not edited" now say they were reconciled, and a fourth records the 503 and the always-200 health. This resolves the first decision to review in the T-08 entry above. Only §4.3 changed; the rest of the spec is as before.

Decisions to review:

* The 503 rule and the always-200 `/health` were my choices while implementing, not answers from the developer. They are in the spec now because the developer asked for the reconciliation; they can still be changed.
* The spec now describes the behavior of the code, so a later change to either has to change both.

## 2026-11-09: T-09 Docker Compose and end-to-end script

Request: root `docker-compose.yml` with `anvil`, `deploy`, `postgres` and `api`, plus an end-to-end script (SPEC §7), working one step at a time with the developer running the commands. The developer asked whether so many tests were excessive for a challenge (see decisions), chose a bash script, and asked to test locally before Docker.

Summary:

* `contracts/deploy.sh`: runs the existing `forge script`, reads forge's broadcast file with `jq -e`, converts the hex deploy block to decimal and writes `{ "address", "startBlock" }` to `DEPLOYMENT_FILE` through a temporary file and a rename. Runs on the host and in the container. Checked by hand against a local Anvil first.
* `contracts/Dockerfile` and `.dockerignore`: the `deploy` image, Foundry `v1.5.1` plus `jq`, compiled at build time. The Foundry image is Ubuntu based and runs as the user `foundry`; my first version assumed Alpine (`apk`) and failed, and the image was inspected before the fix.
* `api/Dockerfile` and `.dockerignore`: two-stage build on `node:26-alpine`, pnpm 12.15.0 installed with npm (Node 25 and later ship no corepack), production dependencies only, runs as `node`.
* `docker-compose.yml`: Anvil in memory and Postgres on tmpfs, so every `up` is a fresh stack. `deploy` runs once and writes `/shared/deployment.json`; `api` starts after Anvil and Postgres are healthy and `deploy` has completed, and has a `/health` healthcheck. Postgres is not published to the host.
* `e2e.sh` (bash 3.2 compatible, needs `forge`, `cast`, `jq`, `curl`): checks the stack is fresh, deploys `MockERC20`, creates four escrows, runs confirm, reject, cancel and expire (time moved with `evm_increaseTime` and `evm_mine`), mines `CONFIRMATIONS` blocks and waits for `/health` `lastIndexedBlock` to reach each transaction's block, and asserts fields, flags, filters, pagination, 404 and 400 responses and token balances. It stops at the first failed check with exit code 1. Without `DEPLOYMENT_FILE` it copies the file out of the `deploy` container.
* Documentation: `docs/manual-test.md` (scenarios, procedure and expected results), `docs/postman/escrow-api.postman_collection.json` (25 requests with tests, including Anvil JSON-RPC for blocks and time), and the Commands section of `CLAUDE.md` now lists the API and Docker commands.
* Tasks: added T-11 (architecture document) and a test-review item in T-10 at the developer's request.

Verification: `docker compose up -d --build --wait` brought the stack up (`anvil`, `postgres`, `api` healthy, `deploy` exited with 0). `bash e2e.sh` on a fresh stack printed `ok` for every check and `All checks passed`. Running it again on the used stack failed at the first assertion with `FAILED: the stack is fresh (no escrows yet) (expected '', got '4,3,2,1')` and exit code 1, which shows the nonzero exit. The developer also ran the manual scenarios with curl and Postman and reported them done; no outputs were kept, so `docs/manual-test.md` states expected results and does not claim a result per scenario. This was the first run of the API against a real node, and it needed no code changes in `api/`.

Decisions to review:

* The test suite is large for a challenge (about 360 tests). It was agreed to trim only duplicated coverage in T-10 and not add tests for Docker files, since `e2e.sh` is their test.
* Images are pinned: Foundry `v1.5.1` (the version used locally), `postgres:16-alpine`, `node:26-alpine`. `node:26-alpine` has no digest pin.
* Postgres on tmpfs and Anvil in memory mean nothing survives `docker compose down`. The `shared` volume is rewritten by every deploy.
* The `deploy` container runs as the unprivileged `foundry` user; `/shared` is created in the image with that owner so the new volume is writable. The API container mounts it read-only.
* `CONFIRMATIONS` is 2 in compose and `e2e.sh` mines that many blocks after each batch; both must stay equal.
* Database credentials in compose are public local defaults. Only Anvil's default accounts are used.
* The API restart and node-down scenarios are manual (17 and 18 in `docs/manual-test.md`); `e2e.sh` does not cover them.
* Real-network differences (Sepolia: signing, block time, `CONFIRMATIONS`, the provider's `getLogs` range, the 2 hour and 7 day constants) are only described in `docs/manual-test.md`; nothing was changed for them.
* `e2e.sh` is not executable; the documented command is `bash e2e.sh`.

## 2026-11-09: Test review (part of T-10)

Request: the developer found the suite excessive for a challenge (about 360 tests). Agreed rule: a separate pass that removes duplicated coverage only, so each requirement is tested once. The contract tests and invariants, and the projection, indexer service, schema and boot tests stay. The list was shown first and the developer chose to apply all of it.

Result: 359 tests became 281. API unit tests 234 → 185, API e2e tests 51 → 22, contract tests unchanged at 74 (not touched, not re-run in this pass). Verified after the change: `format` and `lint` clean (0 warnings, 0 errors), `test` 185 passed in 12 suites, `test:e2e` 22 passed in 3 suites, `build` clean. The first unit run failed with `ECONNREFUSED 127.0.0.1:5432` because the throwaway test Postgres had stopped; after restarting it the same suite passed, so it was not caused by the removals.

Removed tests:

* `test/escrows.e2e-spec.ts` (38 → 15), 23 removed. `GET /escrows/:id`: the four time-boundary cases (`D - 1`, `D`, `E - 1`, `E`), "shows a resolved escrow with both transactions and no actions", "keeps the amount of a uint256 exact", and five bad-id cases (negative, decimal, hex, leading zero, above uint256). `GET /escrows`: "returns an empty list", "walks through every page with nextCursor", "moves an escrow from Pending to PendingExpired", and nine bad-query cases (beneficiary, lowercase status, zero cursor, limit above 100, limit text, limit decimal, repeated limit, empty sender, empty limit). Kept: the full body, the node clock as `now`, 404, two 400s for ids, four 400s for the list, 503 for both endpoints, newest first with the same shape, default 20 and maximum 100, case-insensitive sender and beneficiary filters, and the effective status filter.
* `test/health.e2e-spec.ts` (9 → 3), 6 removed: "follows the checkpoint and the head", "reports the chain id", the two threshold cases (lag 12 and 13), "recovers when the node comes back", "degraded before the first checkpoint when far ahead". Kept: the ok example, node down, fresh database.
* `src/escrows/query.spec.ts`, 34 table rows removed, one or two rows per rule kept: accepted ids `7` and `1000000`; rejected ids plus sign, hex, empty, spaces, exponent and 78 digits; rejected cursors `-3`, empty and `1.0`; rejected addresses empty, `0x` only and with spaces; accepted statuses Released, Rejected and Expired; rejected statuses `Cancelled`, `PENDING` and empty; accepted limit `99`; rejected limits `1000`, `1e2`, ` 5`, `0x10` and `00000`; five of the seven combined-query 400 rows and three of the five empty-value rows.
* `src/escrows/escrows.repository.spec.ts` (23 → 18), 5 removed: "finds an id as large as a uint256", "accepts a cursor as large as a uint256", "returns nothing for an address with no escrows", "pages within a filter", "a resolved escrow past its expiry is never PendingExpired".
* `src/health/health.spec.ts` (16 → 13), 3 net: "ok when fully caught up" became a row (lag 0) of the threshold table, "ok at the usual lag" is covered by the other rows, "follows the number of confirmations" and "returns plain numbers" removed.
* `src/escrows/escrow-view.spec.ts` (16 → 14): "keeps the amount as a decimal string" (pass-through) and "covers every stored status" (compared a constant with itself).
* `src/indexer/chain-reader.spec.ts` (6 → 4): "reads the block number" and "reads the chain id" (pass-throughs; the latest block, the log request and its decoding, and the failure case stay).
* `src/indexer/decode.spec.ts` (11 → 10): "returns an empty list when there are no logs". `src/indexer/range.spec.ts` (12 → 11): "a single block when the batch size is 1" (same result as "the only one confirmed").
* `src/config/config.spec.ts`: "uses 10 extra lag blocks and /shared/deployment.json by default" removed, but not as a pure duplicate. The first test compared the defaults with the constants exported by the code; it now compares with the literal spec values (10 and `/shared/deployment.json`), so changing a constant still fails a test.

Decisions to review:

* The judgment of what is redundant is mine. The rule used: a rule that is tested at the unit level (derived fields, input parsing, SQL, health status) is not tested again over HTTP beyond one check that the pieces are connected. If a bug appears in the wiring between layers, the kept e2e tests are the ones to extend.
* Several removed tests were cheap table rows and the cost of keeping them was small; they went because the same code path stays covered by one or two other rows.
* Not changed: the contract tests (74), `projection.spec.ts` (18), `indexer.service.spec.ts` (10), `schema.spec.ts`, `deployment.spec.ts`, `app.e2e-spec.ts`.
* The earlier log entries (T-07, T-08) still quote the test counts from the time they were written.
