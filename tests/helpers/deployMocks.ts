import { ethers } from "hardhat";

// ---------------------------------------------------------------------------
// Canonical precompile addresses (must match the Rust dispatcher registration)
// ---------------------------------------------------------------------------
export const PRECOMPILE_POSEIDON = "0x0000000000000000000000000000000000000900";
export const PRECOMPILE_BLS_VERIFY = "0x0000000000000000000000000000000000000901";
export const PRECOMPILE_DOT_PRODUCT = "0x0000000000000000000000000000000000000902";

const PRECOMPILE_ADDRESSES = [
  PRECOMPILE_POSEIDON,
  PRECOMPILE_BLS_VERIFY,
  PRECOMPILE_DOT_PRODUCT,
] as const;

// ---------------------------------------------------------------------------
// setupMocks
// ---------------------------------------------------------------------------

/**
 * Deploy MockPrecompile once, then use `hardhat_setCode` to inject its
 * runtime bytecode at each precompile address.
 *
 * After this call, any low-level `.call(data)` to 0x900 / 0x901 / 0x902
 * will be handled by the mock's fallback, exercising the full
 *   Solidity → precompile address → ABI decode → compute → ABI encode
 * path locally without a real PolkaVM runtime.
 *
 * @returns The deployed MockPrecompile instance (useful for direct calls
 *          in tests that need the contract ABI).
 */
export async function setupMocks() {
  // 1. Deploy the mock to get its compiled runtime bytecode.
  const factory = await ethers.getContractFactory("MockPrecompile");
  const mock = await factory.deploy();
  await mock.waitForDeployment();

  const mockAddress = await mock.getAddress();
  const runtimeCode = await ethers.provider.getCode(mockAddress);

  // 2. Stamp the same bytecode at all three precompile addresses.
  for (const addr of PRECOMPILE_ADDRESSES) {
    await ethers.provider.send("hardhat_setCode", [addr, runtimeCode]);
  }

  // 3. Sanity-check: each address now has non-empty code.
  for (const addr of PRECOMPILE_ADDRESSES) {
    const code = await ethers.provider.getCode(addr);
    if (code === "0x") {
      throw new Error(`setupMocks: hardhat_setCode failed for ${addr}`);
    }
  }

  return mock;
}
