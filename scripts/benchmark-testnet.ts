/**
 * scripts/benchmark-testnet.ts
 *
 * Re-runs gas benchmarks against an already-deployed XCMRustBridge contract
 * on Polkadot Hub testnet.  Does NOT redeploy — reads the contract address
 * from deployments/testnet.json (written by scripts/deploy.ts).
 *
 * Usage
 * ─────
 *   npm run benchmark:testnet
 *   # or:
 *   npx hardhat run scripts/benchmark-testnet.ts --network polkadotHub
 *
 * Output
 * ──────
 *   benchmark-results-testnet.json       (project root)
 *   demo/src/data/benchmark-results-testnet.json  (copied for the dashboard)
 */

import * as fs   from "fs";
import * as path from "path";
import { ethers, network } from "hardhat";
import type { XCMRustBridge } from "../typechain-types/XCMRustBridge.sol/XCMRustBridge";

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

const RUNS = 5;

function fmt(n: bigint | number): string {
  return Number(n).toLocaleString("en-US");
}
function avg(values: bigint[]): bigint {
  return values.reduce((a, b) => a + b, 0n) / BigInt(values.length);
}
function padR(s: string, n: number) { return s.padEnd(n); }
function padL(s: string, n: number) { return s.padStart(n); }

// ─────────────────────────────────────────────────────────────────────────────
// Load deployment record
// ─────────────────────────────────────────────────────────────────────────────

function loadDeployment(): { xcmRustBridge: string } {
  const deploymentsPath = path.join(__dirname, "..", "deployments", "testnet.json");
  if (!fs.existsSync(deploymentsPath)) {
    console.error("\n[ERROR] deployments/testnet.json not found.");
    console.error("        Run scripts/deploy.ts first:\n");
    console.error("          npm run deploy\n");
    process.exit(1);
  }
  const record = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));
  const addr   = record.contracts?.XCMRustBridge as string | undefined;
  if (!addr) {
    console.error("[ERROR] deployments/testnet.json missing contracts.XCMRustBridge");
    process.exit(1);
  }
  return { xcmRustBridge: addr };
}

// ─────────────────────────────────────────────────────────────────────────────
// Benchmark runner
// ─────────────────────────────────────────────────────────────────────────────

interface BenchEntry {
  operation:   string;
  path:        "direct" | "xcm";
  avgGas:      number;
  minGas:      number;
  maxGas:      number;
  note:        string;
}

async function measureGas(
  label: string,
  callPath: "direct" | "xcm",
  note: string,
  fn: () => Promise<{ wait(): Promise<{ gasUsed: bigint }> }>,
): Promise<BenchEntry> {
  process.stdout.write(`  ${label.padEnd(40)} `);
  const gasValues: bigint[] = [];
  for (let i = 0; i < RUNS; i++) {
    const tx      = await fn();
    const receipt = await tx.wait();
    gasValues.push(receipt!.gasUsed);
  }
  const a = avg(gasValues);
  process.stdout.write(`avg ${fmt(a).padStart(12)} gas\n`);
  return {
    operation: label,
    path:      callPath,
    avgGas:    Number(a),
    minGas:    Number(gasValues.reduce((x, y) => x < y ? x : y)),
    maxGas:    Number(gasValues.reduce((x, y) => x > y ? x : y)),
    note,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║     Polkadot Hub Testnet — Gas Benchmark         ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  const { xcmRustBridge: addr } = loadDeployment();
  const chainInfo = await ethers.provider.getNetwork();

  console.log(`  Network        : ${chainInfo.name} (chainId ${chainInfo.chainId})`);
  console.log(`  XCMRustBridge  : ${addr}`);
  console.log(`  Runs per op    : ${RUNS}\n`);

  const contract = await ethers.getContractAt("XCMRustBridge", addr) as unknown as XCMRustBridge;

  const entries: BenchEntry[] = [];

  entries.push(await measureGas(
    "directDotProduct([1,2,3] · [4,5,6])", "direct",
    "synchronous EVM→ink! call, n=3",
    () => contract.directDotProduct([1n, 2n, 3n], [4n, 5n, 6n]) as any,
  ));

  entries.push(await measureGas(
    "directDotProduct(n=10)", "direct",
    "synchronous EVM→ink! call, n=10",
    () => contract.directDotProduct(
      Array.from({ length: 10 }, (_, i) => BigInt(i + 1)),
      Array.from({ length: 10 }, (_, i) => BigInt(i + 1)),
    ) as any,
  ));

  entries.push(await measureGas(
    "directPoseidonHash(n=1)", "direct",
    "synchronous EVM→ink! call, n=1 element",
    () => contract.directPoseidonHash([42n]) as any,
  ));

  entries.push(await measureGas(
    "directPoseidonHash(n=5)", "direct",
    "synchronous EVM→ink! call, n=5 elements",
    () => contract.directPoseidonHash([1n, 2n, 3n, 4n, 5n]) as any,
  ));

  entries.push(await measureGas(
    "directBlsVerify(48B pubkey, 32B msg, 96B sig)", "direct",
    "length check only (stub)",
    () => contract.directBlsVerify(new Uint8Array(48), new Uint8Array(32), new Uint8Array(96)) as any,
  ));

  entries.push(await measureGas(
    "xcmDotProduct([1,2,3] · [4,5,6])", "xcm",
    "XCM Transact dispatch — result via event",
    () => contract.dotProduct([1n, 2n, 3n], [4n, 5n, 6n]) as any,
  ));

  // ── Table ──────────────────────────────────────────────────────────────────
  const COL = [48, 8, 12, 12, 12];
  const line = "─".repeat(COL.reduce((a, b) => a + b + 3, 0));
  console.log("\n" + line);
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

  // ── Write results ──────────────────────────────────────────────────────────
  const report = {
    timestamp:   new Date().toISOString(),
    network:     network.name,
    chainId:     chainInfo.chainId.toString(),
    contract:    addr,
    runs:        RUNS,
    results:     entries,
  };

  const rootOut = path.join(__dirname, "..", "benchmark-results-testnet.json");
  fs.writeFileSync(rootOut, JSON.stringify(report, null, 2));

  // Copy into demo data directory so the dashboard picks it up automatically.
  const demoOut = path.join(__dirname, "..", "demo", "src", "data", "benchmark-results-testnet.json");
  fs.writeFileSync(demoOut, JSON.stringify(report, null, 2));

  console.log(`\n  Results written to:`);
  console.log(`    benchmark-results-testnet.json`);
  console.log(`    demo/src/data/benchmark-results-testnet.json\n`);
  console.log(`  Rebuild the demo to publish the updated numbers:`);
  console.log(`    cd demo && npm run build\n`);
}

main().catch((err) => { console.error(err); process.exit(1); });
