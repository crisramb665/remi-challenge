# Tasks

Backlog derived from `docs/SPEC.md` for spec-driven development. The spec is the source of truth: if a task and the spec disagree, the spec wins and the task is fixed.

## How to use

* Work on one task at a time, in order, respecting `Depends on`.
* A task is done only when every acceptance criterion holds and its tests pass.
* After each task, append an entry to `docs/ai/log.md` and tick the status box.
* Open questions must be answered by the developer before starting the related task.

Status legend: `[ ]` todo, `[~]` in progress, `[x]` done.

## Cross-cutting rules

Cross-cutting rules live in CLAUDE.md and SPEC §2.6.

## Traceability

| Spec section | Tasks |
| --- | --- |
| §2.1 Constants, §2.2 State | T-01 |
| §2.3 Actions and time rules | T-02, T-03 |
| §2.4 Validation and errors | T-01, T-02, T-03 |
| §2.5 Token handling | T-02, T-04 |
| §2.6 Security | T-01 to T-05 |
| §2.7 Events | T-01, T-02, T-03 |
| §2.8 Views | T-01 |
| §2.9 Invariants | T-04 |
| §2.10 Test plan | T-02 to T-05 |
| §3.1 Ingestion, §3.2 Atomicity, §3.3 Reorgs | T-06, T-07 |
| §3.4 Schema | T-06 |
| §4.1 to §4.4 API | T-08 |
| §5 Assumptions, §6 Out of scope | T-10 (README) |
| §7 Deliverables | T-05, T-09, T-10 |
| Architecture document (not in the spec) | T-11 |
| §2.3 to §2.6, §2.9, §2.10: permit creation | T-12 |

---

## Phase 1: Contract

### T-01 Project setup and contract skeleton

Spec: §2.1, §2.2, §2.4, §2.7, §2.8 · Depends on: none · Status: [x]

Scope: Foundry project in `contracts/` with `forge-std` and OpenZeppelin 5.x at a pinned release tag, both installed as git submodules. `contracts/src/EscrowManager.sol` (contract `EscrowManager`; the name `Escrow` is taken by the struct in §2.2) with constants, `Status`, `Escrow` struct, `_escrows`, `nextId = 1`, all errors and events with NatSpec, inherits OZ `ReentrancyGuard`, and the `getEscrow` view.

Acceptance:

* `forge build` succeeds; OpenZeppelin pinned to the latest stable 5.x tag that has a published audit report, no other libraries. The chosen tag and its audit are recorded in `docs/ai/log.md`.
* `CANCEL_WINDOW == 2 hours`, `TTL == 7 days`, `nextId == 1`.
* Errors and events match §2.4 and §2.7 exactly.
* `getEscrow` returns stored fields plus `cancelDeadline` and `expiresAt`; unknown id reverts with `EscrowNotFound(id)`.

### T-02 `createEscrow`

Spec: §2.3, §2.4, §2.5, §2.6, §2.7 · Depends on: T-01 · Status: [x]

Acceptance:

* Reverts with `ZeroAmount`, `InvalidBeneficiary` (zero and self), `InvalidToken`, `UnsupportedToken` (received amount differs).
* OZ `SafeERC20.safeTransferFrom` with balance before/after check; OZ `nonReentrant`.
* Stores `Pending` with `createdAt = block.timestamp`, increments `nextId`, emits `EscrowCreated` with correct deadlines.

### T-03 Resolution functions

Spec: §2.3, §2.4, §2.6, §2.7 · Depends on: T-02 · Status: [x]

Scope: `cancel`, `confirm`, `reject`, `reclaimExpired`.

Acceptance:

* Each function matches the §2.3 table (caller, time rule, final status, recipient) and emits its event.
* Error order: `EscrowNotFound` → `NotPending` → `NotSender`/`NotBeneficiary` → time error with deadline argument.
* Boundary tests at `D - 1`, `D`, `E - 1`, `E` for every time-dependent action; beneficiary can act during the cancel window.
* Status written before `safeTransfer`; `nonReentrant` on all of them.
* Any action on a non-`Pending` escrow reverts with `NotPending`.
* `test_DirectTransferDoesNotAffectEscrow` (SPEC §2.6, §2.9): a third account sends tokens straight to the contract, the sender creates an escrow for a different amount (no `UnsupportedToken`), the stored and `EscrowCreated` amounts exclude the donation, the beneficiary confirms and receives exactly the escrow amount, and the contract keeps the donated amount afterwards.

