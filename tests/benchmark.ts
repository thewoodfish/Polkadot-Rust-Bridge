import { ethers } from "hardhat";
import { RustBridge } from "../typechain-types";

interface BenchResult {
  label: string;
  n: bigint;
  gasUsed: bigint;
  result: bigint;
}

async function bench(
  bridge: RustBridge,
  label: string,
  n: bigint
): Promise<BenchResult> {
  const tx = await bridge.fibonacci.populateTransaction(n);
  const [signer] = await ethers.getSigners();
  const receipt = await (
    await signer.sendTransaction({ ...tx, to: await bridge.getAddress() })
  ).wait();

  const result = await bridge.fibonacci(n);
  return {
    label,
    n,
    gasUsed: receipt?.gasUsed ?? 0n,
    result,
  };
}

describe("Benchmark: Solidity fibonacci vs PolkaVM precompile", function () {
  this.timeout(60_000);

  let bridge: RustBridge;

  before(async function () {
    const factory = await ethers.getContractFactory("RustBridge");
    bridge = (await factory.deploy(ethers.ZeroAddress)) as RustBridge;
    await bridge.waitForDeployment();
  });

  const inputs = [10n, 50n, 100n, 500n, 1000n];

  for (const n of inputs) {
    it(`fibonacci(${n}) — Solidity`, async function () {
      const res = await bench(bridge, "Solidity", n);
      console.log(
        `  [Solidity] fibonacci(${n}) => ${res.result}  gas: ${res.gasUsed}`
      );
    });
  }
});
