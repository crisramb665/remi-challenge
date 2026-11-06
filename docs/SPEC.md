# Escrow System Specification

## 1. Scope

A single Solidity contract holds many ERC-20 escrows. An indexer projects contract events into Postgres. A NestJS API exposes read endpoints. The chain is the source of truth and the database is a projection of its events.

## 2. Contract

### 2.1 Constants

* `CANCEL_WINDOW = 2 hours`
* `TTL = 7 days`

Decision: constants instead of immutables. Both values are business rules, and tests move time with `vm.warp`, so making them configurable adds no testing value.

### 2.2 State

```solidity
enum Status { None, Pending, Released, Rejected, CancelledBySender, Expired }

struct Escrow {
    address sender;      // slot 0
    uint40  createdAt;   // slot 0
    Status  status;      // slot 0
    address beneficiary; // slot 1
    address token;       // slot 2
    uint256 amount;      // slot 3
}

mapping(uint256 => Escrow) private _escrows;
uint256 public nextId = 1;
```

* `None` is the zero value, so a missing id is detected without an extra mapping.
* Ids start at 1 and increase by one.
* Deadlines are derived from `createdAt` and are not stored.

### 2.3 Actions and time rules

Let `c = createdAt`, `D = c + CANCEL_WINDOW` and `E = c + TTL`.

| Function | Caller | Allowed when | Final status | Funds go to |
| --- | --- | --- | --- | --- |
| `createEscrow(token, beneficiary, amount)` | anyone, becomes sender | always | `Pending` | contract |
| `cancel(id)` | sender | `now < D` | `CancelledBySender` | sender |
| `confirm(id)` | beneficiary | `now < E` | `Released` | beneficiary |
| `reject(id)` | beneficiary | `now < E` | `Rejected` | sender |
| `reclaimExpired(id)` | sender | `now >= E` | `Expired` | sender |

Rationale: "before" is strict and "from" is inclusive. At exactly `E` only `reclaimExpired` succeeds, so there is no gap and no overlap between the beneficiary window and the expiry window.

The beneficiary may confirm or reject during the cancel window. If sender and beneficiary act in the same period, transaction ordering decides and the first one wins.

Once an escrow leaves `Pending` it can never change again.

### 2.4 Validation and errors

`createEscrow`:

* `amount == 0` reverts with `ZeroAmount()`
* `beneficiary == address(0)` or `beneficiary == msg.sender` reverts with `InvalidBeneficiary()`
* `token == address(0)` reverts with `InvalidToken()`
* received amount different from `amount` reverts with `UnsupportedToken()`

Resolution functions check in this fixed order, so tests can assert the exact error:

1. `EscrowNotFound(id)` when status is `None`
2. `NotPending(id, status)`
3. `NotSender(id)` or `NotBeneficiary(id)`
4. `CancelWindowClosed(id, D)`, `TtlElapsed(id, E)` or `NotExpiredYet(id, E)`

Note: the required event is named `EscrowExpired`, so the time errors use different names to avoid an identifier collision.

### 2.5 Token handling

* `SafeERC20` for `safeTransferFrom` and `safeTransfer`, which supports tokens that return no `bool`.
* Deposits measure the balance before and after the transfer. If the difference is not `amount`, the call reverts. Decision: rejecting fee on transfer tokens keeps the event amount equal to the locked amount and keeps invariant I1 exact. Supporting them is listed as an extension.
* Rebasing tokens are not supported.
* Tokens with blacklists (USDC, USDT): if the sender gets blacklisted, refund paths revert and funds stay locked until unblocked. Release to the beneficiary still works inside its window. Accepted as a known limitation. An alternative would be letting the sender choose a refund recipient.

### 2.6 Security

* Checks, effects, interactions: status is written before any outbound transfer.
* `nonReentrant` on every state changing function. `createEscrow` must transfer before writing state because of the balance check, so the guard is required there and kept everywhere as defense in depth.
* No owner, no pause, no upgradeability and no rescue function. Only the parties in the table above can move funds.
* Tokens sent directly to the contract are not attributed to any escrow and remain locked. A rescue function would contradict the rule that nobody else can move funds.
* Fixed pragma (`0.8.24`) and OpenZeppelin 5.x.

### 2.7 Events

```solidity
event EscrowCreated(
    uint256 indexed id,
    address indexed sender,
    address indexed beneficiary,
    address token,
    uint256 amount,
    uint64 cancelDeadline,
    uint64 expiresAt
);
event EscrowCancelled(uint256 indexed id);
event EscrowReleased(uint256 indexed id);
event EscrowRejected(uint256 indexed id);
event EscrowExpired(uint256 indexed id);
```

`EscrowCreated` carries every field the API needs. Transition events only need the id because the record already exists. `token` is not indexed because Solidity allows three indexed fields; filtering by token happens in the database.

### 2.8 Views

* `getEscrow(id)` returns the stored fields plus `cancelDeadline` and `expiresAt`. Reverts with `EscrowNotFound(id)` for unknown ids.

### 2.9 Invariants

Tested with Foundry invariant tests through a handler that creates and resolves escrows with random actors, amounts and time jumps.

* I1: for each token, `balanceOf(escrow)` equals the sum of `amount` over `Pending` escrows. It is an equality in tests because the handler never donates; in general it is `>=`.
* I2: an escrow outside `Pending` never changes status.
* I3: for each resolved escrow, the amount paid to the beneficiary plus the amount refunded to the sender equals `amount`, and only one of them is nonzero.

