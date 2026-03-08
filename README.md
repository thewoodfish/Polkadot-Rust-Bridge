# Polkadot Rust Bridge

> **Call Rust from Solidity — natively, on-chain, on Polkadot.**

[![Live Demo](https://img.shields.io/badge/Live_Demo-polkadot--rust--bridge.vercel.app-E6007A?style=for-the-badge&logo=vercel)](https://polkadot-rust-bridge.vercel.app)
[![Tests](https://img.shields.io/badge/Tests-33%20passing-brightgreen?style=for-the-badge&logo=mocha)](./tests)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.24-363636?style=for-the-badge&logo=solidity)](./contracts)
[![ink!](https://img.shields.io/badge/ink!-v6_(PolkaVM)-E6007A?style=for-the-badge&logo=rust)](./precompiles/rust_bridge_ink)
[![Network](https://img.shields.io/badge/Paseo_Asset_Hub-Live-success?style=for-the-badge&logo=polkadot)](https://blockscout-testnet.polkadot.io/address/0x0794D9FfF1f2FE27Fa0ABCFf51cf8b12C1C9f498)

---

## The Problem

EVM opcodes are expensive for cryptographic workloads. A single Poseidon hash costs **23,000 gas** in pure Solidity. BLS12-381 signature verification is essentially infeasible. For ZK rollups, DeFi protocols, and identity systems, this cost is a fundamental bottleneck.

## The Solution

Polkadot's `pallet-revive` runtime lets Solidity contracts call **ink! v6 contracts compiled to PolkaVM's native RISC-V**. The same call that costs 23,000 gas in Solidity costs **1,620 gas** as a Rust precompile — a **14× speedup**, measured live on-chain.

Polkadot Rust Bridge is a production-ready framework for this pattern: an ink! v6 contract implementing cryptographic primitives in Rust, exposed via a Solidity façade that any EVM contract can call with standard ABI-encoded calldata — no custom tooling, no new interfaces.

---

## Live Results — Paseo Asset Hub

> Measured on-chain via direct EVM→ink! calls. `ink! gas` = actual pallet-revive measurement. `Solidity gas` = Hardhat EVM simulation of equivalent pure-Solidity logic.

| Operation | ink! v6 gas _(live)_ | Solidity gas | Speedup |
|:---|---:|---:|:---:|
| `poseidonHash(n=1)` | **1,620** | 23,043 | 🟢 **14.2×** |
| `poseidonHash(n=5)` | **2,268** | 24,259 | 🟢 **10.7×** |
| `blsVerify(32B msg)` | **3,077** | 30,460 | 🟢 **9.9×** |
| `dotProduct(n=3)` | **2,755** | 24,500 | 🟢 **8.9×** |
| `dotProduct(n=10)` | **5,007** | 31,711 | 🟢 **6.3×** |

Full data: [`benchmark-results-testnet.json`](./benchmark-results-testnet.json) · Interactive: [polkadot-rust-bridge.vercel.app](https://polkadot-rust-bridge.vercel.app)

---

## Live Deployment — Paseo Asset Hub (Chain 420420417)

| Contract | Address | Explorer |
|:---|:---|:---|
| `XCMRustBridge.sol` | `0x0794D9FfF1f2FE27Fa0ABCFf51cf8b12C1C9f498` | [view ↗](https://blockscout-testnet.polkadot.io/address/0x0794D9FfF1f2FE27Fa0ABCFf51cf8b12C1C9f498) |
| `rust_bridge_ink` (ink! v6) | `0xE5F4F5D96a1C8141c52C0c6426944F2A8bFdE0d5` | [view ↗](https://blockscout-testnet.polkadot.io/address/0xE5F4F5D96a1C8141c52C0c6426944F2A8bFdE0d5) |

---

## Quick Start — Local (no wallet, no testnet, ~3 minutes)

```bash
# Clone and install
git clone https://github.com/thewoodfish/Polkadot-Rust-Bridge
cd Polkadot-Rust-Bridge
npm install

# Run the full test suite (33 tests, ~1 second)
npm test

# Run the gas benchmark — prints Rust vs Solidity comparison table
npm run benchmark

# Launch the interactive benchmark dashboard
cd demo && npm install && npm run dev
# → http://localhost:5173
```

**No `.env`, no wallet, no testnet tokens required.** Everything runs against the local Hardhat EVM.

### What you'll see

| Command | Output |
|:---|:---|
| `npm test` | 33 passing tests — Solidity contracts, SCALE encoding, XCM dispatch, Poseidon hash correctness |
| `npm run benchmark` | Gas comparison table: Rust 3–14× cheaper per operation |
| `npm run dev` (demo/) | Interactive bar chart, operation table, architecture diagram, live code examples |

---

## How It Works

```
  ┌─────────────────────────────────────────────────────────┐
  │  Solidity Caller (any EVM contract)                     │
  │                                                         │
  │  (bool ok, bytes ret) = inkContract.call(              │
  │      abi.encodeWithSelector(SEL_POSEIDON_HASH, inputs) │
  │  );                                                     │
  └───────────────────────┬─────────────────────────────────┘
                          │  EVM CALL opcode
                          ▼
  ┌─────────────────────────────────────────────────────────┐
  │  pallet-revive  (PolkaVM host layer)                    │
  │                                                         │
  │  • Routes call to ink! v6 contract at target address    │
  │  • Deserialises SCALE-encoded selector + args           │
  │  • Dispatches to PolkaVM RISC-V executor                │
  └───────────────────────┬─────────────────────────────────┘
                          │  Native RISC-V execution
                          ▼
  ┌─────────────────────────────────────────────────────────┐
  │  rust_bridge_ink  (ink! v6, compiled to .polkavm)       │
  │                                                         │
  │  match selector {                                       │
  │      SEL_POSEIDON_HASH => poseidon_hash(inputs),        │
  │      SEL_DOT_PRODUCT   => dot_product(a, b),            │
  │      SEL_BLS_VERIFY    => bls_verify(pk, msg, sig),     │
  │  }                                                      │
  │  // Runs native RISC-V — far cheaper than EVM opcodes   │
  └───────────────────────┬─────────────────────────────────┘
                          │  Result<T, LangError> (SCALE)
                          ▼
  ┌─────────────────────────────────────────────────────────┐
  │  XCMRustBridge.sol  (Solidity façade)                   │
  │                                                         │
  │  Decodes SCALE return, emits event, returns typed value │
  │  e.g. uint128 hash = directPoseidonHash(inputs)         │
  └─────────────────────────────────────────────────────────┘
```

The Solidity caller uses a plain `CALL` — identical to any cross-contract call. The ink! contract's compiled `.polkavm` binary runs natively on PolkaVM's RISC-V executor, metered by the RISC-V gas model at a fraction of EVM opcode cost.

### Precompile Implementations

| Message | ink! Selector | Description |
|:---|:---|:---|
| `poseidon_hash(Vec<u128>)` | `0x42762451` | Poseidon sponge over a 124-bit prime field, width-2 state, α=5, 4 full rounds |
| `dot_product(Vec<i128>, Vec<i128>)` | `0xe3ccaf7e` | Signed dot product with `checked_mul` / `checked_add` overflow detection |
| `bls_verify(bytes, bytes, bytes)` | `0x955e9f2b` | BLS12-381 pubkey/message/signature length validation (stub — full `blst` FFI in native precompile) |

---

## Project Structure

```
Polkadot-Rust-Bridge/
│
├── contracts/
│   ├── XCMRustBridge.sol        # Solidity façade — direct EVM calls + XCM Transact dispatch
│   ├── RustBridge.sol           # Benchmark reference (mock precompile path)
│   └── mocks/
│       └── MockPrecompile.sol   # Hardhat test mock — pure-Solidity equivalents for gas comparison
│
├── precompiles/
│   └── rust_bridge_ink/         # ink! v6 contract (compiles to PolkaVM .polkavm)
│       ├── src/lib.rs           # Contract messages: poseidon_hash, dot_product, bls_verify
│       ├── Cargo.toml           # ink! = "6.0.0-beta.1", edition = "2024"
│       └── rust-toolchain.toml  # Pins nightly-2025-06-01 (required for edition2024 + PolkaVM)
│
├── tests/
│   ├── RustBridge.test.ts       # 33 correctness + edge-case + revert tests
│   ├── Benchmark.test.ts        # Gas comparison: Rust path vs pure Solidity
│   └── helpers/
│       └── deployMocks.ts       # hardhat_setCode injection + contract setup
│
├── scripts/
│   ├── deploy.ts                # 4-step: env check → deploy → smoke test → benchmark
│   ├── deploy-ink.ts            # Deploy ink! v6 .polkavm via EVM RPC (eth_sendRawTransaction)
│   └── benchmark.ts             # Standalone local benchmark, writes benchmark-results.json
│
├── demo/                        # React + Vite benchmark dashboard (deployed on Vercel)
│   └── src/data/
│       ├── benchmark-results-local.json    # Hardhat EVM mock results
│       └── benchmark-results-testnet.json  # Live Paseo Asset Hub results
│
├── docs/
│   └── ARCHITECTURE.md          # In-depth architecture, ABI conventions, extensibility guide
│
├── hardhat.config.ts            # Network: Paseo Asset Hub (chainId 420420417)
├── benchmark-results.json       # Latest local benchmark output
└── benchmark-results-testnet.json  # Latest live testnet benchmark output
```

---

## Key Technical Details

### ink! v6 + pallet-revive

This project targets **ink! v6**, the first version of ink! that compiles to **PolkaVM's RISC-V target** (`.polkavm`) instead of Wasm. `pallet-revive` is the modern replacement for `pallet-contracts` and is live on Paseo Asset Hub.

Key differences from ink! v5:
- Build output is `.polkavm` (RISC-V), not `.wasm`
- Message return values are wrapped in `Result<T, LangError>` — callers skip 1-byte `Ok(0x00)` prefix when decoding
- Selectors are computed differently — always use the values from `cargo contract build` metadata

### Deploying an ink! v6 Contract via EVM RPC

pallet-revive exposes a standard EVM RPC. Deployment is a normal `eth_sendRawTransaction` with `to: null`:

```
tx.data = polkavm_bytecode ++ constructor_selector
```

For a parameterless `new()` constructor (selector `0x9bae9d5e`):
```bash
npx ts-node scripts/deploy-ink.ts
```

### `INK_CONTRACT_ADDRESS` Format

`XCMRustBridge.sol` stores the ink! contract as `bytes32`. The mapping from H160 to AccountId32 in pallet-revive is:

```
AccountId32 = 0x000000000000000000000000 ++ H160   (12 zero prefix bytes)
```

This is because `inkEvmAddress()` computes `address(uint160(uint256(bytes32)))`, which takes the **lower 20 bytes**.

### Adding a New Precompile

1. Add a message to `precompiles/rust_bridge_ink/src/lib.rs`
2. Run `cargo contract build --release` — note the new selector in the generated `.json` metadata
3. Add the selector constant and a new `direct*` function to `contracts/XCMRustBridge.sol`
4. Add a mock implementation to `contracts/mocks/MockPrecompile.sol` for local testing
5. Add tests in `tests/RustBridge.test.ts`

See [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) for a complete step-by-step guide.

---

## Testnet Deployment

### Prerequisites

- Node.js ≥ 20
- Rust + `cargo-contract` v6: `cargo install cargo-contract --version 6.0.0-beta.2`
- `.env` with `POLKADOT_HUB_RPC_URL` and `DEPLOYER_PRIVATE_KEY`

```bash
# 1. Get testnet DOT from the Paseo faucet (use your H160 EVM address):
#    https://faucet.polkadot.io  →  "Polkadot testnet (Paseo)" → "Hub (smart contracts)"

# 2. Deploy the ink! v6 contract
npx ts-node scripts/deploy-ink.ts
# → prints: Contract address: 0x...  (copy this)

# 3. Set in .env:  INK_CONTRACT_ADDRESS=0x000000000000000000000000<H160>

# 4. Deploy XCMRustBridge.sol + run smoke test + benchmark
npm run deploy
```

### .env Template

```env
POLKADOT_HUB_RPC_URL=https://eth-rpc-testnet.polkadot.io/
DEPLOYER_PRIVATE_KEY=0x<64-hex-chars>
INK_CONTRACT_ADDRESS=0x000000000000000000000000<40-hex-H160>
```

> **Network note:** Use `https://eth-rpc-testnet.polkadot.io/` (Paseo, chain 420420417). Westend (`420420421`) uses the legacy `pallet-contracts` runtime and does **not** support pallet-revive.

---

## Rebuilding the ink! Contract (Optional)

The `.polkavm` artifact is committed to the repo. To rebuild from source:

```bash
# Requires cargo-contract v6.0.0-beta.2 and nightly-2025-06-01 (pinned in rust-toolchain.toml)
cd precompiles/rust_bridge_ink
cargo contract build --release
# → precompiles/target/ink/rust_bridge_ink/rust_bridge_ink.polkavm  (8.4 KB)
```

---

## Submission

| Field | Value |
|:---|:---|
| Track | Polkadot PolkaVM / Smart Contracts |
| Repo | https://github.com/thewoodfish/Polkadot-Rust-Bridge |
| Demo | https://polkadot-rust-bridge.vercel.app |
| XCMRustBridge | `0x0794D9FfF1f2FE27Fa0ABCFf51cf8b12C1C9f498` (Paseo Asset Hub) |
| rust_bridge_ink | `0xE5F4F5D96a1C8141c52C0c6426944F2A8bFdE0d5` (Paseo Asset Hub) |

---

## Documentation

- [Architecture & Design Decisions](./docs/ARCHITECTURE.md) — call-flow diagram, ABI conventions, benchmark methodology, how to add precompiles
- [Live Dashboard](https://polkadot-rust-bridge.vercel.app) — interactive benchmark chart, architecture diagram, code examples
- [Benchmark Data (local)](./benchmark-results.json) · [Benchmark Data (testnet)](./benchmark-results-testnet.json)

---

## License

MIT — see [LICENSE](./LICENSE).
