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

Spec: §2.3, §2.4, §2.5, §2.6, §2.7 · Depends on: T-01 · Status: [ ]

Acceptance:

* Reverts with `ZeroAmount`, `InvalidBeneficiary` (zero and self), `InvalidToken`, `UnsupportedToken` (received amount differs).
* OZ `SafeERC20.safeTransferFrom` with balance before/after check; OZ `nonReentrant`.
* Stores `Pending` with `createdAt = block.timestamp`, increments `nextId`, emits `EscrowCreated` with correct deadlines.

### T-03 Resolution functions

Spec: §2.3, §2.4, §2.6, §2.7 · Depends on: T-02 · Status: [ ]

Scope: `cancel`, `confirm`, `reject`, `reclaimExpired`.

Acceptance:

* Each function matches the §2.3 table (caller, time rule, final status, recipient) and emits its event.
* Error order: `EscrowNotFound` → `NotPending` → `NotSender`/`NotBeneficiary` → time error with deadline argument.
* Boundary tests at `D - 1`, `D`, `E - 1`, `E` for every time-dependent action; beneficiary can act during the cancel window.
* Status written before `safeTransfer`; `nonReentrant` on all of them.
* Any action on a non-`Pending` escrow reverts with `NotPending`.

### T-04 Token mocks and invariants

Spec: §2.5, §2.9, §2.10 · Depends on: T-03 · Status: [ ]

Acceptance:

* Mocks in `contracts/test/mocks/`: no-`bool` token works end to end; fee-on-transfer reverts with `UnsupportedToken`; reentrant token cannot reenter.
* Handler-based invariant tests for I1, I2 and I3.

### T-05 Slither, formatting and deploy script

Spec: §2.10, §3.1 (`START_BLOCK`), §7 · Depends on: T-04 · Status: [ ]

Acceptance:

* `slither .` findings triaged in `docs/slither.md`; `forge fmt --check` passes.
* `script/Deploy.s.sol` deploys to Anvil with a default Anvil test account and writes the contract address and deploy block to an output file, so the `deploy` service in T-09 can place them on the shared volume. No hardcoded addresses.

---

## Phase 2: Indexer (`api/`)

### T-06 API scaffold, config and schema

Spec: §3.1, §3.3, §3.4 · Depends on: T-05 · Status: [ ]

Acceptance:

* Contract address and `START_BLOCK` are read from the deploy output on the shared volume, never hardcoded (§7, CLAUDE.md).
* NestJS app boots; config validated for `RPC_URL`, `CONFIRMATIONS`, `BATCH_SIZE`, `POLL_INTERVAL_MS`, `HEALTH_MAX_EXTRA_LAG_BLOCKS` (default `10`), database URL.
* Migration creates `escrows` and `indexer_state` as in §3.4, with indexes and lowercase addresses.
* Dependencies: `viem` as the RPC client and `pg` as the Postgres driver. No ORM.

### T-07 Ingestion and projection

Spec: §3.1, §3.2 · Depends on: T-06 · Status: [ ]

Acceptance:

* Range computation is a pure function with unit tests (clamp, empty range, first run).
* Logs decoded and applied in `(blockNumber, logIndex)` order.
* `EscrowCreated` inserts `ON CONFLICT (id) DO NOTHING`; transitions update `WHERE status = 'Pending'`.
* One DB transaction per range including the checkpoint; tests show replay is a no-op and a mid-range failure rolls back.

---

## Phase 3: API

### T-08 Endpoints

Spec: §4.1, §4.2, §4.3, §4.4 · Depends on: T-07 · Status: [ ]

Acceptance:

* `now` is the latest block timestamp from the RPC.
* Derived fields and `effectiveStatus` as a pure function, tested at `D - 1`, `D`, `E - 1`, `E`.
* `GET /escrows/:id` matches §4.3; `404` unknown, `400` invalid.
* `GET /escrows` filters, `PendingExpired`, id desc order, `limit` 20/100, cursor, `400` on bad input.
* `status=Pending` returns only escrows whose effective status is `Pending` (it excludes `PendingExpired`).
* An invalid `cursor` returns `400`.
* `GET /health` returns `ok` or `degraded` with lag fields; `degraded` when the RPC is unreachable or `lagBlocks > CONFIRMATIONS + HEALTH_MAX_EXTRA_LAG_BLOCKS`.

---

## Phase 4: Integration

### T-09 Docker Compose and end-to-end script

Spec: §7 · Depends on: T-08 · Status: [ ]

Acceptance:

* Root `docker-compose.yml` with services `anvil`, `deploy`, `postgres` and `api`. `deploy` writes the contract address and deploy block to a shared volume; `api` starts after `deploy` completes.
* Root e2e script runs against a fresh stack, creates escrows and covers confirm, reject, cancel and expire, asserting API responses.
* Only Anvil default test accounts are used.
* Time moves with `evm_increaseTime` followed by `evm_mine`.
* Before each assertion the script waits until `/health` reports `lastIndexedBlock` at or after the transaction's block.
* The script exits nonzero on any failed assertion.

### T-10 CI and README

Spec: §5, §6, §7 · Depends on: T-09 · Status: [ ]

Acceptance:

* CI runs contract tests, API tests, `forge fmt --check` and linters.
* README covers setup, test commands, curl examples, design decisions, assumptions and future work.
* `docs/slither.md` and `docs/ai/` are complete.

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

## Open questions

None.
