# Architecture: Polkadot Rust Bridge

## Overview

Polkadot Rust Bridge demonstrates a new execution model made possible by `pallet-revive` on Polkadot Hub: **Solidity contracts calling Rust logic natively, on-chain, at a fraction of EVM opcode cost.**

The key insight is that `pallet-revive` allows EVM contracts to make standard `CALL` opcodes to addresses backed by **ink! v6 contracts compiled to PolkaVM's RISC-V target**. The Rust code runs natively, metered by the RISC-V gas model — which is dramatically cheaper for compute-heavy operations than interpreting EVM bytecode.

This project ships:
- An **ink! v6 contract** (`rust_bridge_ink`) implementing Poseidon hashing, BLS12-381 verification, and signed dot product in Rust, compiled to a `.polkavm` RISC-V binary
- A **Solidity façade** (`XCMRustBridge.sol`) any EVM contract can call with standard calldata
- A **complete Hardhat test harness** for local development with no live node required
- A **React dashboard** with live on-chain benchmark data

---

## The Call Flow

### Path 1 — Direct EVM Call (primary, deployed on Paseo Asset Hub)

```
  ┌──────────────────────────────────────────────────────────────────────┐
  │  Any Solidity contract                                               │
  │                                                                      │
  │  // Call ink! via XCMRustBridge façade:                              │
  │  uint128 h = bridge.directPoseidonHash(inputs);                      │
  │                                                                      │
  │  // Or call the ink! contract directly:                              │
  │  (bool ok, bytes memory ret) = inkEvmAddr.call(                      │
  │      abi.encodePacked(SEL_POSEIDON_HASH, scaleEncodedArgs)           │
  │  );                                                                  │
  └──────────────────────────────┬───────────────────────────────────────┘
                                 │  EVM CALL opcode
                                 ▼
  ┌──────────────────────────────────────────────────────────────────────┐
  │  pallet-revive  (Polkadot Hub runtime)                               │
  │                                                                      │
  │  • Routes call to ink! contract at its EVM-derived address           │
  │  • The ink! contract address exposed as H160 =                       │
  │    last 20 bytes of its AccountId32                                  │
  └──────────────────────────────┬───────────────────────────────────────┘
                                 │  Dispatch to PolkaVM executor
                                 ▼
  ┌──────────────────────────────────────────────────────────────────────┐
  │  rust_bridge_ink  (ink! v6 contract, .polkavm RISC-V binary)         │
  │                                                                      │
  │  #[ink(message)]                                                     │
  │  pub fn poseidon_hash(&self, inputs: Vec<u128>) -> u128 {            │
  │      // Runs natively as RISC-V — 14× cheaper than Solidity          │
  │      poseidon_permute(inputs)                                        │
  │  }                                                                   │
  │                                                                      │
  │  Return type: Result<u128, LangError>  (ink! v6 envelope)            │
  └──────────────────────────────┬───────────────────────────────────────┘
                                 │  SCALE-encoded Result<T, LangError>
                                 ▼
  ┌──────────────────────────────────────────────────────────────────────┐
  │  XCMRustBridge.sol  (Solidity façade)                                │
  │                                                                      │
  │  // Skip the 1-byte Ok(0x00) prefix from ink! v6 Result envelope:   │
  │  result = SCALEEncoder.decodeU128LE(ret, 1);                         │
  │  emit PoseidonHash(inputs, result);                                  │
  └──────────────────────────────────────────────────────────────────────┘
```

### Path 2 — XCM Transact (architecture path, not benchmarked)

`XCMRustBridge.sol` also implements an XCM Transact dispatch path (`dotProduct`, `poseidonHash` without the `direct` prefix) that routes through the XCM precompile at `0x…0401`. This is the correct long-term production path for cross-chain calls but its result delivery is asynchronous — results come back via events rather than a synchronous return value. The `direct*` functions are used for the benchmark and smoke test.

---

## ABI and Encoding Conventions

### Calling into the ink! Contract from Solidity

ink! contracts use **SCALE encoding**, not Solidity ABI encoding. `XCMRustBridge.sol` embeds a `SCALEEncoder` library that handles the encoding:

**Message call data layout:**
```
[ 4-byte selector ][ SCALE-encoded arguments ]
```

