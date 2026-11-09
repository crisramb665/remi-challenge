# Manual test of the stack (T-09)

What was checked by hand against the full Docker Compose stack, how, and what each check should show. The same story is automated in `e2e.sh`; the Postman collection in `docs/postman/escrow-api.postman_collection.json` holds every API request used here.

## Environment

* `docker compose up -d --build --wait` with the services `anvil`, `postgres`, `deploy` and `api` (see `docker-compose.yml`).
* Images: Foundry `v1.5.1` (Anvil and the deploy job), `postgres:16-alpine`, `node:26-alpine` (API).
* API settings in compose: `CONFIRMATIONS=2`, `BATCH_SIZE=500`, `POLL_INTERVAL_MS=500`.
* Anvil starts empty on every run and Postgres is on tmpfs, so each `docker compose down -v && docker compose up` is a fresh chain and a fresh database.
* Accounts: Anvil's default test accounts only. Alice (account 0) is the sender and Bob (account 1) is the beneficiary.
* Tools: a terminal with `cast` and `forge` for the transactions, Postman (or curl) for the API, and Anvil's JSON-RPC (`evm_mine`, `evm_increaseTime`) for blocks and time.

## How it was run

1. Start a fresh stack: `docker compose down -v`, then `docker compose up -d --build --wait`.
2. Copy the deployment file out of the `deploy` container: `docker compose cp deploy:/shared/deployment.json /tmp/deployment.json`.
3. In the terminal, deploy `contracts/test/mocks/MockERC20.sol` with `forge create`, mint to Alice and approve the escrow contract.
4. In the terminal, send the transactions with `cast send --unlocked --from <account>`.
5. After sending transactions, mine 2 blocks (`evm_mine` twice, because `CONFIRMATIONS=2`) and wait about 2 seconds, so the indexer can read them.
6. Check the API with Postman or curl.

Transactions are not sent from Postman, because it cannot sign. Blocks and time are moved from Postman through Anvil's JSON-RPC.

## Scenarios and expected results

Escrow ids are 1 to 4 on a fresh stack. Escrow 1 is confirmed, 2 rejected, 3 cancelled and 4 expires. Each has a different amount (1000000, 2000000, 3000000, 4000000), so a mix-up shows up.

