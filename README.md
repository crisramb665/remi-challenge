# Remitee Escrow

ERC-20 escrow system built for the Remitee Blockchain Engineer challenge. It has two parts:

* A Solidity contract that locks tokens until the beneficiary confirms or rejects, the sender cancels or the escrow expires.
* A NestJS API that indexes contract events into Postgres and exposes read endpoints.

## Status

Work in progress. Design first: the full specification lives in [docs/SPEC.md](docs/SPEC.md) and the task backlog in [docs/TASKS.md](docs/TASKS.md).

## Stack

* Contract: Solidity 0.8.24, Foundry, OpenZeppelin 5.x (pinned audited release), Slither
* API: NestJS, TypeScript, viem, Postgres with `pg` (no ORM)
* Local network: Anvil
* Docker Compose services: `anvil`, `deploy`, `postgres`, `api`

## Repository layout

```
contracts/           Foundry project
api/                 NestJS indexer and API
docs/                Specification, tasks, Slither findings and AI logs
docker-compose.yml   Local stack
```

The end to end script lives at the repository root.

## Contracts

Requires [Foundry](https://book.getfoundry.sh/) and, for static analysis, [Slither](https://github.com/crytic/slither). Dependencies are git submodules, so clone with `--recurse-submodules` (or run `git submodule update --init --recursive`). Run these from `contracts/`:

| Command | What it does |
| --- | --- |
| `make build` | Compile the contracts |
| `make test` | Run all tests, including the invariant tests |
| `make test-deep` | Run the invariant tests with 256 runs of depth 500 (the default is 64 of depth 100, see `foundry.toml`) |
| `make fmt` / `make fmt-check` | Format the Solidity files / check the formatting |
| `make slither` | Static analysis of `src/`. Findings are triaged in [docs/slither.md](docs/slither.md) |
| `make anvil` | Start a local node |
| `make deploy-local` | Deploy to the local node. Needs `make anvil` in another terminal |
| `make deploy-info` | Print the address and the deploy block (hex) of the last local deploy |

## AI usage

AI tools are used during development. Requests, summaries and decisions to review are kept in `docs/ai/`.

API setup and test commands, curl examples, design decisions, assumptions and future work will be documented here as the implementation progresses (SPEC §7).