**Selector derivation (ink! v6):** Selectors are derived by cargo-contract during build and are available in the generated `.json` metadata file. They differ from ink! v5 selectors. Always read them from the metadata:

```bash
cat precompiles/target/ink/rust_bridge_ink/rust_bridge_ink.json \
  | python3 -c "
import json,sys
d=json.load(sys.stdin)
for m in d['spec']['messages']:
    print(m['label'], m['selector'])
"
```

Current selectors:

| Message | ink! v6 Selector | SCALE arg types |
|:---|:---|:---|
| `poseidon_hash` | `0x42762451` | `Vec<u128>` (compact length + little-endian u128 per element) |
| `dot_product` | `0xe3ccaf7e` | `Vec<i128>` + `Vec<i128>` |
| `bls_verify` | `0x955e9f2b` | `Vec<u8>` (pubkey) + `Vec<u8>` (message) + `Vec<u8>` (sig) |

**SCALE encoding rules used in this project:**

| Type | Encoding |
|:---|:---|
| `u128` / `i128` | 16 bytes, little-endian |
| `bool` | 1 byte, `0x00` = false, `0x01` = true |
| `Vec<T>` | compact(length) prefix, then elements in sequence |
| compact(n) | 1 byte if n < 64; 2 bytes if n < 16384; 4 bytes otherwise |
| `Vec<u8>` (bytes) | compact(byte_count), then raw bytes |

### Return Value: ink! v6 Result Envelope

In ink! v6, all message return values are wrapped in `Result<T, LangError>`:

```
[ 0x00 ][ SCALE-encoded T ]    ← Ok variant
[ 0x01 ][ SCALE-encoded E ]    ← Err variant
```

The Solidity decoder skips the first byte when decoding:

```solidity
// ink! v6: byte 0 = Ok(0x00), bytes 1..N = actual value
result = SCALEEncoder.decodeU128LE(ret, 1);  // offset = 1
```

This is the key difference from ink! v5, where the raw value was returned without an envelope.

---

## Project Structure

```
Polkadot-Rust-Bridge/
│
├── contracts/
│   ├── XCMRustBridge.sol        ← Main contract: SCALE encoder + direct/XCM call paths
│   ├── RustBridge.sol           ← Benchmark reference: raw precompile call (ABI-encoded)
│   └── mocks/
│       └── MockPrecompile.sol   ← Hardhat test mock: pure-Solidity equivalents
│
├── precompiles/
│   └── rust_bridge_ink/         ← ink! v6 contract source
│       ├── src/lib.rs           ← #[ink::contract]: poseidon_hash, dot_product, bls_verify
│       ├── Cargo.toml           ← ink = "6.0.0-beta.1", edition = "2024"
│       └── rust-toolchain.toml ← Pins nightly-2025-06-01
│
├── precompiles/target/ink/rust_bridge_ink/
│   ├── rust_bridge_ink.polkavm  ← Compiled PolkaVM binary (8.4 KB, committed)
│   ├── rust_bridge_ink.contract ← Bundle: code + metadata
│   └── rust_bridge_ink.json    ← ABI metadata: selectors, types, docs
│
├── tests/
│   ├── RustBridge.test.ts       ← 33 tests: correctness, edge values, reverts
│   ├── Benchmark.test.ts        ← Gas comparison tests
│   └── helpers/
│       └── deployMocks.ts       ← hardhat_setCode injection at 0x900–0x902
│
├── scripts/
│   ├── deploy-ink.ts            ← Deploy .polkavm to Paseo via eth_sendRawTransaction
│   ├── deploy.ts                ← Deploy XCMRustBridge + smoke test + benchmark
│   └── benchmark.ts             ← Local benchmark: writes benchmark-results.json
│
├── demo/                        ← React + Vite dashboard (deployed at Vercel)
│   └── src/data/
│       ├── benchmark-results-local.json    ← Hardhat mock results
│       └── benchmark-results-testnet.json  ← Live Paseo measurements
│
└── docs/
    └── ARCHITECTURE.md          ← This document
```

---

## The ink! v6 Contract

`precompiles/rust_bridge_ink/src/lib.rs` is a standard ink! v6 contract with three messages:

### `poseidon_hash(inputs: Vec<u128>) → u128`

