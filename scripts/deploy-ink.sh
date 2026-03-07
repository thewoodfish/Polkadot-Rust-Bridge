#!/usr/bin/env bash
# =============================================================================
# scripts/deploy-ink.sh
#
# Deploy the rust_bridge_ink! contract to Polkadot Hub testnet.
#
# Prerequisites
# ─────────────
# 1. Install cargo-contract v4+:
#      cargo install cargo-contract --version "^4"
#
# 2. Add the PolkaVM RISC-V / WASM target and rust-src:
#      rustup component add rust-src
#      rustup target add wasm32-unknown-unknown   # for ink! Wasm target
#
# 3. Build the .contract bundle:
#      cd precompiles/rust_bridge_ink
#      cargo contract build --release
#    Output: target/ink/rust_bridge_ink.contract
#
# 4. Fund your Substrate account from the testnet faucet:
#      https://faucet.polkadot.io
#
# 5. Export your seed phrase:
#      export SUBSTRATE_SEED="word1 word2 ... word12"
#    Or use a keystore file with --keystore-path.
#
# 6. Set the RPC endpoint:
#      export POLKADOT_HUB_RPC_URL="wss://westend-asset-hub-rpc.polkadot.io"
#    For a local dev node:
#      export POLKADOT_HUB_RPC_URL="ws://127.0.0.1:9944"
#
# Usage
# ─────
#   chmod +x scripts/deploy-ink.sh
#   ./scripts/deploy-ink.sh
#
# After a successful instantiation, copy the "Contract" address printed by
# cargo-contract, convert it from SS58 to AccountId32 hex:
#
#   subkey inspect <SS58_ADDRESS> --output-type json | jq -r '.publicKey'
#
# Set the result in .env:
#   INK_CONTRACT_ADDRESS=0x<64-char hex>
#
# Then run the Solidity deployment:
#   npm run deploy
# =============================================================================

set -euo pipefail

# ── Check environment ──────────────────────────────────────────────────────────

if [ -z "${SUBSTRATE_SEED:-}" ]; then
  echo "[ERROR] SUBSTRATE_SEED is not set."
  echo "        Export your 12/24-word seed phrase before running this script."
  echo "        Example: export SUBSTRATE_SEED=\"word1 word2 ...\""
  exit 1
fi

RPC_URL="${POLKADOT_HUB_RPC_URL:-wss://westend-asset-hub-rpc.polkadot.io}"
CONTRACT_BUNDLE="precompiles/rust_bridge_ink/target/ink/rust_bridge_ink.contract"

if [ ! -f "$CONTRACT_BUNDLE" ]; then
  echo "[ERROR] Contract bundle not found: $CONTRACT_BUNDLE"
  echo "        Run:  cd precompiles/rust_bridge_ink && cargo contract build --release"
  exit 1
fi

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║   Polkadot Rust Bridge — ink! Deploy Script     ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
echo "  RPC URL         : $RPC_URL"
echo "  Contract bundle : $CONTRACT_BUNDLE"
echo ""

# ── Dry-run estimate (no --execute flag) ──────────────────────────────────────

echo "── Dry-run (estimating fees) ──────────────────────────────────────────────"

cargo contract instantiate \
  --contract   "$CONTRACT_BUNDLE" \
  --constructor new \
  --suri       "$SUBSTRATE_SEED" \
  --url        "$RPC_URL" \
  --skip-confirm

# ── Actual instantiation ──────────────────────────────────────────────────────

echo ""
echo "── Instantiating contract ─────────────────────────────────────────────────"

cargo contract instantiate \
  --contract   "$CONTRACT_BUNDLE" \
  --constructor new \
  --suri       "$SUBSTRATE_SEED" \
  --url        "$RPC_URL" \
  --execute \
  --skip-confirm

# ── Post-deploy instructions ──────────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════════════════════════════════════════"
echo "  Instantiation complete."
echo ""
echo "  Next steps:"
echo ""
echo "  1. Copy the 'Contract' address from the output above (SS58 format)."
echo ""
echo "  2. Convert it to AccountId32 hex (needed by XCMRustBridge constructor):"
echo "       subkey inspect <SS58_ADDRESS> --output-type json | jq -r '.publicKey'"
echo ""
echo "  3. Prefix the hex with 0x and set it in .env:"
echo "       INK_CONTRACT_ADDRESS=0x<64-char hex>"
echo ""
echo "  4. Deploy the Solidity bridge:"
echo "       npm run deploy"
echo "═══════════════════════════════════════════════════════════════════════════"
echo ""
