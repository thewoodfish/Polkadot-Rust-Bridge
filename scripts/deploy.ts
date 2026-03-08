/**
 * scripts/deploy.ts
 *
 * Deploys XCMRustBridge.sol to Polkadot Hub testnet and runs a smoke-test
 * + gas benchmark against the deployed ink! contract.
 *
 * Prerequisites
 * ─────────────
 * 1. Copy .env.example → .env and fill in all four variables.
 * 2. Deploy the ink! contract first (see scripts/deploy-ink.sh).
 * 3. Set INK_CONTRACT_ADDRESS in .env to the AccountId32 hex returned by step 2.
 *
 * Usage
 * ─────
 *   npm run deploy
 *   # or explicitly:
 *   npx hardhat run scripts/deploy.ts --network polkadotHubTestnet
 */

import * as fs   from "fs";
import * as path from "path";
import { ethers, network } from "hardhat";
import type { XCMRustBridge } from "../typechain-types/XCMRustBridge.sol/XCMRustBridge";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function abort(msg: string): never {
  console.error(`\n[ABORT] ${msg}\n`);
  process.exit(1);
}

function info(label: string, value: string): void {
  console.log(`  ${label.padEnd(28)} ${value}`);
}

function avg(values: bigint[]): bigint {
  return values.reduce((a, b) => a + b, 0n) / BigInt(values.length);
}

