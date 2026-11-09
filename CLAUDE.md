# CLAUDE.md

## Source of truth

* `docs/SPEC.md` defines behavior, errors, events, invariants and API contracts. Follow it exactly.
* Never change `docs/SPEC.md` unless explicitly asked. If an implementation detail conflicts with the spec or the spec is ambiguous, stop and ask.

## Layout

* `contracts/`: Foundry project. Run every Foundry command from this folder.
* `api/`: NestJS indexer and API.
* `docs/`: specification, Slither findings and AI logs.
* Repository root: `docker-compose.yml` and the end to end script.

## Working rules

* Work on one task at a time and keep changes small.
* Write or update tests together with each function. A change is done only when tests pass.
* Do not add dependencies beyond those listed in the spec, or features and abstractions it does not require
* Do not commit. The developer reviews and commits every change.
* Do not run commands that change the project (installs, scaffolding, git, file moves, builds that write files). Give them to the developer one by one, in order, with a short note on what each does, and wait for the result before the next step. Read-only checks are fine.
* End every response with the list of commands used or proposed.
* After each task, append to `docs/ai/log.md`: the request, a short summary of what was done and any decision that needs review.

## Solidity

* Solidity `0.8.24`, OpenZeppelin 5.x.
* Custom errors only, no revert strings.
* Checks, effects, interactions in every state changing function.
* `SafeERC20` for every token transfer.
* NatSpec on external functions, events and errors.
* Never write custom implementations of functionality that OpenZeppelin already provides (token transfers, reentrancy guards, access control, math). Use the library as installed and do not copy its code into `src/`.
* Install OpenZeppelin with a pinned release tag. Do not use other libraries without asking.

## Commands

`contracts/Makefile` wraps the long Foundry, Anvil and Slither commands. Run `make` targets from `contracts/` and prefer them over the raw commands. Check `contracts/Makefile` for the exact command behind a target.

```
cd contracts && make build        # forge build
cd contracts && make test         # forge test -vvv
cd contracts && make test-deep    # invariants at 256 runs of depth 500
cd contracts && make fmt          # forge fmt
cd contracts && make fmt-check    # forge fmt --check
cd contracts && make slither      # slither on src/ only, see docs/slither.md
cd contracts && make anvil        # local node
cd contracts && make deploy-local # deploy to the local node
cd contracts && make deploy-info  # address and deploy block of the last local deploy
```

When a Makefile target changes, update this list in the same task.

API and full stack, from the repository root:

```
pnpm --dir api format                 # prettier
pnpm --dir api lint                   # oxlint
pnpm --dir api build                  # nest build
pnpm --dir api test                   # unit tests
pnpm --dir api test:e2e               # HTTP tests with the whole app and a fake node
docker compose up -d --build --wait   # anvil, postgres, deploy and api
bash e2e.sh                           # end to end against that stack, which must be fresh
docker compose down -v                # remove the stack and its volume, needed before each e2e.sh run
```

The database tests need a Postgres and `TEST_DATABASE_URL`, for example `postgres://postgres:postgres@localhost:5432/escrow` against `docker run --rm --name escrow-test-db -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=escrow -p 5432:5432 -d postgres:16-alpine`. Without it they are skipped with a warning. `docs/manual-test.md` describes the manual walkthrough and `docs/postman/` holds the Postman collection.

## Docker and end to end

* Behavior is defined in SPEC §7. This section only covers conventions.
* Never hardcode contract addresses or deploy blocks. The `deploy` service writes them to the shared volume and the API reads them from there.
* Use only Anvil's default test accounts. Never use or request real keys.
* Advance time with `evm_increaseTime` followed by `evm_mine`, so the API sees the new block timestamp.
* Before asserting API responses, wait until `/health` reports a `lastIndexedBlock` at or after the block of the transaction being checked.
* The script must run against a fresh stack and exit with a nonzero code on any failed assertion.
