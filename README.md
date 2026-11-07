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

## AI usage

AI tools are used during development. Requests, summaries and decisions to review are kept in `docs/ai/`.

Setup, test commands, curl examples, design decisions, assumptions and future work will be documented here as the implementation progresses (SPEC §7).