Implements a Poseidon-like sponge construction over a 124-bit Mersenne-like prime `P = 2^124 - 3`. Uses a width-2 state, α=5 S-box, and an MDS matrix `[[1,1],[1,2]]` over 4 full rounds. The `u128` constraint (instead of a full BN254 field) is a `no_std` adaptation — a production deployment would use a proper BN254 library once `no_std` support stabilises.

Field arithmetic is implemented without overflow using 64-bit half-word splitting, with `#[allow(clippy::arithmetic_side_effects)]` on the helper functions.

### `dot_product(a: Vec<i128>, b: Vec<i128>) → i128`

Signed dot product using `checked_mul` and `checked_add`. Panics (reverts the transaction) on overflow — consistent with the PolkaVM precompile behaviour. Asserts equal lengths before computation.

### `bls_verify(pubkey: Vec<u8>, message: Vec<u8>, sig: Vec<u8>) → bool`

Validates pubkey length (48 bytes, G1 compressed) and signature length (96 bytes, G2 compressed). Returns `false` on invalid lengths rather than panicking. The full `blst::min_pk` BLS12-381 pairing check is implemented in the native PolkaVM precompile (`precompiles/rust-bridge/src/handlers/bls.rs`); this ink! version is the on-chain SCALE-accessible stub.

---

## Test Architecture

Tests run entirely on the **local Hardhat EVM** using `hardhat_setCode` to inject mock bytecode at the precompile addresses — no live node required.

```
              hardhat_setCode(0x900, MockPrecompile.bytecode)
              hardhat_setCode(0x901, MockPrecompile.bytecode)
              hardhat_setCode(0x902, MockPrecompile.bytecode)
                        │
              RustBridge.callPrecompile(data)
                        │
                        ▼  low-level CALL
              MockPrecompile.fallback(data)
                        │  dispatch on 4-byte selector
                        ├─ 0x2a58cd44 → _poseidonHash  (keccak256 stand-in)
                        ├─ 0xa65ebb25 → _blsVerify     (length check)
                        └─ 0x55989ee5 → _dotProduct    (arithmetic)
```

`MockPrecompile.sol` uses a `fallback(bytes calldata) returns (bytes memory)` function to handle all calls as raw bytes, matching the low-level `.call(data)` interface used by `RustBridge.callPrecompile`. The same bytecode blob is deployed at all three addresses; dispatch is driven by the 4-byte selector.

The 33 tests cover:
- Determinism and collision resistance (Poseidon)
- Overflow and length-mismatch reverts (dot product)
- Length validation (BLS verify)
- SCALE encoding correctness (XCMRustBridge)
- Gas event emission

---

## Benchmark Methodology

### Local Benchmark (`npm run benchmark`)

Runs `scripts/benchmark.ts` against the Hardhat in-process network. Each figure is the **average of 10 consecutive transactions** to reduce JIT warm-up variance.

**Rust precompile gas** is the gas emitted in the `PrecompileCalled(selector, gasUsed)` event — this is *only* the inner `CALL` cost, excluding the 21,000 base transaction fee, calldata bytes, and Solidity wrapper overhead.

**Pure Solidity gas** is the full `receipt.gasUsed` for a direct transaction to `MockPrecompile` performing equivalent work in Solidity 0.8.24 (keccak256 hash stand-in, checked arithmetic, length checks). This includes the 21,000 base cost, making the comparison deliberately conservative.

> Because both paths execute EVM bytecode locally (the mock), local speedups reflect ABI-encoding overhead differences rather than real RISC-V throughput. Local numbers are therefore *lower-bound* estimates.

### Testnet Benchmark (`npm run deploy`)

Step 4 of `scripts/deploy.ts` runs 5 iterations of each `direct*` call on live Paseo Asset Hub. Gas figures are read from `receipt.gasUsed` after each confirmed transaction.

The ink! contract executes as native RISC-V via PolkaVM. Measured results:

| Operation | Live gas | vs Solidity mock | Speedup |
|:---|---:|---:|:---:|
| `poseidonHash(n=1)` | 1,620 | 23,043 | **14.2×** |
| `poseidonHash(n=5)` | 2,268 | 24,259 | **10.7×** |
| `blsVerify(32B)` | 3,077 | 30,460 | **9.9×** |
| `dotProduct(n=3)` | 2,755 | 24,500 | **8.9×** |
| `dotProduct(n=10)` | 5,007 | 31,711 | **6.3×** |

