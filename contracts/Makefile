# Shortcuts for the long commands. Run them from this folder, like every Foundry command.

RPC_URL   ?= http://127.0.0.1:8545
# Anvil's first default test account. It is public and holds no real funds.
DEPLOYER  ?= 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
BROADCAST ?= broadcast/Deploy.s.sol/31337/run-latest.json

.PHONY: build test test-deep fmt fmt-check slither anvil deploy-local deploy-info

build:
	forge build

test:
	forge test -vvv

# Heavier invariant run than the defaults in foundry.toml (64 runs of depth 100).
test-deep:
	FOUNDRY_INVARIANT_RUNS=256 FOUNDRY_INVARIANT_DEPTH=500 forge test --match-path "test/invariant/*" -vvv

fmt:
	forge fmt

fmt-check:
	forge fmt --check

# Our code only: OpenZeppelin is audited upstream, tests and scripts are not deployed. See docs/slither.md.
slither:
	slither . --filter-paths "lib/|test/|script/"

anvil:
	anvil

# Needs `make anvil` running in another terminal.
deploy-local:
	forge script script/Deploy.s.sol --rpc-url $(RPC_URL) --broadcast --unlocked --sender $(DEPLOYER)

# Contract address and deploy block (hex) of the last local deploy.
deploy-info:
	jq -r '.transactions[0].contractAddress, .receipts[0].blockNumber' $(BROADCAST)