### 2.10 Test plan

* Happy path for every action.
* Every revert, asserting selector and arguments.
* Time boundaries at `D - 1`, `D`, `E - 1` and `E` for every time dependent action.
* Mock tokens: no `bool` return, fee on transfer (expect revert) and reentrant token.
* Slither run with each finding triaged in `docs/slither.md`.

## 3. Indexer

### 3.1 Ingestion

* Polling with `getLogs` over block ranges instead of a websocket subscription. Rationale: ranges plus a checkpoint survive restarts and dropped connections; a subscription would need the same backfill logic anyway.
* Config: `START_BLOCK` (deploy block), `CONFIRMATIONS`, `BATCH_SIZE`, `POLL_INTERVAL_MS`.
* Loop:
  1. `safeHead = head - CONFIRMATIONS`
  2. `from = lastProcessedBlock + 1`
  3. `to = min(safeHead, from + BATCH_SIZE - 1)`
  4. If `from > to`, wait and retry.
* Logs are applied in `(blockNumber, logIndex)` order.

### 3.2 Atomicity and idempotency

* One database transaction per range: apply the projection and advance the checkpoint. A crash rolls everything back and the range is processed again on restart.
* `EscrowCreated` inserts with `ON CONFLICT (id) DO NOTHING`.
* Transition events update with `WHERE id = $id AND status = 'Pending'`, setting the final status, `resolved_tx` and `resolved_block`.
* Replaying any event is therefore a no op, which makes reprocessing a range safe.
* Decision: no raw event table. The two guards above are enough for idempotency, and the transaction hashes the API returns fit in the `escrows` row. A raw event log only pays off for rebuilding the projection or rolling back deep reorgs (see 3.3).

### 3.3 Reorgs

* Only blocks with `CONFIRMATIONS` confirmations are indexed, so stored data is treated as final. The value is chosen per chain; on Ethereum the `finalized` block tag is an alternative.
* Limitation: a reorg deeper than `CONFIRMATIONS` would leave the projection wrong.
* With more time: add a raw event log keyed by `(tx_hash, log_index)` with block hashes, compare parent hashes on every batch and on mismatch delete the affected events and rebuild the projection from the log.

### 3.4 Schema

```
escrows(
  id numeric primary key,
  sender text, beneficiary text, token text,
  amount numeric(78,0),
  cancel_deadline bigint, expires_at bigint,
  status text,
  created_tx text, created_block bigint,
  resolved_tx text null, resolved_block bigint null,
  updated_at timestamptz
)
indexer_state(
  id int primary key check (id = 1),
  last_block bigint, updated_at timestamptz
)
```

Indexes on `sender`, `beneficiary` and `status`. Addresses are stored lowercase.

## 4. API

### 4.1 Time reference

`now` is the timestamp of the latest block returned by the RPC, not the server clock. Rationale: the demo script moves Anvil time forward, and on live chains both values are close.

Known approximation: the next block always has a larger timestamp, so at `D - 1` the API may report `canCancel: true` while a transaction would land at `D` and revert.

### 4.2 Derived fields

* `canCancel = status == Pending && now < D`
* `canConfirm = canReject = status == Pending && now < E`
* `canReclaim = status == Pending && now >= E`
* `effectiveStatus = "PendingExpired"` when `status == Pending && now >= E`, otherwise equal to `status`

### 4.3 Endpoints

`GET /escrows/:id`

```json
{
  "id": "1",
  "sender": "0x...",
  "beneficiary": "0x...",
  "token": "0x...",
  "amount": "1000000",
  "cancelDeadline": 1762300000,
  "expiresAt": 1762897600,
  "status": "Pending",
  "effectiveStatus": "PendingExpired",
  "canCancel": false,
  "canConfirm": false,
  "canReject": false,
  "canReclaim": true,
  "transactions": { "created": "0x...", "resolved": null }
}
```

Returns `404` for unknown ids and `400` for invalid ids.

`GET /escrows?sender=&beneficiary=&status=&limit=&cursor=`

* Ordered by id descending. `limit` defaults to 20, maximum 100. `cursor` is the last id of the previous page.
* `status` accepts the onchain statuses plus `PendingExpired`.
* Invalid addresses or statuses return `400`.

`GET /health`

```json
{ "status": "ok", "chainId": 31337, "lastIndexedBlock": 120, "chainHead": 121, "lagBlocks": 1 }
```

`status` is `degraded` when the RPC is unreachable or the lag exceeds a configured threshold.

Amounts are decimal strings because `uint256` exceeds the JavaScript number range.

### 4.4 Consistency

Data lags the chain by at least `CONFIRMATIONS` blocks. The API can show `Pending` for an escrow that was already resolved onchain in the last blocks. `/health` exposes the lag.

## 5. Assumptions

* Anyone can create an escrow for any ERC-20; there is no token allowlist.
* One beneficiary per escrow and no partial releases.
* The API is read only. Users sign transactions from their own wallets.
* A single chain and a single contract deployment.

## 6. Out of scope, possible extensions

* Permit (EIP-2612) creation.
* Webhooks on state changes.
* Fee on transfer support recording the received amount.
* Reorg rollback with block hash tracking.
* Authentication and rate limiting for the API.
