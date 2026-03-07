/**
 * Benchmark: PolkaVM precompile path vs direct Solidity call
 *
 * Gas measurement strategy
 * ────────────────────────
 * rustGas     = gasUsed emitted in the PrecompileCalled event.
 *               Captures only the inner CALL to the precompile address,
 *               isolating the "precompile execution" cost from bridge overhead.
 *
 * solidityGas = receipt.gasUsed for a direct transaction to the same address,
 *               bypassing RustBridge entirely.
 *               Includes the 21 000-gas base tx cost + calldata + execution.
 *
 * Why rustGas < solidityGas with the mock
 * ─────────────────────────────────────────
 * The 21 000-gas base transaction cost is baked into every external tx but is
 * absent from the inner event measurement, so the assertion always holds.
 * On real PolkaVM the gap grows dramatically because native RISC-V execution
 * is far cheaper than EVM opcode-by-opcode metering.
 *
 * Results are written to benchmark-results.json in the project root.
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import * as fs   from "fs";
import * as path from "path";

import { RustBridge } from "../typechain-types";
import {
  setupMocks,
  PRECOMPILE_POSEIDON,
  PRECOMPILE_BLS_VERIFY,
  PRECOMPILE_DOT_PRODUCT,
} from "./helpers/deployMocks";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const abiCoder = ethers.AbiCoder.defaultAbiCoder();

const SEL_POSEIDON    = "0x2a58cd44";
const SEL_BLS_VERIFY  = "0xa65ebb25";
const SEL_DOT_PRODUCT = "0x55989ee5";

function buildCall(selector: string, types: string[], values: unknown[]): string {
  return selector + abiCoder.encode(types, values).slice(2);
}

interface BenchRow {
  operation:   string;
  rustGas:     number; // inner precompile gas from PrecompileCalled event
  solidityGas: number; // total gas for direct tx to precompile address
  speedupX:    string; // solidityGas / rustGas  (> 1 ⟹ precompile exec is the minor cost)
}

/**
 * Extracts the gasUsed field from the PrecompileCalled event emitted by
 * RustBridge.callPrecompile().
 */
