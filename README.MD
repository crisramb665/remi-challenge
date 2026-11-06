# Remitee Escrow

ERC-20 escrow system built for the Remitee Blockchain Engineer challenge. It has two parts:

* A Solidity contract that locks tokens until the beneficiary confirms or rejects, the sender cancels or the escrow expires.
* A NestJS API that indexes contract events into Postgres and exposes read endpoints.

## Status

Work in progress. Design first: the full specification lives in [docs/SPEC.md](docs/SPEC.md).

## Stack

* Contract: Solidity 0.8.24, Foundry, OpenZeppelin 5.x, Slither
* API: NestJS, TypeScript, viem, Postgres
* Local network: Anvil

## Repository layout

```
contracts/   Foundry project
api/         NestJS indexer and API
docs/        Specification, Slither findings and AI prompts
scripts/     End to end flow
```

## AI usage

AI tools are used during development. Prompts and outputs are kept in `docs/ai/`.

Setup, design decisions and assumptions will be documented here as the implementation progresses.
