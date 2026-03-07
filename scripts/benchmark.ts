/**
 * scripts/benchmark.ts
 *
 * Standalone Hardhat script: deploy contracts, inject mock precompiles, run
 * each operation 10 times, average the gas, print a table, write JSON.
 *
 * Run:  npx hardhat run scripts/benchmark.ts
 *       npm run benchmark
 *
 * Gas measurement
 * ───────────────
 * precompileGas  = gasUsed from the PrecompileCalled event (inner call only,
 *                  no 21 k base cost, no bridge overhead).
 * solidityGas    = gasUsed from a direct transaction to the same mock address
 *                  (full Solidity call cost incl. 21 k base cost).
 * speedup        = solidityGas / precompileGas
 *
 * On real PolkaVM the precompileGas column will be dramatically lower
 * because RISC-V native execution is far cheaper than EVM opcode metering.
 */

import { ethers, network } from "hardhat";
import * as fs   from "fs";
import * as path from "path";
import type { RustBridge } from "../typechain-types";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const RUNS = 10;

const PRECOMPILE_POSEIDON    = "0x0000000000000000000000000000000000000900";
const PRECOMPILE_BLS_VERIFY  = "0x0000000000000000000000000000000000000901";
const PRECOMPILE_DOT_PRODUCT = "0x0000000000000000000000000000000000000902";

const SEL_POSEIDON    = "0x2a58cd44"; // keccak256("poseidonHash(uint256[])")
const SEL_BLS_VERIFY  = "0xa65ebb25"; // keccak256("blsVerify(bytes,bytes,bytes)")
const SEL_DOT_PRODUCT = "0x55989ee5"; // keccak256("dotProduct(int256[],int256[])")

const abiCoder = ethers.AbiCoder.defaultAbiCoder();

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface BenchResult {
  operation:          string;
  rustPrecompileGas:  number;
  pureSolidityGas:    number;
  speedup:            number;
  note:               string;
}