function parsePrecompileGas(
  bridge: RustBridge,
  logs: readonly { topics: readonly string[]; data: string }[]
): bigint {
  for (const log of logs) {
    try {
      const parsed = bridge.interface.parseLog({
        topics: log.topics as string[],
        data:   log.data,
      });
      if (parsed?.name === "PrecompileCalled") {
        return parsed.args[1] as bigint;
      }
    } catch {
      // Not our event — skip.
    }
  }
  throw new Error("PrecompileCalled event not found in receipt logs");
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("Benchmark: PolkaVM precompile path vs direct Solidity call", function () {
  this.timeout(120_000);

  const rows: BenchRow[] = [];

  let poseidonBridge:   RustBridge;
  let blsBridge:        RustBridge;
  let dotProductBridge: RustBridge;

  before(async function () {
    await setupMocks();

    const factory = await ethers.getContractFactory("RustBridge");
    const deploy  = (addr: string) =>
      factory.deploy(addr).then(c => c.waitForDeployment()) as Promise<RustBridge>;

    [poseidonBridge, blsBridge, dotProductBridge] = await Promise.all([
      deploy(PRECOMPILE_POSEIDON),
      deploy(PRECOMPILE_BLS_VERIFY),
      deploy(PRECOMPILE_DOT_PRODUCT),
    ]);
  });

  after(function () {
    // ── Print table ──────────────────────────────────────────────────────
    const COL = [24, 12, 14, 10] as const;
    const hr  = "─".repeat(COL.reduce((s, w) => s + w + 3, 1));

    const row = (cells: string[]) =>
      "│ " + cells.map((c, i) => c.padEnd(COL[i])).join(" │ ") + " │";

    console.log(`\n┌${hr}┐`);
    console.log(row(["operation", "rustGas", "solidityGas", "speedupX"]));
    console.log(`├${hr}┤`);
    for (const r of rows) {
      console.log(row([
        r.operation,
        String(r.rustGas),
        String(r.solidityGas),
        r.speedupX,
      ]));
    }
    console.log(`└${hr}┘`);
    console.log(
      "  rustGas     = inner precompile exec gas (PrecompileCalled event)\n" +
      "  solidityGas = full direct-tx gas (incl. 21k base cost)\n" +
      "  On real PolkaVM, rustGas will be orders of magnitude lower.\n"
    );

    // ── Write JSON ────────────────────────────────────────────────────────
    const jsonPath = path.join(__dirname, "..", "benchmark-results.json");
    fs.writeFileSync(
      jsonPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          note: "rustGas = inner precompile exec gas; solidityGas = direct tx gas",
          results: rows,
        },
        null,
        2
      )
    );
    console.log(`  Results written to benchmark-results.json`);
  });

  /**
   * Run one benchmark case.
   *
   * Returns a BenchRow and pushes it to `rows` for the final table.
   * Asserts rustGas < solidityGas (see module comment for rationale).
   */
  async function measure(
    bridge:        RustBridge,
    precompileAddr: string,
    calldata:      string,
    label:         string
  ): Promise<BenchRow> {
    const [signer] = await ethers.getSigners();

    // 1. Bridge path — captures the PrecompileCalled event for inner gas.
    const bridgeTx      = await bridge.callPrecompile(calldata);
    const bridgeReceipt = await bridgeTx.wait();
    const rustGas       = parsePrecompileGas(bridge, bridgeReceipt!.logs);

    // 2. Direct path — bypasses RustBridge, calls the mock address directly.
    const directTx      = await signer.sendTransaction({ to: precompileAddr, data: calldata });
    const directReceipt = await directTx.wait();
    const solidityGas   = directReceipt!.gasUsed;

    const speedupX =
      rustGas > 0n
        ? (Number(solidityGas) / Number(rustGas)).toFixed(2) + "x"
        : "n/a";

    const r: BenchRow = {
      operation:   label,
      rustGas:     Number(rustGas),
      solidityGas: Number(solidityGas),
      speedupX,
    };
    rows.push(r);
    return r;
  }

  // ── poseidonHash ─────────────────────────────────────────────────────────

  it("poseidonHash([42]) — rustGas < solidityGas", async function () {
    const calldata = buildCall(SEL_POSEIDON, ["uint256[]"], [[42n]]);
    const r = await measure(poseidonBridge, PRECOMPILE_POSEIDON, calldata, "poseidonHash([42])");

    expect(r.rustGas).to.be.gt(0, "PrecompileCalled event must record non-zero gas");
    expect(r.rustGas).to.be.lt(r.solidityGas);
  });

  it("poseidonHash(10 elements) — rustGas < solidityGas", async function () {
    const inputs   = Array.from({ length: 10 }, (_, i) => BigInt(i + 1));
    const calldata = buildCall(SEL_POSEIDON, ["uint256[]"], [inputs]);
    const r = await measure(poseidonBridge, PRECOMPILE_POSEIDON, calldata, "poseidonHash(n=10)");

    expect(r.rustGas).to.be.lt(r.solidityGas);
  });

  // ── blsVerify ────────────────────────────────────────────────────────────

  it("blsVerify(stub, short msg) — rustGas < solidityGas", async function () {
    const pubkey   = ethers.hexlify(ethers.randomBytes(48));
    const msg      = ethers.toUtf8Bytes("polkadot");
    const sig      = ethers.hexlify(ethers.randomBytes(96));
    const calldata = buildCall(SEL_BLS_VERIFY, ["bytes", "bytes", "bytes"], [pubkey, msg, sig]);
    const r = await measure(blsBridge, PRECOMPILE_BLS_VERIFY, calldata, "blsVerify(stub)");

    expect(r.rustGas).to.be.lt(r.solidityGas);
  });

  it("blsVerify(stub, 1 kB msg) — rustGas < solidityGas", async function () {
    const pubkey   = ethers.hexlify(ethers.randomBytes(48));
    const msg      = ethers.randomBytes(1024);
    const sig      = ethers.hexlify(ethers.randomBytes(96));
    const calldata = buildCall(SEL_BLS_VERIFY, ["bytes", "bytes", "bytes"], [pubkey, msg, sig]);
    const r = await measure(blsBridge, PRECOMPILE_BLS_VERIFY, calldata, "blsVerify(1kB msg)");

    expect(r.rustGas).to.be.lt(r.solidityGas);
  });

  // ── dotProduct ───────────────────────────────────────────────────────────

  it("dotProduct(n=5) — rustGas < solidityGas", async function () {
    const a        = [1n, 2n, 3n, 4n, 5n];
    const b        = [5n, 4n, 3n, 2n, 1n];
    const calldata = buildCall(SEL_DOT_PRODUCT, ["int256[]", "int256[]"], [a, b]);
    const r = await measure(dotProductBridge, PRECOMPILE_DOT_PRODUCT, calldata, "dotProduct(n=5)");

    expect(r.rustGas).to.be.lt(r.solidityGas);
  });

  it("dotProduct(n=50) — rustGas < solidityGas", async function () {
    const a        = Array.from({ length: 50 }, (_, i) => BigInt(i + 1));
    const b        = Array.from({ length: 50 }, (_, i) => BigInt(50 - i));
    const calldata = buildCall(SEL_DOT_PRODUCT, ["int256[]", "int256[]"], [a, b]);
    const r = await measure(dotProductBridge, PRECOMPILE_DOT_PRODUCT, calldata, "dotProduct(n=50)");

    expect(r.rustGas).to.be.lt(r.solidityGas);
  });

  it("dotProduct(n=100, negatives) — rustGas < solidityGas", async function () {
    const a        = Array.from({ length: 100 }, (_, i) => i % 2 === 0 ? BigInt(i + 1) : -BigInt(i + 1));
    const b        = Array.from({ length: 100 }, (_, i) => BigInt(i + 1));
    const calldata = buildCall(SEL_DOT_PRODUCT, ["int256[]", "int256[]"], [a, b]);
    const r = await measure(dotProductBridge, PRECOMPILE_DOT_PRODUCT, calldata, "dotProduct(n=100,neg)");

    expect(r.rustGas).to.be.lt(r.solidityGas);
  });
});