### T-04 Token mocks and invariants

Spec: §2.5, §2.9, §2.10 · Depends on: T-03 · Status: [x]

Acceptance:

* Mocks in `contracts/test/mocks/`: no-`bool` token works end to end; fee-on-transfer reverts with `UnsupportedToken`; reentrant token cannot reenter.
* Handler-based invariant tests for I1, I2 and I3.
* The handler counts successful resolutions per outcome, and deterministic tests prove it reaches every resolution path, so the invariants never pass on runs where nothing succeeds.
* Invariant runs are set in `foundry.toml` to 64 runs of depth 100, with the reason documented there.

### T-05 Slither, formatting and deploy script

Spec: §2.10, §3.1 (`START_BLOCK`), §7 · Depends on: T-04 · Status: [x]

Acceptance:

* `slither .` findings triaged in `docs/slither.md`; `forge fmt --check` passes.
* `script/Deploy.s.sol` only deploys, from the account `forge script` broadcasts with (an Anvil default account, no key in the repository). Forge's broadcast file `broadcast/Deploy.s.sol/<chainId>/run-latest.json` holds the contract address (`.transactions[0].contractAddress`) and the exact deploy block (`.receipts[0].blockNumber`), which the `deploy` service in T-09 extracts to the shared volume. No hardcoded addresses.
* A test runs the script and checks the deployed contract.
* The script was run against a local Anvil and the broadcast file contains both values.

---

## Phase 2: Indexer (`api/`)

### T-06 API scaffold, config and schema

Spec: §3.1, §3.3, §3.4 · Depends on: T-05 · Status: [x]

Acceptance:

