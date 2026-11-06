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
* Do not add dependencies, features or abstractions that the spec does not require.
* Do not commit. The developer reviews and commits every change.
* After each task, append to `docs/ai/log.md`: the request, a short summary of what was done and any decision that needs review.

## Solidity

* Solidity `0.8.24`, OpenZeppelin 5.x.
* Custom errors only, no revert strings.
* Checks, effects, interactions in every state changing function.
* `SafeERC20` for every token transfer.
* NatSpec on external functions, events and errors.

## Commands

```
cd contracts && forge build
cd contracts && forge test -vvv
cd contracts && forge fmt
cd contracts && slither .
```

API and Docker commands will be added once they exist.
