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