| # | Scenario | Action | Expected | Spec |
| --- | --- | --- | --- | --- |
| 1 | Stack boots | `docker compose up --wait` | `anvil`, `postgres`, `api` healthy; `deploy` exited with code 0 | §7 |
| 2 | Deployment file | read `/shared/deployment.json` | `address` of the contract and `startBlock` as a decimal number | §7, T-05 |
| 3 | Health, fresh | `GET /health` | `status: ok`, `chainId: 31337`; `lastIndexedBlock` null or a number with `lagBlocks` 2 | §4.3 |
| 4 | Create four escrows | four `createEscrow` calls, mine 2 blocks | `GET /escrows/1` is `Pending` with `canCancel`, `canConfirm`, `canReject` true and `canReclaim` false; `transactions.resolved` null; deadlines 2 hours and 7 days after creation | §2.3, §4.2 |
| 5 | List | `GET /escrows` | ids 4, 3, 2, 1 and `nextCursor` null | §4.3 |
| 6 | Filters | `sender=` Alice, `beneficiary=` Bob, `sender=` Bob | 4 items, 4 items, none; addresses work in any letter case | §4.3 |
| 7 | Confirm | Bob calls `confirm(1)` | escrow 1 `Released`, every `can*` false, `transactions.resolved` is the hash of that transaction | §2.3 |
| 8 | Reject | Bob calls `reject(2)` | escrow 2 `Rejected`, same checks | §2.3 |
| 9 | Cancel | Alice calls `cancel(3)` inside the 2 hour window | escrow 3 `CancelledBySender`, same checks | §2.3 |
| 10 | Status filters | `status=Released`, `Rejected`, `CancelledBySender`, `Pending` | ids 1, 2, 3 and 4 respectively | §4.3 |
| 11 | Time passes the TTL | `evm_increaseTime 608400`, then `evm_mine` | escrow 4: stored `status` still `Pending`, `effectiveStatus` `PendingExpired`, only `canReclaim` true. No indexing is needed, because `now` is the latest block timestamp from the node | §4.1, §4.2 |
| 12 | Effective status filter | `status=Pending`, `status=PendingExpired` | `Pending` no longer lists escrow 4 (empty); `PendingExpired` lists only escrow 4 | §4.3 |
| 13 | Reclaim | Alice calls `reclaimExpired(4)` | escrow 4 `Expired`, `effectiveStatus` `Expired`, `canReclaim` false | §2.3 |
| 14 | Pagination | `limit=2`, then `limit=2&cursor=3` | first page ids 4, 3 with `nextCursor` "3"; second page ids 2, 1 with `nextCursor` null | §4.3 |
| 15 | Errors | unknown id; `abc`; `limit=0`; `limit=101`; `cursor=abc`; `status=Frozen`; `sender=nope`; `sender=` (empty) | 404 for the unknown id, 400 for all the others | §4.3 |
| 16 | Balances | `balanceOf` on Bob, Alice and the escrow contract | Bob 1000000, Alice 9000000, contract 0 | §2.9 |
| 17 | API restart | `docker compose restart api` | `lastIndexedBlock` unchanged and the same escrows, none duplicated (the checkpoint is in Postgres) | §3.2 |
| 18 | Node down | `docker compose stop anvil` | `/health` answers 200 with `status: degraded` and nulls; `GET /escrows/1` answers 503. Anvil starts a new chain on `start`, so run `down -v` afterwards | §4.3 |
| 19 | Create with a permit | with `MockPermitERC20`, sign the permit for Alice with Anvil (`eth_signTypedData_v4`), then call `createEscrowWithPermit` | the escrow shows in the API exactly like one made with `createEscrow`: `Pending`, its token is the permit token, `transactions.created` is that transaction, and Alice's allowance to the contract is 0 afterwards. Nothing in the indexer or the API is different | §2.3, §2.5 |

## Result

Status on 2026-11-09:

* Scenarios 1 and 2 were checked from the container states and logs during the session: `anvil`, `postgres` and `api` healthy, `deploy` exited with 0, and its log ending with `EscrowManager at 0x5fbdb2315678afecb367f032d93f642f64180aa3, deployed in block 1, written to /shared/deployment.json`.
* Scenario 19 (permit creation) was added with task T-12. It is automated as Phase 5 of `e2e.sh`, which passed on 2026-11-09 against a fresh stack built with the new contract: 13 checks, ending in `All checks passed`. The contract side is covered by `contracts/test/CreateEscrowWithPermit.t.sol` and the invariant tests.
* Scenarios 3 to 18: the developer reported running them with curl and Postman against this stack. No outputs were kept, so this document records the expected results and does not claim a result per scenario. Any deviation found should be written here.
* `e2e.sh` was run on 2026-11-09 against a fresh stack (`docker compose down -v`, then `docker compose up -d --build --wait`, then `bash e2e.sh`). Every check printed `ok` and it ended with `All checks passed`. It automates scenarios 1 to 16 apart from the API restart and node-down checks (17 and 18), which remain manual.

## Not covered here

* A real network. On a public testnet such as Sepolia: transactions need `--account` instead of `--unlocked`; blocks take about 12 seconds and cannot be mined by hand; `CONFIRMATIONS` should be higher; `BATCH_SIZE` must respect the provider's limit for `eth_getLogs`; and the Docker `deploy` and `anvil` services are not used, so the API runs on its own with a hand-written deployment file. The 2 hour window and the 7 day TTL are fixed by the contract, so scenarios 11, 12 and 13 would take a week of real time.
* Reorgs deeper than `CONFIRMATIONS` (an accepted limitation, SPEC §3.3).
* Load. Every API request makes one RPC call for the latest block, with no caching.
