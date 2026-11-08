#!/bin/sh
# Deploys EscrowManager and writes where it is, for the API to read (SPEC section 7):
#
#   { "address": "0x...", "startBlock": 12 }
#
# The block is in decimal, converted from the hex value in forge's receipt. The file is written at
# the end and moved into place in one step, so a reader never sees half of it.
#
# Used by the `deploy` service in docker-compose.yml, and by hand against a local Anvil:
#
#   DEPLOYMENT_FILE=/tmp/escrow-deployment.json sh contracts/deploy.sh
#
# Needs forge, cast and jq. Settings, all optional:
#   RPC_URL          node to deploy to          (default http://127.0.0.1:8545)
#   DEPLOYMENT_FILE  where to write the result  (default /shared/deployment.json)
#   DEPLOYER         account that sends the deploy transaction. Anvil's first default account,
#                    which is public and holds no real funds.

set -eu

RPC_URL="${RPC_URL:-http://127.0.0.1:8545}"
DEPLOYMENT_FILE="${DEPLOYMENT_FILE:-/shared/deployment.json}"
DEPLOYER="${DEPLOYER:-0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266}"

# Foundry commands must run from the project folder, wherever this script is started from.
cd "$(dirname "$0")"

forge script script/Deploy.s.sol --rpc-url "$RPC_URL" --broadcast --unlocked --sender "$DEPLOYER"

CHAIN_ID=$(cast chain-id --rpc-url "$RPC_URL")
BROADCAST="broadcast/Deploy.s.sol/${CHAIN_ID}/run-latest.json"

# -e makes jq fail on null, so a missing field stops the script instead of writing "null".
ADDRESS=$(jq -er '.transactions[0].contractAddress' "$BROADCAST")
HEX_BLOCK=$(jq -er '.receipts[0].blockNumber' "$BROADCAST")
START_BLOCK=$((HEX_BLOCK))

mkdir -p "$(dirname "$DEPLOYMENT_FILE")"
jq -n --arg address "$ADDRESS" --argjson startBlock "$START_BLOCK" \
  '{ address: $address, startBlock: $startBlock }' > "$DEPLOYMENT_FILE.tmp"
mv "$DEPLOYMENT_FILE.tmp" "$DEPLOYMENT_FILE"

echo "EscrowManager at $ADDRESS, deployed in block $START_BLOCK, written to $DEPLOYMENT_FILE"