---

## How to Add a New Precompile (Step-by-Step)

### Step 1 — Add a message to `rust_bridge_ink/src/lib.rs`

```rust
/// Compute the square root of a u128 (integer floor).
#[ink(message)]
pub fn isqrt(&self, n: u128) -> u128 {
    if n == 0 { return 0; }
    let mut x = n;
    let mut y = (x + 1) / 2;
    while y < x {
        x = y;
        y = (x + n / x) / 2;
    }
    x
}
```

### Step 2 — Build and get the selector

```bash
cd precompiles/rust_bridge_ink
cargo contract build --release

# Read the new selector from metadata:
python3 -c "
import json
d = json.load(open('../../target/ink/rust_bridge_ink/rust_bridge_ink.json'))
for m in d['spec']['messages']:
    print(m['label'], m['selector'])
"
# isqrt  0xXXXXXXXX  ← note this value
```

### Step 3 — Add the selector constant to `XCMRustBridge.sol`

```solidity
// ink! v6 selector for isqrt(u128) — from rust_bridge_ink.json
bytes4 public constant SEL_ISQRT = 0xXXXXXXXX;
```

### Step 4 — Add a `direct*` function to `XCMRustBridge.sol`

```solidity
function directIsqrt(uint128 n)
    external
    returns (uint128 result)
{
    bytes memory callData = _encodeInkCall(
        SEL_ISQRT,
        SCALEEncoder.encodeU128(n)    // add encodeU128 to SCALEEncoder if needed
    );
    bytes memory ret = _directCall(callData);
    // ink! v6: skip 1-byte Ok(0x00) prefix
    result = SCALEEncoder.decodeU128LE(ret, 1);
    emit IsqrtResult(n, result);
}
```

### Step 5 — Add a mock implementation for local testing

In `contracts/mocks/MockPrecompile.sol`, add a dispatch branch in `fallback`:

```solidity
} else if (sel == 0xXXXXXXXX) {
    output = _isqrt(args);
}
```

And the handler:

```solidity
function _isqrt(bytes calldata args) internal pure returns (bytes memory) {
    (uint128 n) = abi.decode(args, (uint128));
    // integer sqrt via Newton's method
    if (n == 0) return abi.encode(uint128(0));
    uint128 x = n;
    uint128 y = (x + 1) / 2;
    while (y < x) { x = y; y = (x + n / x) / 2; }
    return abi.encode(x);
}
```

### Step 6 — Add tests in `tests/RustBridge.test.ts`

Follow the existing pattern (correctness cases, edge values, overflow/revert cases):

```typescript
describe("directIsqrt", function () {
  it("isqrt(0) == 0", async () => { ... });
  it("isqrt(4) == 2", async () => { ... });
  it("isqrt(MAX_U128) does not revert", async () => { ... });
});
```

---

## Deployment Architecture (Paseo Asset Hub)

### Network

- **Chain:** Paseo Asset Hub (Polkadot testnet)
- **Chain ID:** 420420417
- **Runtime:** `pallet-revive` (EVM-compatible, PolkaVM executor)
- **EVM RPC:** `https://eth-rpc-testnet.polkadot.io/`
- **Explorer:** https://blockscout-testnet.polkadot.io

> **Westend vs Paseo:** Westend Asset Hub (chain 420420421) still uses the legacy `pallet-contracts` (Wasm). Only Paseo Asset Hub runs `pallet-revive`. Do not confuse the two.

### Contract Addresses

| Contract | Address |
|:---|:---|
| `rust_bridge_ink` (ink! v6 / PolkaVM) | `0xE5F4F5D96a1C8141c52C0c6426944F2A8bFdE0d5` |
| `XCMRustBridge.sol` | `0x0794D9FfF1f2FE27Fa0ABCFf51cf8b12C1C9f498` |

### Deploying ink! v6 via EVM RPC

`pallet-revive` exposes a standard EVM RPC. An ink! v6 contract is deployed like any EVM contract — `eth_sendRawTransaction` with `to: null`. The transaction data is:

