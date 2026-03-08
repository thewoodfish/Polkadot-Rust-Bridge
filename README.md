# Polkadot Rust Bridge

**Call Rust precompiles from Solidity on Polkadot's PolkaVM runtime.**

![Solidity 0.8.24](https://img.shields.io/badge/Solidity-0.8.24-363636?logo=solidity)
![Rust 2021](https://img.shields.io/badge/Rust-2021_edition-f74c00?logo=rust)
![Polkadot Hub](https://img.shields.io/badge/Polkadot-Hub-E6007A?logo=polkadot)

Polkadot Rust Bridge demonstrates how Solidity contracts on `pallet-revive` can
delegate expensive cryptographic work to Rust code compiled for PolkaVM's
RISC-V execution engine. The Rust binary is registered at a well-known address;
contracts call it with standard ABI-encoded calldata and receive ABI-encoded
results—no custom tooling required on the Solidity side.

Three precompiles are implemented:

| Precompile | Address | Description |
|---|---|---|
| `poseidonHash` | `0x900` | Poseidon hash over BN254 scalar field (ZK-friendly) |
| `blsVerify` | `0x901` | BLS12-381 signature verification via `blst` |
| `dotProduct` | `0x902` | Signed 256-bit dot product with overflow detection |

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Compile Solidity contracts
npm run compile

# 3. Run the full test suite (21 tests)
npm test
```

Run the gas benchmark (averages 10 iterations, writes `benchmark-results.json`):

```bash
npm run benchmark
```

Build and preview the benchmark dashboard:

```bash
cd demo && npm install && npm run dev
```

Build the Rust precompile (requires the PolkaVM RISC-V target):

```bash
cd precompiles
rustup target add riscv32em-unknown-none-elf
cargo build --release --target riscv32em-unknown-none-elf
```

---

## Project Structure

```
├── contracts/
│   ├── RustBridge.sol          # Solidity façade + benchmark reference
│   └── mocks/MockPrecompile.sol# Mock precompile for local testing
├── precompiles/
│   └── rust-bridge/
│       └── src/
│           ├── lib.rs          # extern "C" entry point + selector dispatch
│           ├── abi.rs          # ABI encode/decode helpers, I256 arithmetic
│           └── handlers/       # poseidon.rs, bls.rs, dot_product.rs
├── tests/
│   ├── helpers/deployMocks.ts  # hardhat_setCode injection at 0x900-0x902
│   ├── RustBridge.test.ts      # 21-test correctness + revert suite
│   └── Benchmark.test.ts       # gas comparison tests
├── scripts/
│   └── benchmark.ts            # standalone benchmark script
├── demo/                       # React + Vite benchmark dashboard
├── docs/
│   └── ARCHITECTURE.md         # full architecture documentation
└── benchmark-results.json      # latest benchmark output
```

---

## Benchmark Results

Gas figures measured on local Hardhat network (10-run average).
On a live PolkaVM node, Rust precompiles execute native RISC-V at significantly
lower per-operation cost; real speedups for cryptographic workloads are expected
to reach **5–50×**.

| Operation | Rust gas | Solidity gas | Speedup |
|---|---|---|---|
| `poseidonHash(n=1)` | 4,726 | 23,043 | 4.9× |
| `poseidonHash(n=10)` | 6,257 | 25,780 | 4.1× |
| `blsVerify(32B msg)` | 5,329 | 30,460 | 5.7× |
| `blsVerify(1kB msg)` | 5,709 | 69,960 | 12.3× |
| `dotProduct(n=100)` | 60,867 | 106,044 | 1.7× |

> Full results: [`benchmark-results.json`](./benchmark-results.json)
> Interactive chart: run `cd demo && npm run dev`

---

## Live Deployment

> Deploy status updates here after `npm run deploy` runs against Westend Asset Hub.

| Contract | Network | Address |
|---|---|---|
| `XCMRustBridge.sol` | Polkadot Hub Testnet | _(not yet deployed)_ |
| `rust_bridge_ink` | Polkadot Hub Testnet | _(not yet deployed)_ |

Explorer: [asset-hub-westend.subscan.io](https://asset-hub-westend.subscan.io) · Chain ID: `420420421`

---

## Run It Yourself (judges: ~3 minutes, no testnet needed)

### Prerequisites
- Node.js ≥ 20, npm
- Rust + `cargo contract` (only needed to rebuild the ink! Wasm — pre-built bundle included)

```bash
# 1. Clone and install
git clone https://github.com/thewoodfish/Polkadot-Rust-Bridge
cd Polkadot-Rust-Bridge
npm install

# 2. Run the full test suite (33 tests, ~1 second)
npm test

# 3. Run the gas benchmark against local Hardhat EVM
npm run benchmark
# Prints a table: Rust precompile gas vs pure Solidity gas, with speedups

# 4. Launch the interactive benchmark dashboard
cd demo && npm install && npm run dev
# Open http://localhost:5173
```

The benchmark and dashboard work **entirely locally** — no wallet, no testnet tokens, no `.env` setup required.

### What you'll see
- `npm test` — 33 passing tests covering Solidity contracts, SCALE encoding, XCM dispatch logic, and Poseidon hash correctness
- `npm run benchmark` — gas comparison table: Rust precompile 3–12× cheaper than equivalent Solidity
- Dashboard — interactive bar chart, operation table, architecture diagram, and code examples

### Rebuilding the ink! contract (optional)
The pre-built `.contract` bundle is committed at `precompiles/ink-bundle/`.
To rebuild from source (requires `cargo-contract` ≥ 5 and `nightly-2025-06-01`):
```bash
cd precompiles/rust_bridge_ink
cargo contract build --release
```

---

## Documentation

- [Architecture & design decisions](./docs/ARCHITECTURE.md)
  - How Solidity → PVM → Rust works (with annotated diagram)
  - How to add a new precompile (step-by-step)
  - Benchmark methodology explained
  - Polkadot Hub / Westend deployment notes

---

## Team / Submission

<!-- Replace with your details before submitting -->

| Field | Value |
|---|---|
| Team name | _your team name_ |
| Track | Polkadot PolkaVM / Smart Contracts |
| Repo | https://github.com/thewoodfish/Polkadot-Rust-Bridge |
| Demo | _hosted URL or `npm run dev` locally_ |
| Contact | _email or Telegram_ |

---

## License

MIT — see [LICENSE](./LICENSE).
