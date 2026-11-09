# Remitee Escrow

ERC-20 escrow system built for the Remitee Blockchain Engineer challenge. It has two parts:

* A Solidity contract that locks tokens until the beneficiary confirms or rejects, the sender cancels or the escrow expires.
* A NestJS API that indexes contract events into Postgres and exposes read endpoints.

The full specification is [docs/SPEC.md](docs/SPEC.md) and the task backlog is [docs/TASKS.md](docs/TASKS.md).

## Stack

* Contract: Solidity 0.8.24, Foundry, OpenZeppelin 5.x (pinned audited release), Slither
* API: NestJS, TypeScript, viem, Postgres with `pg` (no ORM)
* Local network: Anvil
* Docker Compose services: `anvil`, `deploy`, `postgres`, `api`

## Repository layout

```
contracts/           Foundry project, deploy.sh and the deploy image
api/                 NestJS indexer and API
docs/                Specification, tasks, Slither findings, manual test, Postman collection, AI logs
docker-compose.yml   Local stack
e2e.sh               End to end script
.github/workflows/   CI
```

## Quick start

Requirements: Docker with Compose v2, plus [Foundry](https://book.getfoundry.sh/), `jq` and `curl` for the end to end script. Dependencies in `contracts/lib` are git submodules, so clone with `--recurse-submodules` (or run `git submodule update --init --recursive`).

```
docker compose up -d --build --wait
```

This starts Anvil on port 8545, Postgres, a one-shot `deploy` job that deploys the contract and writes its address and deploy block to a shared volume, and the API on port 3000. Everything is in memory, so every start is a new chain and a new database. Stop and clean up with `docker compose down -v`.

Run the end to end script against a **fresh** stack. It creates four escrows and runs confirm, reject, cancel and expire, moving Anvil's clock, and checks what the API answers. It stops with exit code 1 at the first failed check:

```
docker compose down -v && docker compose up -d --build --wait && bash e2e.sh
```

## API

All reads, no authentication. Amounts are decimal strings because a `uint256` does not fit a JavaScript number. Escrows appear once their block has `CONFIRMATIONS` (2 in Compose) confirmations; on Anvil, mine blocks with `cast rpc evm_mine` to speed that up.

```
curl -s localhost:3000/health
# {"status":"ok","chainId":31337,"lastIndexedBlock":120,"chainHead":122,"lagBlocks":2}

curl -s localhost:3000/escrows/1
# {"id":"1","sender":"0xf39f…","beneficiary":"0x7099…","token":"0x5fbd…","amount":"1000000",
#  "cancelDeadline":1762300000,"expiresAt":1762897600,"status":"Pending","effectiveStatus":"Pending",
#  "canCancel":true,"canConfirm":true,"canReject":true,"canReclaim":false,
#  "transactions":{"created":"0x…","resolved":null}}

curl -s 'localhost:3000/escrows?sender=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266&status=Pending&limit=2'
# {"items":[ … ],"nextCursor":"3"}

curl -s 'localhost:3000/escrows?limit=2&cursor=3'      # next page; nextCursor is null on the last page
curl -s 'localhost:3000/escrows?status=PendingExpired' # Pending in the contract, past its 7 day TTL
```

| Endpoint | Notes |
| --- | --- |
| `GET /escrows/:id` | `404` for an unknown id, `400` for an invalid one |
| `GET /escrows` | Filters `sender`, `beneficiary`, `status`, `limit` (1 to 100, default 20) and `cursor`. Newest first. Any invalid value is a `400` |
| `GET /health` | `ok` or `degraded`, always `200`. Degraded when the node is unreachable or the indexer lags by more than `CONFIRMATIONS` plus `HEALTH_MAX_EXTRA_LAG_BLOCKS` blocks |

`status` accepts the contract statuses (`Pending`, `Released`, `Rejected`, `CancelledBySender`, `Expired`) and `PendingExpired`. Filtering applies to the effective status, so `status=Pending` leaves out escrows that are `PendingExpired`. The exact rules are in [SPEC §4](docs/SPEC.md).

Sending transactions (a token, `createEscrow`, `confirm`, ...) is done from the wallet or with `cast`. [docs/manual-test.md](docs/manual-test.md) walks through every scenario step by step, and [docs/postman/](docs/postman/) holds a Postman collection with every API request and Anvil's JSON-RPC calls for mining blocks and moving time.

### Settings

The API reads these from the environment (see [api/.env.example](api/.env.example)); Compose sets them. A missing or malformed value stops the app at startup with a message listing every problem.

| Variable | Meaning |
| --- | --- |
| `RPC_URL` | Node to read from |
| `DATABASE_URL` | Postgres connection string |
| `CONFIRMATIONS` | Blocks to wait before indexing a block |
| `BATCH_SIZE` | Blocks per `getLogs` request |
| `POLL_INTERVAL_MS` | Pause between polls when caught up |
| `HEALTH_MAX_EXTRA_LAG_BLOCKS` | Lag allowed beyond `CONFIRMATIONS` before `/health` is `degraded` (default 10) |
| `DEPLOYMENT_FILE` | JSON with the contract `address` and `startBlock` (default `/shared/deployment.json`) |

## Tests

| What | Command |
| --- | --- |
| Contract tests, including invariants | `cd contracts && make test` |
| Deeper invariant run (256 runs of depth 500) | `cd contracts && make test-deep` |
| Solidity formatting | `cd contracts && make fmt-check` |
| Static analysis | `cd contracts && make slither` (findings triaged in [docs/slither.md](docs/slither.md)) |
| API lint, build | `pnpm --dir api lint` and `pnpm --dir api build` |
| API unit tests | `pnpm --dir api test` |
| API HTTP tests (whole app, fake node) | `pnpm --dir api test:e2e` |
| Whole stack | `bash e2e.sh` against a fresh Compose stack |

The API tests that need a database are skipped, with a warning, unless `TEST_DATABASE_URL` is set. Start a throwaway Postgres and set it:

```
docker run --rm --name escrow-test-db -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=escrow -p 5432:5432 -d postgres:16-alpine
export TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/escrow
```

Each test file works in its own Postgres schema and drops it afterwards. The API needs Node 26 and pnpm 12.15.0. CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs the contract tests, `forge fmt --check`, Slither, and the API lint, build and tests against a Postgres service.

### Local contract commands

Run from `contracts/`:

| Command | What it does |
| --- | --- |
| `make build` | Compile the contracts |
| `make anvil` | Start a local node |
| `make deploy-local` | Deploy to the local node. Needs `make anvil` in another terminal |
| `make deploy-info` | Print the address and the deploy block (hex) of the last local deploy |
| `make fmt` | Format the Solidity files |

## Design decisions

Each one has its rationale in the spec; the section is in brackets.

* **Time rules.** "Before" is strict and "from" is inclusive, so at exactly the expiry only `reclaimExpired` succeeds, with no gap and no overlap with the beneficiary's window (§2.3). The 2 hour cancel window and the 7 day TTL are constants, not configuration (§2.1).
* **Exact amounts.** Deposits compare the balance before and after the transfer and revert with `UnsupportedToken` on a mismatch, so fee-on-transfer tokens are rejected and the locked amount always equals the event amount (§2.5). `SafeERC20` handles tokens that return no `bool`.
* **No admin.** No owner, pause, upgrade or rescue function. Only the sender and the beneficiary can move an escrow's funds, so tokens sent directly to the contract stay locked (§2.6).
* **OpenZeppelin as installed.** `SafeERC20` and `ReentrancyGuard` from a pinned, audited release; security primitives are never reimplemented (§2.6). State is written before any outbound transfer.
* **Polling, not subscriptions.** The indexer reads `getLogs` in ranges up to the safe head (head minus `CONFIRMATIONS`) and keeps a checkpoint, so it survives restarts and dropped connections (§3.1).
* **Replays are harmless.** One database transaction per range holds the events and the checkpoint. `EscrowCreated` inserts with `ON CONFLICT DO NOTHING` and transitions update `WHERE status = 'Pending'`, so reprocessing a range changes nothing (§3.2). There is no raw event table.
* **The chain's clock.** `now` is the timestamp of the latest block, not the server's clock, so moving Anvil's time moves the API (§4.1). `effectiveStatus` shows `PendingExpired` for a Pending escrow past its TTL, which is never stored (§4.2).
* **Plain SQL.** The schema is one idempotent file applied at startup with `pg`. There is no ORM and no migration library (§3.4).
* **Nothing hardcoded.** The `deploy` job writes the contract address and the deploy block to a shared volume, and the API reads them from there. Only Anvil's default test accounts are used.

## Assumptions

* Anyone can create an escrow for any ERC-20; there is no token allowlist.
* One beneficiary per escrow and no partial releases.
* The API is read only. Users sign transactions from their own wallets.
* A single chain and a single contract deployment.
* One API instance per database.

## Known limitations

* A reorg deeper than `CONFIRMATIONS` would leave the database wrong. Stored data is treated as final (§3.3).
* The API can show `Pending` for an escrow already resolved onchain in the last blocks. `/health` shows the lag (§4.4).
* Tokens with blacklists (USDC, USDT): if the sender is blacklisted, refund paths revert until it is unblocked (§2.5).
* Block timestamps can shift by seconds, so near a deadline the API may say `canCancel: true` for a transaction that would then revert (§4.1).
* A failed indexing round is retried after `POLL_INTERVAL_MS` with no backoff and no retry limit. A `BATCH_SIZE` above what the node allows per `getLogs` makes every round fail.
* `GET /escrows` and `GET /escrows/:id` make one RPC call each, for the latest block, and answer `503` when the node is unreachable.
* If the chain is reset while the database keeps its data, the indexer stays idle because the node's head is below its checkpoint.
* Slither runs in CI without the two detectors triaged as accepted, so a new finding from those two would not fail the job ([docs/slither.md](docs/slither.md)).

## Future work

* Permit (EIP-2612) creation.
* Webhooks on state changes.
* Fee-on-transfer support, recording the received amount.
* Reorg rollback with block hash tracking and a raw event log (§3.3).
* Authentication and rate limiting for the API.
* Exponential backoff with jitter for the indexer, and a degraded `/health` after repeated failures.
* A short cache for the latest block, to avoid one RPC call per request.
* Running the Compose stack and `e2e.sh` in CI.
* A baseline check for Slither that fails on any change from the accepted findings.

## Documentation

* [docs/SPEC.md](docs/SPEC.md): specification, the source of truth.
* [docs/TASKS.md](docs/TASKS.md): task backlog and resolved decisions.
* [docs/slither.md](docs/slither.md): static analysis findings and how CI runs them.
* [docs/manual-test.md](docs/manual-test.md): the manual walkthrough with expected results.
* [docs/postman/](docs/postman/): Postman collection.
* [docs/ai/](docs/ai/): requests, summaries and decisions to review for every task.

## AI usage

AI tools are used during development. Requests, summaries and decisions to review are kept in `docs/ai/`, and the working rules for the assistant are in [CLAUDE.md](CLAUDE.md).
