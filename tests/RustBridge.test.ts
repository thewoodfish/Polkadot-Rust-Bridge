import { expect } from "chai";
import { ethers } from "hardhat";
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

const SEL_POSEIDON    = "0x2a58cd44"; // keccak256("poseidonHash(uint256[])")
const SEL_BLS_VERIFY  = "0xa65ebb25"; // keccak256("blsVerify(bytes,bytes,bytes)")
const SEL_DOT_PRODUCT = "0x55989ee5"; // keccak256("dotProduct(int256[],int256[])")

/** Concatenate a 4-byte selector with ABI-encoded arguments. */
function buildCall(selector: string, types: string[], values: unknown[]): string {
  return selector + abiCoder.encode(types, values).slice(2);
}

async function deployBridge(precompileAddr: string): Promise<RustBridge> {
  const factory = await ethers.getContractFactory("RustBridge");
  const bridge = await factory.deploy(precompileAddr);
  await bridge.waitForDeployment();
  return bridge as unknown as RustBridge;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("RustBridge — end-to-end via MockPrecompile", function () {
  let poseidonBridge:    RustBridge;
  let blsBridge:         RustBridge;
  let dotProductBridge:  RustBridge;

  beforeEach(async function () {
    await setupMocks();

    [poseidonBridge, blsBridge, dotProductBridge] = await Promise.all([
      deployBridge(PRECOMPILE_POSEIDON),
      deployBridge(PRECOMPILE_BLS_VERIFY),
      deployBridge(PRECOMPILE_DOT_PRODUCT),
    ]);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // poseidonHash(uint256[])
  // ─────────────────────────────────────────────────────────────────────────
  describe("poseidonHash(uint256[])", function () {
    it("single input [42] returns a non-zero deterministic uint256", async function () {
      const calldata = buildCall(SEL_POSEIDON, ["uint256[]"], [[42n]]);

      const raw = await poseidonBridge.callPrecompile.staticCall(calldata);
      const [hash] = abiCoder.decode(["uint256"], raw) as [bigint];

      expect(hash).to.be.gt(0n);
    });

    it("same inputs always return the same output (determinism)", async function () {
      const calldata = buildCall(SEL_POSEIDON, ["uint256[]"], [[42n]]);

      const r1 = await poseidonBridge.callPrecompile.staticCall(calldata);
      const r2 = await poseidonBridge.callPrecompile.staticCall(calldata);
      const r3 = await poseidonBridge.callPrecompile.staticCall(calldata);

      expect(r1).to.equal(r2);
      expect(r2).to.equal(r3);
    });

    it("array of 10 elements returns a non-zero uint256", async function () {
      const inputs = Array.from({ length: 10 }, (_, i) => BigInt(i + 1));
      const calldata = buildCall(SEL_POSEIDON, ["uint256[]"], [inputs]);

      const raw = await poseidonBridge.callPrecompile.staticCall(calldata);
      const [hash] = abiCoder.decode(["uint256"], raw) as [bigint];

      expect(hash).to.be.gt(0n);
    });

    it("different inputs produce different hashes", async function () {
      const cd1 = buildCall(SEL_POSEIDON, ["uint256[]"], [[1n, 2n, 3n]]);
      const cd2 = buildCall(SEL_POSEIDON, ["uint256[]"], [[1n, 2n, 4n]]);

      const r1 = await poseidonBridge.callPrecompile.staticCall(cd1);
      const r2 = await poseidonBridge.callPrecompile.staticCall(cd2);

      expect(r1).to.not.equal(r2);
    });

    it("empty array reverts through the bridge", async function () {
      const calldata = buildCall(SEL_POSEIDON, ["uint256[]"], [[]]);

      await expect(
        poseidonBridge.callPrecompile(calldata)
      ).to.be.revertedWith("RustBridge: precompile call failed");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // blsVerify(bytes,bytes,bytes)
  // ─────────────────────────────────────────────────────────────────────────
  describe("blsVerify(bytes,bytes,bytes)", function () {
    const PUBKEY_LEN = 48;
    const SIG_LEN    = 96;

    /** Build valid-length (stubbed) BLS call data. */
    function validBLSCall(msg = ethers.toUtf8Bytes("hello polkadot")): string {
      const pubkey = ethers.hexlify(ethers.randomBytes(PUBKEY_LEN));
      const sig    = ethers.hexlify(ethers.randomBytes(SIG_LEN));
      return buildCall(SEL_BLS_VERIFY, ["bytes", "bytes", "bytes"], [pubkey, msg, sig]);
    }

    it("valid stub always returns true", async function () {
      const raw = await blsBridge.callPrecompile.staticCall(validBLSCall());
      const [valid] = abiCoder.decode(["bool"], raw) as [boolean];

      expect(valid).to.equal(true);
    });

    it("returns true regardless of message content", async function () {
      for (const msg of [
        ethers.toUtf8Bytes(""),
        ethers.toUtf8Bytes("different message"),
        ethers.randomBytes(256),
      ]) {
        const raw = await blsBridge.callPrecompile.staticCall(validBLSCall(msg));
        const [valid] = abiCoder.decode(["bool"], raw) as [boolean];
        expect(valid).to.equal(true);
      }
    });

    it("wrong-length pubkey (32 bytes instead of 48) reverts", async function () {
      const shortPubkey = ethers.hexlify(ethers.randomBytes(32));
      const msg         = ethers.toUtf8Bytes("hello");
      const sig         = ethers.hexlify(ethers.randomBytes(SIG_LEN));
      const calldata    = buildCall(
        SEL_BLS_VERIFY, ["bytes", "bytes", "bytes"], [shortPubkey, msg, sig]
      );

      await expect(
        blsBridge.callPrecompile(calldata)
      ).to.be.revertedWith("RustBridge: precompile call failed");
    });

    it("wrong-length signature (48 bytes instead of 96) reverts", async function () {
      const pubkey   = ethers.hexlify(ethers.randomBytes(PUBKEY_LEN));
      const msg      = ethers.toUtf8Bytes("hello");
      const shortSig = ethers.hexlify(ethers.randomBytes(48));
      const calldata = buildCall(
        SEL_BLS_VERIFY, ["bytes", "bytes", "bytes"], [pubkey, msg, shortSig]
      );

      await expect(
        blsBridge.callPrecompile(calldata)
      ).to.be.revertedWith("RustBridge: precompile call failed");
    });

    it("zero-length pubkey reverts", async function () {
      const calldata = buildCall(
        SEL_BLS_VERIFY, ["bytes", "bytes", "bytes"],
        ["0x", ethers.toUtf8Bytes("msg"), ethers.hexlify(ethers.randomBytes(SIG_LEN))]
      );

      await expect(
        blsBridge.callPrecompile(calldata)
      ).to.be.revertedWith("RustBridge: precompile call failed");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // dotProduct(int256[],int256[])
  // ─────────────────────────────────────────────────────────────────────────
  describe("dotProduct(int256[],int256[])", function () {
    async function dot(a: bigint[], b: bigint[]): Promise<bigint> {
      const calldata = buildCall(SEL_DOT_PRODUCT, ["int256[]", "int256[]"], [a, b]);
      const raw = await dotProductBridge.callPrecompile.staticCall(calldata);
      const [result] = abiCoder.decode(["int256"], raw) as [bigint];
      return result;
    }

    it("[1,2,3] · [4,5,6] = 4+10+18 = 32", async function () {
      expect(await dot([1n, 2n, 3n], [4n, 5n, 6n])).to.equal(32n);
    });

    it("[-1,2] · [3,-4] = -3+(-8) = -11", async function () {
      expect(await dot([-1n, 2n], [3n, -4n])).to.equal(-11n);
    });

    it("all-negative [-2,-3] · [-4,-5] = 8+15 = 23", async function () {
      expect(await dot([-2n, -3n], [-4n, -5n])).to.equal(23n);
    });

    it("single element [7] · [6] = 42", async function () {
      expect(await dot([7n], [6n])).to.equal(42n);
    });

    it("empty arrays return 0", async function () {
      expect(await dot([], [])).to.equal(0n);
    });

    it("mismatched array lengths reverts", async function () {
      const calldata = buildCall(
        SEL_DOT_PRODUCT, ["int256[]", "int256[]"], [[1n, 2n], [3n]]
      );

      await expect(
        dotProductBridge.callPrecompile(calldata)
      ).to.be.revertedWith("RustBridge: precompile call failed");
    });

    it("large values: [2^128] · [2^126] stays in range", async function () {
      const a = [2n ** 128n];
      const b = [2n ** 126n];
      // 2^128 * 2^126 = 2^254, which fits in int256 (max positive = 2^255 - 1)
      const expected = 2n ** 254n;
      expect(await dot(a, b)).to.equal(expected);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Legacy: fibonacci (Solidity reference, kept for regression)
  // ─────────────────────────────────────────────────────────────────────────
  describe("fibonacci (Solidity reference)", function () {
    let bridge: RustBridge;

    beforeEach(async function () {
      const factory = await ethers.getContractFactory("RustBridge");
      bridge = await factory.deploy(ethers.ZeroAddress) as unknown as RustBridge;
      await bridge.waitForDeployment();
    });

    const cases: [bigint, bigint][] = [
      [0n, 0n],
      [1n, 1n],
      [10n, 55n],
      [20n, 6765n],
    ];

    for (const [n, expected] of cases) {
      it(`fibonacci(${n}) == ${expected}`, async function () {
        expect(await bridge.fibonacci(n)).to.equal(expected);
      });
    }
  });
});