/** Format a bigint with thousands separators. */
function fmt(n: bigint | number): string {
  return Number(n).toLocaleString("en-US");
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1 — Environment checks
// ─────────────────────────────────────────────────────────────────────────────

async function checkEnvironment() {
  console.log("\n══════════════════════════════════════════════════");
  console.log("  STEP 1  Check environment");
  console.log("══════════════════════════════════════════════════");

  const rpcUrl     = process.env.POLKADOT_HUB_RPC_URL;
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
  const inkAddress = process.env.INK_CONTRACT_ADDRESS;

  if (!rpcUrl)     abort("POLKADOT_HUB_RPC_URL is not set in .env");
  if (!privateKey) abort("DEPLOYER_PRIVATE_KEY is not set in .env");
  if (!inkAddress) abort("INK_CONTRACT_ADDRESS is not set in .env — deploy the ink! contract first (see scripts/deploy-ink.sh)");

  // Validate INK_CONTRACT_ADDRESS is a valid bytes32 hex string.
  if (!/^0x[0-9a-fA-F]{64}$/.test(inkAddress)) {
    abort(
      `INK_CONTRACT_ADDRESS must be a 0x-prefixed 64-char hex string (AccountId32).\n` +
      `  Got: ${inkAddress}\n` +
      `  Hint: convert SS58 address with: subkey inspect <SS58_ADDRESS> --output-type json | jq -r '.publicKey'`
    );
  }

  const [deployer] = await ethers.getSigners();
  const balance    = await ethers.provider.getBalance(deployer.address);
  const networkInfo = await ethers.provider.getNetwork();

  // On Polkadot Asset Hub, the EVM layer uses 10 decimal places for DOT.
  // 1 DOT = 10_000_000_000n in the underlying unit exposed to the EVM.
  // Adjust this constant if the target chain uses 18 decimals.
  const ONE_DOT = 10_000_000_000n;

  info("Network",          `${networkInfo.name} (chainId ${networkInfo.chainId})`);
  info("Deployer",         deployer.address);
  info("Balance",          `${ethers.formatUnits(balance, 10)} DOT (${fmt(balance)} planck)`);
  info("ink! contract",    inkAddress);

  if (balance < ONE_DOT) {
    abort(
      `Deployer balance too low: ${ethers.formatUnits(balance, 10)} DOT.\n` +
      `  Fund the address ${deployer.address} with at least 1 DOT from the testnet faucet:\n` +
      `  https://faucet.polkadot.io`
    );
  }

  console.log("\n  Environment OK.\n");
  return { deployer, inkAddress: inkAddress as `0x${string}` };
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2 — Deploy XCMRustBridge
// ─────────────────────────────────────────────────────────────────────────────

async function deployContract(inkAddress: string): Promise<XCMRustBridge> {
  console.log("══════════════════════════════════════════════════");
  console.log("  STEP 2  Deploy XCMRustBridge.sol");
  console.log("══════════════════════════════════════════════════");

  const factory  = await ethers.getContractFactory("XCMRustBridge");
  const contract = await factory.deploy(inkAddress) as unknown as XCMRustBridge;

  process.stdout.write("  Deploying...");
  await contract.waitForDeployment();
  const deployedAddress = await contract.getAddress();
  const deployTx        = contract.deploymentTransaction()!;
  const receipt         = await deployTx.wait();

  console.log(" done.\n");
  info("Contract address",  deployedAddress);
  info("Deploy tx",         deployTx.hash);
  info("Gas used",          fmt(receipt!.gasUsed));
  info("Block",             String(receipt!.blockNumber));

  // Persist deployment record.
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(deploymentsDir, { recursive: true });

  const record = {
    network:         network.name,
    chainId:         (await ethers.provider.getNetwork()).chainId.toString(),
    deployedAt:      new Date().toISOString(),
    deployer:        (await ethers.provider.getSigner()).address,
    contracts: {
      XCMRustBridge: deployedAddress,
    },
    inkContract:     inkAddress,
    deployTxHash:    deployTx.hash,
    deployGasUsed:   receipt!.gasUsed.toString(),
  };

  const outPath = path.join(deploymentsDir, "testnet.json");
  fs.writeFileSync(outPath, JSON.stringify(record, null, 2));
  console.log(`\n  Deployment record written to deployments/testnet.json\n`);

  return contract;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3 — Smoke test
// ─────────────────────────────────────────────────────────────────────────────

async function smokeTest(contract: XCMRustBridge): Promise<void> {
  console.log("══════════════════════════════════════════════════");
  console.log("  STEP 3  Smoke test");
  console.log("══════════════════════════════════════════════════");

  // Use the synchronous direct-call path for testable return values.
  // The XCM Transact path (dotProduct) fires-and-forgets; results come
  // back via events in production. For the demo we use directDotProduct.
  console.log("\n  directDotProduct([1,2,3], [4,5,6]) — expected: 32");

  const tx      = await contract.directDotProduct([1n, 2n, 3n], [4n, 5n, 6n]);
  const receipt = await tx.wait();

  // Parse result from DotProduct event.
  const iface  = contract.interface;
  let result: bigint | null = null;
  for (const log of receipt!.logs) {
    try {
      const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
      if (parsed?.name === "DotProduct") {
        result = parsed.args.result as bigint;
        break;
      }
    } catch { /* not our event */ }
  }

  if (result === null) {
    abort("Smoke test: DotProduct event not found in receipt logs.");
  }
  if (result !== 32n) {
    abort(`Smoke test FAILED: expected 32, got ${result}`);
  }

  info("Result",    String(result));
  info("Gas used",  fmt(receipt!.gasUsed));
  console.log("\n  Smoke test PASSED.\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 4 — Benchmark
// ─────────────────────────────────────────────────────────────────────────────

const BENCH_RUNS = 5;

interface BenchEntry {
  operation:   string;
  path:        "direct" | "xcm";
  avgGas:      number;
  minGas:      number;
  maxGas:      number;
  note:        string;
}

async function runBenchmark(contract: XCMRustBridge): Promise<void> {
  console.log("══════════════════════════════════════════════════");
  console.log(`  STEP 4  Benchmark  (${BENCH_RUNS} runs each)`);
  console.log("══════════════════════════════════════════════════\n");

  const iface = contract.interface;
  const entries: BenchEntry[] = [];

  async function measure(
    label: string,
    fn: () => Promise<{ wait(): Promise<unknown> }>,
    path: "direct" | "xcm",
    note: string
  ): Promise<void> {
    process.stdout.write(`  Benchmarking ${label}... `);
    const gasValues: bigint[] = [];

    for (let i = 0; i < BENCH_RUNS; i++) {
      const tx      = await fn();
      const receipt = await (tx as any).wait() as { gasUsed: bigint };
      gasValues.push(receipt.gasUsed);
    }

    const avgGas = avg(gasValues);
    const minGas = gasValues.reduce((a, b) => a < b ? a : b);
    const maxGas = gasValues.reduce((a, b) => a > b ? a : b);

    console.log(`avg ${fmt(avgGas)} gas`);
    entries.push({
      operation: label,
      path,
      avgGas:    Number(avgGas),
      minGas:    Number(minGas),
      maxGas:    Number(maxGas),
      note,
    });
  }

  // --- directDotProduct ---
  await measure(
    "directDotProduct(n=3)",
    () => contract.directDotProduct([1n, 2n, 3n], [4n, 5n, 6n]),
    "direct",
    "synchronous EVM→ink! call, n=3 elements"
  );

  await measure(
    "directDotProduct(n=10)",
    () => contract.directDotProduct(
      Array.from({ length: 10 }, (_, i) => BigInt(i + 1)),
      Array.from({ length: 10 }, (_, i) => BigInt(i + 1))
    ),
    "direct",
    "synchronous EVM→ink! call, n=10 elements"
  );

  // --- directPoseidonHash ---
  await measure(
    "directPoseidonHash(n=1)",
    () => contract.directPoseidonHash([42n]),
    "direct",
    "synchronous EVM→ink! call, n=1 element"
  );

  await measure(
    "directPoseidonHash(n=5)",
    () => contract.directPoseidonHash([1n, 2n, 3n, 4n, 5n]),
    "direct",
    "synchronous EVM→ink! call, n=5 elements"
  );

  // --- directBlsVerify ---
  await measure(
    "directBlsVerify(32B msg)",
    () => contract.directBlsVerify(
      new Uint8Array(48),
      new Uint8Array(32),
      new Uint8Array(96)
    ),
    "direct",
    "length check only (stub) — 32-byte message"
  );

  // --- xcm Transact path (fire-and-forget, gas only) ---
  await measure(
    "xcmDotProduct(n=3)",
    () => contract.dotProduct([1n, 2n, 3n], [4n, 5n, 6n]),
    "xcm",
    "XCM Transact dispatch — result via event (no sync return)"
  );

  // Print table
  const COL = [36, 8, 14, 14, 14];
  const line = "─".repeat(COL.reduce((a, b) => a + b + 3, 0));

  console.log("\n");
  console.log(line);
  console.log(
    padR("Operation", COL[0]) + " │ " +
    padR("Path",  COL[1]) + " │ " +
    padL("Avg gas",  COL[2]) + " │ " +
    padL("Min gas",  COL[3]) + " │ " +
    padL("Max gas",  COL[4])
  );
  console.log(line);
  for (const e of entries) {
    console.log(
      padR(e.operation, COL[0]) + " │ " +
      padR(e.path,      COL[1]) + " │ " +
      padL(fmt(e.avgGas), COL[2]) + " │ " +
      padL(fmt(e.minGas), COL[3]) + " │ " +
      padL(fmt(e.maxGas), COL[4])
    );
  }
  console.log(line);

  // Write JSON
  const report = {
    timestamp:  new Date().toISOString(),
    network:    network.name,
    runs:       BENCH_RUNS,
    results:    entries,
  };

  const outPath = path.join(__dirname, "..", "benchmark-results-testnet.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  const demoOut = path.join(__dirname, "..", "demo", "src", "data", "benchmark-results-testnet.json");
  fs.writeFileSync(demoOut, JSON.stringify(report, null, 2));

  console.log(`\n  Results written to benchmark-results-testnet.json`);
  console.log(`  Results copied  to demo/src/data/benchmark-results-testnet.json\n`);
}

function padR(s: string, n: number) { return s.padEnd(n); }
function padL(s: string, n: number) { return s.padStart(n); }

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║       Polkadot Rust Bridge — Deploy Script       ║");
  console.log("╚══════════════════════════════════════════════════╝");

  const { inkAddress }  = await checkEnvironment();
  const contract        = await deployContract(inkAddress);
  await smokeTest(contract);
  await runBenchmark(contract);

  console.log("══════════════════════════════════════════════════");
  console.log("  Deployment complete.");
  console.log("══════════════════════════════════════════════════\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