* Contract address and start block are read from a JSON file at `DEPLOYMENT_FILE` (default `/shared/deployment.json`) with the shape `{ "address": "0x...", "startBlock": 1 }`, the block already in decimal. They are never hardcoded (§7, CLAUDE.md). The T-09 `deploy` service writes this file.
* NestJS app boots; config validated for `RPC_URL`, `CONFIRMATIONS`, `BATCH_SIZE`, `POLL_INTERVAL_MS`, `HEALTH_MAX_EXTRA_LAG_BLOCKS` (default `10`), database URL.
* A plain `schema.sql` creates `escrows` and `indexer_state` as in §3.4, with indexes and lowercase addresses. It uses `IF NOT EXISTS` and is applied at startup with `pg`, so running it twice is safe. No migration library and no extra tables.
* Config uses `@nestjs/config` (developer's choice) to load `.env` files and inject the settings through `registerAs`. The validation itself is a small hand-written function with unit tests that runs inside the `registerAs` factory; no `joi` or `class-validator`.
* Package manager: `pnpm` (developer's choice). The lockfile is `pnpm-lock.yaml`.
* Dependencies: the NestJS scaffold, `@nestjs/config`, `viem` as the RPC client and `pg` as the Postgres driver (plus `@types/pg`). No ORM.
* The schema test runs against a Postgres container.

### T-07 Ingestion and projection

Spec: §3.1, §3.2 · Depends on: T-06 · Status: [x]

Acceptance:

* Range computation is a pure function with unit tests (clamp, empty range, first run).
* Logs decoded and applied in `(blockNumber, logIndex)` order.
* `EscrowCreated` inserts `ON CONFLICT (id) DO NOTHING`; transitions update `WHERE status = 'Pending'`.
* One DB transaction per range including the checkpoint; tests show replay is a no-op and a mid-range failure rolls back.

---

## Phase 3: API

### T-08 Endpoints

Spec: §4.1, §4.2, §4.3, §4.4 · Depends on: T-07 · Status: [x]

Acceptance:

* `now` is the latest block timestamp from the RPC.
* Derived fields and `effectiveStatus` as a pure function, tested at `D - 1`, `D`, `E - 1`, `E`.
* `GET /escrows/:id` matches §4.3; `404` unknown, `400` invalid.
* `GET /escrows` filters, `PendingExpired`, id desc order, `limit` 20/100, cursor, `400` on bad input.
* `status=Pending` returns only escrows whose effective status is `Pending` (it excludes `PendingExpired`).
* An invalid `cursor` returns `400`.
* `GET /escrows` returns `{ "items": [...], "nextCursor": "<last id>" | null }`; `nextCursor` is null on the last page. The item shape is the one of `GET /escrows/:id`.
* A `limit` that is not an integer from 1 to 100 returns `400`.
* `GET /health` returns `ok` or `degraded` with lag fields; `degraded` when the RPC is unreachable or `lagBlocks > CONFIRMATIONS + HEALTH_MAX_EXTRA_LAG_BLOCKS`.
* Before the first checkpoint, `/health` reports `lastIndexedBlock: null` and counts the lag from `startBlock - 1`.

---

## Phase 4: Integration

### T-09 Docker Compose and end-to-end script

Spec: §7 · Depends on: T-08 · Status: [x]

Acceptance:

* Root `docker-compose.yml` with services `anvil`, `deploy`, `postgres` and `api`. `deploy` writes the contract address and deploy block to a shared volume as the JSON file `{ "address": "0x...", "startBlock": 1 }` (block in decimal, converted from forge's hex receipt value); `api` reads it from `DEPLOYMENT_FILE` and starts after `deploy` completes.
* Root e2e script runs against a fresh stack, creates escrows and covers confirm, reject, cancel and expire, asserting API responses.
* The end-to-end script is a bash script at the repo root using Foundry's `cast`, `curl` and `jq` (developer's choice, 2026-11-08). It deploys a mock ERC-20 from `contracts/test/mocks`.
* No automated tests are added for the Dockerfiles or the compose file; the end-to-end script is their test, and `docker compose config` checks the compose file's syntax.
* Only Anvil default test accounts are used.
* Time moves with `evm_increaseTime` followed by `evm_mine`.
* Before each assertion the script waits until `/health` reports `lastIndexedBlock` at or after the transaction's block.
* The script exits nonzero on any failed assertion.

### T-10 CI and README

Spec: §5, §6, §7 · Depends on: T-09 · Status: [x]

Acceptance:

* CI runs contract tests, API tests, `forge fmt --check` and linters. At the developer's request it also runs Slither, with the two accepted detectors excluded (see `docs/slither.md`). The Docker stack, `e2e.sh` and `make test-deep` are not part of CI.
* README covers setup, test commands, curl examples, design decisions, assumptions and future work.
* `docs/slither.md` and `docs/ai/` are complete.
* Test review (developer's request, 2026-11-08): a separate pass removes duplicated coverage only, so each requirement is tested once. The contract tests and invariants, and the projection and indexer tests, stay. Everything is re-run afterwards and the removed tests are listed in `docs/ai/log.md`.

### T-11 Architecture document

Spec: none (requested by the developer, not a §7 deliverable) · Depends on: T-09 · Status: [ ]

Scope: one file, `docs/ARCHITECTURE.md`, with Mermaid diagrams written inside the Markdown so GitHub renders them. No new dependencies and no image files. The README links to it and keeps its own short design-decisions section.

Acceptance:

* Component diagram: Anvil, the contract, the `deploy` service and the shared volume, the indexer inside the API, Postgres and the clients, showing who reads and writes what.
* Escrow lifecycle state diagram: `None → Pending → Released | Rejected | CancelledBySender | Expired`, with the cancel window and TTL, and the derived `PendingExpired` marked as never stored.
* Indexer flow for one round: head, safe head, range, `getLogs`, decode, one transaction with the checkpoint, and the failure and retry path.
* Data model diagram of `escrows` and `indexer_state`, plus a table of which event writes which column.
* Request flow for `GET /escrows` (database read, latest block timestamp as `now`, derived fields) and for `GET /health`.
* A short written explanation of the guarantees (idempotency, atomicity, ordering), how time is handled, and what is deliberately not done (deep reorgs, backoff, raw event table), each point tied to the file that implements it.
* Every file path, name and rule in the document is checked against the repository before the task is closed.

### T-12 Permit creation (EIP-2612)

Spec: §2.3, §2.4, §2.5, §2.6, §2.9, §2.10 · Depends on: T-10 · Status: [ ]

Scope: an optional feature chosen by the developer on 2026-11-09 and added to the spec. `createEscrowWithPermit` creates an escrow with an EIP-2612 signature instead of a separate `approve` transaction. Only the contract changes; the indexer, the schema and the API stay as they are because the event is the same.

Acceptance:

* `createEscrowWithPermit(token, beneficiary, amount, deadline, v, r, s)` as in §2.3, with NatSpec. It uses OpenZeppelin's `IERC20Permit` as installed; nothing is copied into `src/`.
* The deposit logic lives in one internal function used by both create functions, each under its own `nonReentrant`. The existing `createEscrow` behaves exactly as before.
* The checks run in the order of §2.4: `ZeroAmount`, `InvalidBeneficiary` and `InvalidToken` before the token is called, then the permit, then `UnsupportedToken`. New error `PermitFailed()` with NatSpec.
* The permit is called inside `try/catch` and the allowance is read afterwards; an allowance below `amount` reverts with `PermitFailed()` (§2.5). The permit approves exactly `amount`.
* `EscrowCreated` is unchanged. `decode.spec.ts` still passes, and nothing in `api/` needs to change.
* Mocks in `contracts/test/mocks/`: a token with `permit` (OpenZeppelin's `ERC20Permit`) and a token with a permissive fallback function that does not implement `permit`. Signatures are produced with `vm.sign`.
* Tests for each case in the §2.10 permit item: valid signature, expired deadline, wrong signer, replayed signature, a signature submitted first by a third party, a token without `permit`, the fallback token, an existing allowance without a valid signature, validation order, reentrancy, and a fee-on-transfer token still rejected with `UnsupportedToken`. A test shows the escrow and the event equal those of `createEscrow` for the same inputs.
* The invariant handler creates escrows with both functions, its counters show the permit path is reached, and I1 to I3 hold.
* `forge fmt --check` and `forge test` pass. Slither is re-run; any new finding is triaged in `docs/slither.md`, and if it is accepted its detector is added to `--exclude` in `.github/workflows/ci.yml` in the same change.
* Documentation: the README moves Permit from future work to the feature list and design decisions, `docs/ARCHITECTURE.md` shows the second create path if T-11 is done, `docs/manual-test.md` gets a permit scenario, and `docs/ai/log.md` gets the entry.
* Optional: an `e2e.sh` scenario that creates an escrow with a permit signature obtained from Anvil (`eth_signTypedData_v4` for a default account), so no key is added to the repository. If that is not possible without a key, the permit path stays covered by the Foundry tests only and the log says so.

---

## Resolved decisions

Answered by the developer on 2026-11-07 and reconciled into `docs/SPEC.md` (§2.6, §3.1, §4.3).

* T-01: latest stable OpenZeppelin 5.x release tag with a published audit.
* T-05: the deploy script is in scope (now required by the `deploy` service in §7).
* T-06: `viem` for RPC, `pg` for Postgres, no ORM.
* T-08: `status=Pending` excludes `PendingExpired`.
* T-08: an invalid `cursor` returns `400`.
* T-08: `degraded` when `lagBlocks > CONFIRMATIONS + HEALTH_MAX_EXTRA_LAG_BLOCKS`, default `10`.
* T-09: Docker Compose and the e2e script are defined in SPEC §7; CLAUDE.md adds the conventions.
* T-06: the schema is a plain idempotent SQL file applied with `pg`, and the deploy output is a JSON file at `DEPLOYMENT_FILE`. Both answered by the developer on 2026-11-07. The T-09 `deploy` service must write that JSON file.
* T-06: use `@nestjs/config` for loading and injecting the environment instead of a hand-written provider; the validation stays custom. Answered by the developer on 2026-11-07.

* T-08: `GET /escrows` returns a wrapper `{ items, nextCursor }`. Answered by the developer on 2026-11-08 and reconciled into SPEC §4.3.
* T-08: an out-of-range or non-integer `limit` returns `400` instead of being clamped. Answered by the developer on 2026-11-08 and reconciled into SPEC §4.3.
* T-08: before the first checkpoint, `/health` shows `lastIndexedBlock: null` and measures the lag from `startBlock - 1`. Answered by the developer on 2026-11-08 and reconciled into SPEC §4.3.
* T-08: `GET /escrows` and `GET /escrows/:id` return `503` when the RPC is unreachable, and `/health` always answers `200`. Chosen while implementing T-08 and reconciled into SPEC §4.3 at the developer's request.

* T-12: include Permit (EIP-2612) creation, previously listed as out of scope. The developer chose it over fee-on-transfer support on 2026-11-09 because it only adds a path and weakens no existing guarantee. It is reconciled into SPEC §2.3 to §2.6, §2.9, §2.10 and removed from §6. Fee-on-transfer support stays out of scope.

## Open questions

None.