interface BenchReport {
  timestamp: string;
  network:   string;
  runs:      number;
  results:   BenchResult[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function buildCall(selector: string, types: string[], values: unknown[]): string {
  return selector + abiCoder.encode(types, values).slice(2);
}

function avg(values: bigint[]): number {
  const sum = values.reduce((a, b) => a + b, 0n);
  return Number(sum / BigInt(values.length));
}

/** Extract gasUsed from the PrecompileCalled event. */
function parseEventGas(
  iface: ethers.Interface,
  logs: readonly { topics: readonly string[]; data: string }[]
): bigint {
  for (const log of logs) {
    try {
      const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
      if (parsed?.name === "PrecompileCalled") {
        return parsed.args[1] as bigint;
      }
    } catch { /* not our event */ }
  }
  throw new Error("PrecompileCalled event not found");
}

/**
 * Run `calldata` through the bridge RUNS times and return averaged
 * precompileGas (from event) and solidityGas (direct tx).
 */
async function runBench(
  bridge:        RustBridge,
  precompileAddr: string,
  calldata:      string
): Promise<{ precompileGas: number; solidityGas: number }> {
  const [signer] = await ethers.getSigners();
  const iface    = bridge.interface;

  const precompileGasSamples: bigint[] = [];
  const solidityGasSamples:   bigint[] = [];

  for (let i = 0; i < RUNS; i++) {
    // ── Bridge path ────────────────────────────────────────────────────────
    const bridgeTx      = await bridge.callPrecompile(calldata);
    const bridgeReceipt = await bridgeTx.wait();
    precompileGasSamples.push(parseEventGas(iface, bridgeReceipt!.logs));

    // ── Direct Solidity path ───────────────────────────────────────────────
    const directTx      = await signer.sendTransaction({ to: precompileAddr, data: calldata });
    const directReceipt = await directTx.wait();
    solidityGasSamples.push(directReceipt!.gasUsed);
  }

  return {
    precompileGas: avg(precompileGasSamples),
    solidityGas:   avg(solidityGasSamples),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────────────────────────────────────

async function setupMocks(): Promise<void> {
  const factory = await ethers.getContractFactory("MockPrecompile");
  const mock    = await factory.deploy();
  await mock.waitForDeployment();

  const code = await ethers.provider.getCode(await mock.getAddress());
  for (const addr of [PRECOMPILE_POSEIDON, PRECOMPILE_BLS_VERIFY, PRECOMPILE_DOT_PRODUCT]) {
    await ethers.provider.send("hardhat_setCode", [addr, code]);
  }
}

async function deployBridge(precompileAddr: string): Promise<RustBridge> {
  const factory = await ethers.getContractFactory("RustBridge");
  const bridge  = await factory.deploy(precompileAddr);
  await bridge.waitForDeployment();
  return bridge as unknown as RustBridge;
}

// ─────────────────────────────────────────────────────────────────────────────
// Table printer
// ─────────────────────────────────────────────────────────────────────────────

function printTable(report: BenchReport): void {
  const COL = [22, 18, 16, 10] as const;
  const totalWidth = COL.reduce((s, w) => s + w + 3, 1);
  const hr = "─".repeat(totalWidth);

  const cell = (cells: string[]) =>
    "│ " + cells.map((c, i) => c.padEnd(COL[i])).join(" │ ") + " │";

  console.log(`\nBenchmark  •  network: ${report.network}  •  ${RUNS} runs averaged  •  ${report.timestamp}`);
  console.log(`┌${hr}┐`);
  console.log(cell(["operation", "precompileGas", "solidityGas", "speedup"]));
  console.log(`├${hr}┤`);
  for (const r of report.results) {
    console.log(cell([
      r.operation,
      r.rustPrecompileGas.toLocaleString(),
      r.pureSolidityGas.toLocaleString(),
      r.speedup.toFixed(2) + "x",
    ]));
  }
  console.log(`└${hr}┘`);
  console.log(
    "  precompileGas = inner exec gas from PrecompileCalled event (no 21k base cost)\n" +
    "  solidityGas   = full direct-tx gas (incl. 21k base cost)\n" +
    "  * mock values — real speedup on PolkaVM will be significantly higher\n"
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`\nSetting up mock precompiles at 0x900 / 0x901 / 0x902 …`);
  await setupMocks();

  console.log(`Deploying RustBridge instances …`);
  const [poseidonBridge, blsBridge, dotBridge] = await Promise.all([
    deployBridge(PRECOMPILE_POSEIDON),
    deployBridge(PRECOMPILE_BLS_VERIFY),
    deployBridge(PRECOMPILE_DOT_PRODUCT),
  ]);

  const results: BenchResult[] = [];

  // ── poseidonHash cases ────────────────────────────────────────────────────

  const poseidonCases: Array<{ label: string; inputs: bigint[] }> = [
    { label: "poseidonHash(n=1)",  inputs: [42n] },
    { label: "poseidonHash(n=5)",  inputs: [1n, 2n, 3n, 4n, 5n] },
    { label: "poseidonHash(n=10)", inputs: Array.from({ length: 10 }, (_, i) => BigInt(i + 1)) },
  ];

  for (const { label, inputs } of poseidonCases) {
    process.stdout.write(`  Benchmarking ${label} … `);
    const calldata = buildCall(SEL_POSEIDON, ["uint256[]"], [inputs]);
    const { precompileGas, solidityGas } = await runBench(poseidonBridge, PRECOMPILE_POSEIDON, calldata);
    const speedup = solidityGas / precompileGas;
    console.log(`precompile=${precompileGas}  solidity=${solidityGas}  speedup=${speedup.toFixed(2)}x`);
    results.push({
      operation:         label,
      rustPrecompileGas: precompileGas,
      pureSolidityGas:   solidityGas,
      speedup:           +speedup.toFixed(2),
      note:              "mock values — real speedup expected on PolkaVM",
    });
  }

  // ── blsVerify cases ───────────────────────────────────────────────────────

  const blsCases: Array<{ label: string; msgLen: number }> = [
    { label: "blsVerify(32B msg)",  msgLen: 32   },
    { label: "blsVerify(256B msg)", msgLen: 256  },
    { label: "blsVerify(1kB msg)",  msgLen: 1024 },
  ];

  for (const { label, msgLen } of blsCases) {
    process.stdout.write(`  Benchmarking ${label} … `);
    const pubkey   = ethers.hexlify(ethers.randomBytes(48));
    const msg      = ethers.randomBytes(msgLen);
    const sig      = ethers.hexlify(ethers.randomBytes(96));
    const calldata = buildCall(SEL_BLS_VERIFY, ["bytes", "bytes", "bytes"], [pubkey, msg, sig]);
    const { precompileGas, solidityGas } = await runBench(blsBridge, PRECOMPILE_BLS_VERIFY, calldata);
    const speedup = solidityGas / precompileGas;
    console.log(`precompile=${precompileGas}  solidity=${solidityGas}  speedup=${speedup.toFixed(2)}x`);
    results.push({
      operation:         label,
      rustPrecompileGas: precompileGas,
      pureSolidityGas:   solidityGas,
      speedup:           +speedup.toFixed(2),
      note:              "stub always returns true — mock values",
    });
  }

  // ── dotProduct cases ──────────────────────────────────────────────────────

  const dotCases: Array<{ label: string; n: number; neg: boolean }> = [
    { label: "dotProduct(n=10)",        n: 10,  neg: false },
    { label: "dotProduct(n=50)",        n: 50,  neg: false },
    { label: "dotProduct(n=100)",       n: 100, neg: false },
    { label: "dotProduct(n=100, mixed)", n: 100, neg: true  },
  ];

  for (const { label, n, neg } of dotCases) {
    process.stdout.write(`  Benchmarking ${label} … `);
    const a = Array.from({ length: n }, (_, i) =>
      neg && i % 2 === 1 ? -BigInt(i + 1) : BigInt(i + 1)
    );
    const b = Array.from({ length: n }, (_, i) => BigInt(i + 1));
    const calldata = buildCall(SEL_DOT_PRODUCT, ["int256[]", "int256[]"], [a, b]);
    const { precompileGas, solidityGas } = await runBench(dotBridge, PRECOMPILE_DOT_PRODUCT, calldata);
    const speedup = solidityGas / precompileGas;
    console.log(`precompile=${precompileGas}  solidity=${solidityGas}  speedup=${speedup.toFixed(2)}x`);
    results.push({
      operation:         label,
      rustPrecompileGas: precompileGas,
      pureSolidityGas:   solidityGas,
      speedup:           +speedup.toFixed(2),
      note:              "mock values — real speedup expected on PolkaVM",
    });
  }

  // ── Report ────────────────────────────────────────────────────────────────

  const report: BenchReport = {
    timestamp: new Date().toISOString(),
    network:   network.name,
    runs:      RUNS,
    results,
  };

  printTable(report);

  const outPath = path.join(__dirname, "..", "benchmark-results.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`Results written to benchmark-results.json\n`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
