# The `deploy` service: deploys EscrowManager to the node and writes the deployment file.
# The Foundry version matches the one the contracts were developed and tested with.
# The base image is Ubuntu and runs as the unprivileged user `foundry`.

FROM ghcr.io/foundry-rs/foundry:v1.5.1

# deploy.sh needs jq to read forge's broadcast file and to write the JSON.
USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends jq \
    && rm -rf /var/lib/apt/lists/*

# /shared is where the deployment file goes. A new named volume takes the owner of the folder it is
# mounted over, so the unprivileged user can write there. /contracts is where forge writes its output.
RUN mkdir /contracts /shared && chown foundry:foundry /contracts /shared

USER foundry
WORKDIR /contracts
# The libraries in lib/ are git submodules, so clone the repository with --recurse-submodules.
COPY --chown=foundry:foundry . .

# Compile now, so starting the container does not download the Solidity compiler again.
RUN forge build

ENTRYPOINT ["/bin/sh", "/contracts/deploy.sh"]
