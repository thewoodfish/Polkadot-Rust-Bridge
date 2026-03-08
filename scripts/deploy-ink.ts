/**
 * scripts/deploy-ink.ts
 *
 * Deploys the rust_bridge_ink v6 (.polkavm) contract to Polkadot Hub
 * testnet via the EVM-compatible RPC exposed by pallet-revive.
 *
 * How it works:
 *   In ink! v6 + pallet-revive, contracts are PolkaVM RISC-V binaries.
 *   Deployment uses the same EVM RPC as Solidity: send a type-0 raw tx
 *   with `to: null` and `data = polkavm_bytes + constructor_selector`.
 *
 *   Constructor: `new()` — selector 0x9bae9d5e, no arguments.
 *
 * Usage:
 *   npx ts-node scripts/deploy-ink.ts
 *
 * Env vars required (in .env):
 *   POLKADOT_HUB_RPC_URL   — EVM RPC endpoint
 *   DEPLOYER_PRIVATE_KEY   — 0x-prefixed 32-byte hex private key
 */

import * as fs   from "fs";
import * as path from "path";
import { ethers } from "ethers";
import "dotenv/config";

const RPC_URL    = process.env.POLKADOT_HUB_RPC_URL!;
const PRIV_KEY   = process.env.DEPLOYER_PRIVATE_KEY!;

// ink! new() constructor selector (from rust_bridge_ink.json)
const CONSTRUCTOR_SELECTOR = "9bae9d5e";

// Gas price is fetched dynamically from eth_gasPrice

async function main() {
  if (!RPC_URL)  { console.error("Missing POLKADOT_HUB_RPC_URL"); process.exit(1); }
  if (!PRIV_KEY) { console.error("Missing DEPLOYER_PRIVATE_KEY"); process.exit(1); }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet   = new ethers.Wallet(PRIV_KEY, provider);

  // Auto-detect chain ID and gas price from RPC
  const { chainId } = await provider.getNetwork();
  const gasPrice    = await provider.getFeeData().then(f => f.gasPrice ?? 1_000_000_000_000n);

  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║    Deploy rust_bridge_ink v6 (.polkavm)          ║");
  console.log("╚══════════════════════════════════════════════════╝\n");
  console.log(`  Deployer:  ${wallet.address}`);
  console.log(`  RPC:       ${RPC_URL}`);
  console.log(`  ChainId:   ${chainId}`);
  console.log(`  GasPrice:  ${gasPrice.toLocaleString()}\n`);

  // Read .polkavm binary
  const polkavmPath = path.join(
    __dirname, "..", "precompiles", "target", "ink", "rust_bridge_ink",
    "rust_bridge_ink.polkavm"
  );
  if (!fs.existsSync(polkavmPath)) {
    console.error(`  ERROR: .polkavm file not found at ${polkavmPath}`);
    console.error("  Run: cd precompiles/rust_bridge_ink && cargo contract build --release");
    process.exit(1);
  }
  const polkavmBytes = fs.readFileSync(polkavmPath);
  console.log(`  Bytecode:  ${polkavmBytes.length} bytes (${polkavmPath})`);

  // Deployment data = polkavm_binary + constructor_selector
  // For pallet-revive ink! v6: the constructor selector follows the binary
  const deployData = "0x" + polkavmBytes.toString("hex") + CONSTRUCTOR_SELECTOR;

  // Check balance
  const balance = await provider.getBalance(wallet.address);
  console.log(`  Balance:   ${ethers.formatUnits(balance, 10)} DOT`);
  if (balance === 0n) {
    console.error("  ERROR: Deployer has no balance. Fund it first.");
    process.exit(1);
  }

  // Estimate gas
  let gasLimit: bigint;
  try {
    gasLimit = await provider.estimateGas({
      from:  wallet.address,
      data:  deployData,
    });
    // Add 20% headroom
    gasLimit = gasLimit * 12n / 10n;
  } catch (e) {
    console.warn("  Gas estimation failed, using fallback 5_000_000");
    gasLimit = 5_000_000n;
  }
  console.log(`  Gas limit: ${gasLimit.toLocaleString()}`);
  console.log(`  Gas price: ${gasPrice.toLocaleString()} (from eth_gasPrice)\n`);

  // Build and send transaction
  const nonce = await provider.getTransactionCount(wallet.address, "pending");
  const tx = {
    type:     0,           // legacy transaction required by pallet-revive
    chainId:  Number(chainId),
    nonce,
    gasPrice,
    gasLimit,
    to:       null,        // contract creation
    value:    0n,
    data:     deployData,
  };

  console.log("  Sending deployment transaction...");
  const signed  = await wallet.signTransaction(tx);
  const txHash  = ethers.keccak256(signed);
  console.log(`  Tx hash (pre-broadcast): ${txHash}`);

  const response = await provider.broadcastTransaction(signed);
  console.log(`  Broadcast done. Hash: ${response.hash}`);

  // Wait for receipt
  console.log("  Waiting for confirmation...");
  let receipt = null;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 3000));
    receipt = await provider.getTransactionReceipt(response.hash);
    if (receipt) break;
    process.stdout.write(".");
  }
  console.log();

  if (!receipt) {
    console.error("  ERROR: Transaction not confirmed after 90s. Check explorer:");
    console.error(`  https://blockscout-testnet.polkadot.io/tx/${response.hash}`);
    process.exit(1);
  }

  const contractAddress = receipt.contractAddress;
  console.log("\n  ✓ Deployment confirmed!");
  console.log(`  Contract address:  ${contractAddress}`);
  console.log(`  Block number:      ${receipt.blockNumber}`);
  console.log(`  Gas used:          ${receipt.gasUsed.toLocaleString()}`);
  console.log(`  Explorer: https://blockscout-testnet.polkadot.io/address/${contractAddress}`);

  if (!contractAddress) {
    console.error("  ERROR: No contract address in receipt.");
    process.exit(1);
  }

  // Update deployments.json
  const deploymentsPath = path.join(__dirname, "..", "demo", "src", "data", "deployments.json");
  const deployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));
  deployments.testnet.inkContract = contractAddress;
  fs.writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2));
  console.log(`\n  Updated demo/src/data/deployments.json with ink! address.`);

  // Update root deployments/testnet.json if it exists
  const rootDeployPath = path.join(__dirname, "..", "deployments", "testnet.json");
  if (fs.existsSync(rootDeployPath)) {
    const rootDeploy = JSON.parse(fs.readFileSync(rootDeployPath, "utf8"));
    rootDeploy.inkContract = contractAddress;
    fs.writeFileSync(rootDeployPath, JSON.stringify(rootDeploy, null, 2));
    console.log("  Updated deployments/testnet.json with ink! address.");
  }

  console.log("\n  Next step:");
  console.log(`  Add to .env:  INK_CONTRACT_ADDRESS=${contractAddress}`);
  console.log("  Then run:     npm run deploy\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
