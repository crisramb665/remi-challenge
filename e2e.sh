#!/usr/bin/env bash
# End to end check of the whole stack (SPEC section 7): creates escrows on a local Anvil, runs
# confirm, reject, cancel and expire, moves Anvil's time, and asserts what the API answers. Last, it
# creates one more escrow with an EIP-2612 permit signed by Anvil, and confirms it.
#
# It needs a FRESH stack (new Anvil, empty database) with the contract already deployed, and it
# stops at the first failed check with exit code 1. Needs forge, cast, jq and curl.
#
#   docker compose down -v && docker compose up -d --build --wait && bash e2e.sh
#
# Settings, all optional:
#   RPC_URL          the node                     (default http://127.0.0.1:8545)
#   API_URL          the API                      (default http://127.0.0.1:3000)
#   CONFIRMATIONS    must equal the API's setting (default 2)
#   DEPLOYMENT_FILE  the file written by the deploy step. Without it the file is copied out of
#                    the `deploy` container of docker compose.
#
# Only Anvil's default test accounts are used. They are public and hold no real funds.

set -euo pipefail
cd "$(dirname "$0")"

RPC_URL=${RPC_URL:-http://127.0.0.1:8545}
API_URL=${API_URL:-http://127.0.0.1:3000}
CONFIRMATIONS=${CONFIRMATIONS:-2}

ALICE=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 # Anvil account 0, the sender
BOB=0x70997970C51812dc3A010C7d01b50e0d17dc79C8   # Anvil account 1, the beneficiary

# Amounts are all different, so a mix-up between escrows shows up in the checks.
CONFIRM_AMOUNT=1000000
REJECT_AMOUNT=2000000
CANCEL_AMOUNT=3000000
EXPIRE_AMOUNT=4000000
MINTED=10000000
PERMIT_AMOUNT=5000000

WEEK_AND_AN_HOUR=$((7 * 24 * 3600 + 3600)) # past the 7 day TTL

# ---------------------------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------------------------

die() {
  echo "FAILED: $*" >&2
  exit 1
}

# expect <what> <expected> <actual>
expect() {
  if [ "$3" = "$2" ]; then
    echo "  ok  $1"
  else
    die "$1 (expected '$2', got '$3')"
  fi
}

lower() { tr '[:upper:]' '[:lower:]' <<<"$1"; }

api_get() { curl -fsS "$API_URL$1"; }
http_code() { curl -s -o /dev/null -w '%{http_code}' "$API_URL$1"; }
field() { jq -r "$2" <<<"$1"; }
ids_of() { jq -r '[.items[].id] | join(",")' <<<"$1"; }

# send <from> <cast send arguments...>: sends a transaction and sets LAST_BLOCK and LAST_TX.
send() {
  local from=$1 receipt
  shift
  receipt=$(cast send --json --rpc-url "$RPC_URL" --unlocked --from "$from" "$@")
  LAST_BLOCK=$(($(jq -r .blockNumber <<<"$receipt"))) # cast may print it in hex
  LAST_TX=$(jq -r .transactionHash <<<"$receipt")
}

call() { cast call --rpc-url "$RPC_URL" "$@" | awk '{ print $1 }'; }
balance_of() { call "$TOKEN" 'balanceOf(address)(uint256)' "$1"; }

mine() {
  local i
  for ((i = 0; i < $1; i++)); do cast rpc --rpc-url "$RPC_URL" evm_mine >/dev/null; done
}

# The indexer only reads blocks with CONFIRMATIONS confirmations, so mine that many blocks after
# the last transaction, then wait until /health says the transaction's block has been indexed.
settle() {
  mine "$CONFIRMATIONS"
  local deadline=$((SECONDS + 60)) indexed health=''
  while [ "$SECONDS" -lt "$deadline" ]; do
    health=$(api_get /health || true)
    indexed=$(jq -r '.lastIndexedBlock // -1' <<<"${health:-null}" 2>/dev/null || echo -1)
    if [ "$indexed" -ge "$LAST_BLOCK" ]; then return 0; fi
    sleep 0.5
  done
  die "the API did not index block $LAST_BLOCK within 60 s (last /health: ${health:-no answer})"
}

# create_escrow <amount>: sets ESCROW_ID, CREATED_TX and CREATED_BLOCK.
create_escrow() {
  ESCROW_ID=$(call "$ESCROW" 'nextId()(uint256)')
  send "$ALICE" "$ESCROW" 'createEscrow(address,address,uint256)' "$TOKEN" "$BOB" "$1"
  CREATED_TX=$LAST_TX
  CREATED_BLOCK=$LAST_BLOCK
}

# ---------------------------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------------------------

for tool in forge cast jq curl; do
  command -v "$tool" >/dev/null || die "$tool is required"
done

cast chain-id --rpc-url "$RPC_URL" >/dev/null 2>&1 || die "no node answers at $RPC_URL"

echo "Waiting for the API at $API_URL"
for ((i = 0; i < 60; i++)); do
  curl -fsS "$API_URL/health" >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS "$API_URL/health" >/dev/null 2>&1 || die "no API answers at $API_URL"

deployment_file=${DEPLOYMENT_FILE:-}
if [ -z "$deployment_file" ]; then
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  docker compose cp deploy:/shared/deployment.json "$tmp/deployment.json" >/dev/null
  deployment_file=$tmp/deployment.json
fi
ESCROW=$(jq -er .address "$deployment_file")

expect "the stack is fresh (no escrows yet)" "" "$(ids_of "$(api_get /escrows)")"

# ---------------------------------------------------------------------------------------------
# Setup: a token, funds for Alice and her approval
# ---------------------------------------------------------------------------------------------

echo "Setup"
TOKEN=$(cd contracts && forge create test/mocks/MockERC20.sol:MockERC20 \
  --rpc-url "$RPC_URL" --unlocked --from "$ALICE" --broadcast --json |
  sed -n '/^{/,$p' | jq -er .deployedTo)
send "$ALICE" "$TOKEN" 'mint(address,uint256)' "$ALICE" "$MINTED"
send "$ALICE" "$TOKEN" 'approve(address,uint256)' "$ESCROW" "$MINTED"
expect "Alice holds the minted tokens" "$MINTED" "$(balance_of "$ALICE")"

# ---------------------------------------------------------------------------------------------
# Phase 1: four escrows are created
# ---------------------------------------------------------------------------------------------

echo "Phase 1: create four escrows"
create_escrow "$CONFIRM_AMOUNT"; CONFIRM_ID=$ESCROW_ID; CONFIRM_CREATED=$CREATED_TX; CONFIRM_BLOCK=$CREATED_BLOCK
create_escrow "$REJECT_AMOUNT"; REJECT_ID=$ESCROW_ID
create_escrow "$CANCEL_AMOUNT"; CANCEL_ID=$ESCROW_ID
create_escrow "$EXPIRE_AMOUNT"; EXPIRE_ID=$ESCROW_ID
settle

health=$(api_get /health)
expect "/health reports ok" "ok" "$(field "$health" .status)"
expect "/health reports the chain id" "31337" "$(field "$health" .chainId)"

body=$(api_get "/escrows/$CONFIRM_ID")
expect "escrow $CONFIRM_ID sender" "$(lower "$ALICE")" "$(field "$body" .sender)"
expect "escrow $CONFIRM_ID beneficiary" "$(lower "$BOB")" "$(field "$body" .beneficiary)"
expect "escrow $CONFIRM_ID token" "$(lower "$TOKEN")" "$(field "$body" .token)"
expect "escrow $CONFIRM_ID amount" "$CONFIRM_AMOUNT" "$(field "$body" .amount)"
expect "escrow $CONFIRM_ID status" "Pending" "$(field "$body" .status)"
expect "escrow $CONFIRM_ID effectiveStatus" "Pending" "$(field "$body" .effectiveStatus)"
expect "escrow $CONFIRM_ID canCancel" "true" "$(field "$body" .canCancel)"
expect "escrow $CONFIRM_ID canConfirm" "true" "$(field "$body" .canConfirm)"
expect "escrow $CONFIRM_ID canReject" "true" "$(field "$body" .canReject)"
expect "escrow $CONFIRM_ID canReclaim" "false" "$(field "$body" .canReclaim)"
expect "escrow $CONFIRM_ID creation transaction" "$CONFIRM_CREATED" "$(field "$body" .transactions.created)"
expect "escrow $CONFIRM_ID has no resolution yet" "null" "$(field "$body" .transactions.resolved)"
created_at=$(cast block "$CONFIRM_BLOCK" --rpc-url "$RPC_URL" --field timestamp)
expect "cancel window is 2 hours" "7200" "$(($(field "$body" .cancelDeadline) - created_at))"
expect "time to live is 7 days" "604800" "$(($(field "$body" .expiresAt) - created_at))"

expect "the list shows the newest first" "$EXPIRE_ID,$CANCEL_ID,$REJECT_ID,$CONFIRM_ID" "$(ids_of "$(api_get /escrows)")"
expect "all four are Pending" "4" "$(field "$(api_get '/escrows?status=Pending')" '.items | length')"
expect "filter by sender" "4" "$(field "$(api_get "/escrows?sender=$ALICE")" '.items | length')"
expect "filter by beneficiary" "4" "$(field "$(api_get "/escrows?beneficiary=$BOB")" '.items | length')"
expect "Bob sent nothing" "0" "$(field "$(api_get "/escrows?sender=$BOB")" '.items | length')"
expect "the escrow contract holds the four amounts" \
  "$((CONFIRM_AMOUNT + REJECT_AMOUNT + CANCEL_AMOUNT + EXPIRE_AMOUNT))" "$(balance_of "$ESCROW")"

# ---------------------------------------------------------------------------------------------
# Phase 2: confirm, reject and cancel (the fourth stays Pending)
# ---------------------------------------------------------------------------------------------

echo "Phase 2: confirm, reject and cancel"
send "$BOB" "$ESCROW" 'confirm(uint256)' "$CONFIRM_ID"; CONFIRM_RESOLVED=$LAST_TX
send "$BOB" "$ESCROW" 'reject(uint256)' "$REJECT_ID"; REJECT_RESOLVED=$LAST_TX
send "$ALICE" "$ESCROW" 'cancel(uint256)' "$CANCEL_ID"; CANCEL_RESOLVED=$LAST_TX
settle

for item in "$CONFIRM_ID:Released:$CONFIRM_RESOLVED" "$REJECT_ID:Rejected:$REJECT_RESOLVED" \
  "$CANCEL_ID:CancelledBySender:$CANCEL_RESOLVED"; do
  IFS=: read -r id status tx <<<"$item"
  body=$(api_get "/escrows/$id")
  expect "escrow $id status" "$status" "$(field "$body" .status)"
  expect "escrow $id effectiveStatus" "$status" "$(field "$body" .effectiveStatus)"
  expect "escrow $id resolution transaction" "$tx" "$(field "$body" .transactions.resolved)"
  expect "escrow $id allows no action" "false,false,false,false" \
    "$(field "$body" '[.canCancel, .canConfirm, .canReject, .canReclaim] | join(",")')"
done

expect "the fourth escrow is still Pending" "Pending" "$(field "$(api_get "/escrows/$EXPIRE_ID")" .status)"
expect "status=Released" "$CONFIRM_ID" "$(ids_of "$(api_get '/escrows?status=Released')")"
expect "status=Rejected" "$REJECT_ID" "$(ids_of "$(api_get '/escrows?status=Rejected')")"
expect "status=CancelledBySender" "$CANCEL_ID" "$(ids_of "$(api_get '/escrows?status=CancelledBySender')")"
expect "status=Pending" "$EXPIRE_ID" "$(ids_of "$(api_get '/escrows?status=Pending')")"

# ---------------------------------------------------------------------------------------------
# Phase 3: time passes the 7 day TTL
# ---------------------------------------------------------------------------------------------

echo "Phase 3: advance the node's clock past the TTL"
cast rpc --rpc-url "$RPC_URL" evm_increaseTime "$WEEK_AND_AN_HOUR" >/dev/null
cast rpc --rpc-url "$RPC_URL" evm_mine >/dev/null

body=$(api_get "/escrows/$EXPIRE_ID")
expect "stored status is still Pending" "Pending" "$(field "$body" .status)"
expect "effectiveStatus is PendingExpired" "PendingExpired" "$(field "$body" .effectiveStatus)"
expect "canCancel, canConfirm, canReject, canReclaim" "false,false,false,true" \
  "$(field "$body" '[.canCancel, .canConfirm, .canReject, .canReclaim] | join(",")')"
expect "status=Pending now leaves it out" "" "$(ids_of "$(api_get '/escrows?status=Pending')")"
expect "status=PendingExpired finds it" "$EXPIRE_ID" "$(ids_of "$(api_get '/escrows?status=PendingExpired')")"

# ---------------------------------------------------------------------------------------------
# Phase 4: the sender reclaims the expired escrow
# ---------------------------------------------------------------------------------------------

echo "Phase 4: reclaim the expired escrow"
send "$ALICE" "$ESCROW" 'reclaimExpired(uint256)' "$EXPIRE_ID"; EXPIRE_RESOLVED=$LAST_TX
settle

body=$(api_get "/escrows/$EXPIRE_ID")
expect "escrow $EXPIRE_ID status" "Expired" "$(field "$body" .status)"
expect "escrow $EXPIRE_ID effectiveStatus" "Expired" "$(field "$body" .effectiveStatus)"
expect "escrow $EXPIRE_ID resolution transaction" "$EXPIRE_RESOLVED" "$(field "$body" .transactions.resolved)"
expect "status=Expired" "$EXPIRE_ID" "$(ids_of "$(api_get '/escrows?status=Expired')")"

# ---------------------------------------------------------------------------------------------
# Final checks
# ---------------------------------------------------------------------------------------------

echo "Final checks"
page=$(api_get '/escrows?limit=2')
expect "first page" "$EXPIRE_ID,$CANCEL_ID" "$(ids_of "$page")"
expect "first page nextCursor" "$CANCEL_ID" "$(field "$page" .nextCursor)"
page=$(api_get "/escrows?limit=2&cursor=$CANCEL_ID")
expect "second page" "$REJECT_ID,$CONFIRM_ID" "$(ids_of "$page")"
expect "second page has no nextCursor" "null" "$(field "$page" .nextCursor)"

expect "unknown id is 404" "404" "$(http_code /escrows/999999)"
expect "invalid id is 400" "400" "$(http_code /escrows/abc)"
expect "limit=0 is 400" "400" "$(http_code '/escrows?limit=0')"
expect "invalid cursor is 400" "400" "$(http_code '/escrows?cursor=abc')"
expect "invalid status is 400" "400" "$(http_code '/escrows?status=Frozen')"

expect "Bob received the confirmed escrow" "$CONFIRM_AMOUNT" "$(balance_of "$BOB")"
expect "Alice kept everything but the confirmed escrow" "$((MINTED - CONFIRM_AMOUNT))" "$(balance_of "$ALICE")"
expect "the escrow contract holds nothing" "0" "$(balance_of "$ESCROW")"

# ---------------------------------------------------------------------------------------------
# Phase 5: an escrow created with a permit signature (EIP-2612), then confirmed
# ---------------------------------------------------------------------------------------------

echo "Phase 5: create an escrow with a permit signature"
PERMIT_TOKEN=$(cd contracts && forge create test/mocks/MockPermitERC20.sol:MockPermitERC20 \
  --rpc-url "$RPC_URL" --unlocked --from "$ALICE" --broadcast --json |
  sed -n '/^{/,$p' | jq -er .deployedTo)
send "$ALICE" "$PERMIT_TOKEN" 'mint(address,uint256)' "$ALICE" "$PERMIT_AMOUNT"
expect "Alice has not approved the escrow contract" "0" \
  "$(call "$PERMIT_TOKEN" 'allowance(address,address)(uint256)' "$ALICE" "$ESCROW")"

# Alice signs the permit through Anvil, which holds the keys of its default accounts, so no key is
# needed in this repository. The domain is the one of MockPermitERC20: name "Permit", version "1".
deadline=$(($(cast block latest --rpc-url "$RPC_URL" --field timestamp) + 3600))
typed=$(jq -nc --arg token "$PERMIT_TOKEN" --arg owner "$ALICE" --arg spender "$ESCROW" \
  --arg value "$PERMIT_AMOUNT" --arg deadline "$deadline" \
  --argjson chain "$(cast chain-id --rpc-url "$RPC_URL")" '{
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" }
      ],
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" }
      ]
    },
    primaryType: "Permit",
    domain: { name: "Permit", version: "1", chainId: $chain, verifyingContract: $token },
    message: { owner: $owner, spender: $spender, value: $value, nonce: "0", deadline: $deadline }
  }')