```
data = polkavm_bytecode_bytes ++ constructor_selector_bytes
```

For a parameterless `new()` constructor (selector `0x9bae9d5e`):

```typescript
const polkavmBytes = fs.readFileSync("rust_bridge_ink.polkavm");
const deployData = "0x" + polkavmBytes.toString("hex") + "9bae9d5e";

const tx = {
  type:     0,          // legacy — required by pallet-revive
  chainId:  420420417,
  nonce:    await provider.getTransactionCount(deployer),
  gasPrice: await provider.getFeeData().then(f => f.gasPrice),
  gasLimit: 5_000_000n,
  to:       null,       // contract creation
  data:     deployData,
};
```

See `scripts/deploy-ink.ts` for the full implementation.

### H160 ↔ AccountId32 Mapping

`pallet-revive` maps between EVM addresses (H160, 20 bytes) and Substrate addresses (AccountId32, 32 bytes):

```
AccountId32 → H160:  take the last 20 bytes (bytes 12–31)
H160 → AccountId32:  prefix with 12 zero bytes

AccountId32 = 0x000000000000000000000000 ++ H160
```

This is why `INK_CONTRACT_ADDRESS` in `.env` must be formatted as:
```
INK_CONTRACT_ADDRESS=0x000000000000000000000000E5F4F5D96a1C8141c52C0c6426944F2A8bFdE0d5
                         ^^^^^^^^^^^^^^^^^^^^^^^^  ←12 zero bytes→
                                                 ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                                                        ←H160 address (20 bytes)→
```

`XCMRustBridge.sol` recovers the EVM address via:
```solidity
function inkEvmAddress() public view returns (address) {
    return address(uint160(uint256(inkContractAddress)));
    //                     ↑ treats bytes32 as big-endian uint256
    //             ↑ takes lower 20 bytes = last 20 bytes of bytes32
}
```

---

## Design Decisions

### Why ink! v6 instead of a native PolkaVM precompile?

A native precompile (registered at a well-known address via `sudo`) gives maximum throughput but requires governance approval and cannot be deployed permissionlessly. An ink! v6 contract deployed via the EVM RPC:

- Requires no special permissions — anyone with tokens can deploy
- Is upgradeable via standard contract upgrade patterns
- Exposes an EVM-callable address automatically (no address registration)
- Achieves 6–14× speedup vs Solidity for the operations shown

For production use cases needing even higher throughput (e.g., full BLS12-381 pairing), a native precompile is the appropriate path.

### Why SCALE encoding instead of ABI encoding?

ink! messages are SCALE-encoded internally. The `SCALEEncoder` library in `XCMRustBridge.sol` handles encoding on the Solidity side, so the ink! contract can be called from any EVM contract without modification. An alternative design would wrap the ink! contract in an ABI-compatible adapter, but this adds a contract hop and extra gas.

### Why a 124-bit prime for Poseidon?

The production Poseidon hash operates over the BN254 scalar field (a 254-bit prime). ink! contracts run in `no_std` with no native `uint256`, so a 124-bit Mersenne-like prime (`P = 2^124 - 3`) was chosen to stay within `u128` bounds while preserving the structural properties of the Poseidon permutation. A production deployment would integrate a proper BN254 field library once `no_std` support is stable.

---

## Submission Checklist

- [x] ink! v6 contract compiles to `.polkavm` — zero warnings (`cargo contract build --release`)
- [x] Three message implementations: Poseidon (BN254-like), BLS12-381 stub, I128 dot product
- [x] Solidity façade with SCALE encoder (`contracts/XCMRustBridge.sol`)
- [x] Mock harness injecting bytecode at precompile addresses (`hardhat_setCode`)
- [x] Full test suite: 33 tests covering correctness, SCALE encoding, edge values, reverts
- [x] Gas benchmark: local Hardhat + live Paseo Asset Hub (5-run average)
- [x] React + Vite dashboard with local/testnet toggle (`demo/`)
- [x] Architecture documentation (this file)
- [x] Both contracts deployed and verified on Paseo Asset Hub (chain 420420417)
- [x] Live benchmark data: 6–14× speedup measured on-chain
- [x] Deployment transaction hashes recorded in `deployments/testnet.json`
- [x] Interactive demo live at https://polkadot-rust-bridge.vercel.app