signature=$(cast rpc --rpc-url "$RPC_URL" eth_signTypedData_v4 "$ALICE" "$typed" | jq -er .) ||
  die "Anvil could not sign the permit (eth_signTypedData_v4)"
[ "${#signature}" -eq 132 ] || die "unexpected signature from Anvil: $signature"
permit_r=0x${signature:2:64}
permit_s=0x${signature:66:64}
permit_v=$((16#${signature:130:2}))
[ "$permit_v" -ge 27 ] || permit_v=$((permit_v + 27)) # some signers return 0 or 1

PERMIT_ID=$(call "$ESCROW" 'nextId()(uint256)')
send "$ALICE" "$ESCROW" 'createEscrowWithPermit(address,address,uint256,uint256,uint8,bytes32,bytes32)' \
  "$PERMIT_TOKEN" "$BOB" "$PERMIT_AMOUNT" "$deadline" "$permit_v" "$permit_r" "$permit_s"
PERMIT_CREATED=$LAST_TX
settle

body=$(api_get "/escrows/$PERMIT_ID")
expect "permit escrow sender" "$(lower "$ALICE")" "$(field "$body" .sender)"
expect "permit escrow beneficiary" "$(lower "$BOB")" "$(field "$body" .beneficiary)"
expect "permit escrow token" "$(lower "$PERMIT_TOKEN")" "$(field "$body" .token)"
expect "permit escrow amount" "$PERMIT_AMOUNT" "$(field "$body" .amount)"
expect "permit escrow status" "Pending" "$(field "$body" .status)"
expect "permit escrow creation transaction" "$PERMIT_CREATED" "$(field "$body" .transactions.created)"
expect "the permit's allowance was used up" "0" \
  "$(call "$PERMIT_TOKEN" 'allowance(address,address)(uint256)' "$ALICE" "$ESCROW")"
expect "the escrow contract holds the permit amount" "$PERMIT_AMOUNT" \
  "$(call "$PERMIT_TOKEN" 'balanceOf(address)(uint256)' "$ESCROW")"
expect "status=Pending lists only the permit escrow" "$PERMIT_ID" "$(ids_of "$(api_get '/escrows?status=Pending')")"

send "$BOB" "$ESCROW" 'confirm(uint256)' "$PERMIT_ID"
PERMIT_RESOLVED=$LAST_TX
settle

body=$(api_get "/escrows/$PERMIT_ID")
expect "permit escrow is Released after the confirm" "Released" "$(field "$body" .status)"
expect "permit escrow resolution transaction" "$PERMIT_RESOLVED" "$(field "$body" .transactions.resolved)"
expect "Bob received the permit amount" "$PERMIT_AMOUNT" \
  "$(call "$PERMIT_TOKEN" 'balanceOf(address)(uint256)' "$BOB")"

echo "All checks passed"
