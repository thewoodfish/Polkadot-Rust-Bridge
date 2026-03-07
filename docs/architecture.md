# Architecture: Polkadot Rust Bridge

## Overview

This project demonstrates calling Rust logic compiled to **PolkaVM** bytecode
from Solidity smart contracts deployed on a Polkadot parachain (e.g. Asset Hub
or a custom parachain using `pallet-revive`).

```
┌──────────────────────────────────────────────────────────┐
│  Solidity contract (RustBridge.sol)                      │
│   • Holds precompile address                             │
│   • Dispatches ABI-encoded calldata via low-level call   │
└──────────────┬───────────────────────────────────────────┘
               │  CALL(precompileAddress, data)
               ▼
┌──────────────────────────────────────────────────────────┐
│  PolkaVM host (pallet-revive)                            │
│   • Intercepts call to registered precompile address     │
│   • Passes raw input bytes to Rust module                │
└──────────────┬───────────────────────────────────────────┘
               │  extern "C" call(input, input_len, …)
               ▼
┌──────────────────────────────────────────────────────────┐
│  rust-bridge (PolkaVM WASM/RISC-V blob)                  │
│   • Selector-based dispatch                              │
│   • fibonacci, hash_chain, …                             │
│   • Returns ABI-encoded result                           │
└──────────────────────────────────────────────────────────┘
```

## Components

| Path | Description |
|------|-------------|
| `contracts/RustBridge.sol` | Solidity façade; wraps precompile calls and exposes a Solidity-only reference implementation for benchmarking |
| `precompiles/rust-bridge/` | `no_std` Rust crate compiled to PolkaVM target; implements the same functions in Rust |
| `tests/` | Hardhat TypeScript tests (unit + gas benchmarks) |
| `demo/` | React app visualising gas savings from benchmark output |
| `docs/` | This file and additional writeups |

## ABI Convention

The precompile uses the standard **Solidity ABI** encoding:

- **Input**: 4-byte function selector followed by ABI-encoded arguments.
- **Output**: ABI-encoded return values (no selector prefix).

Selectors are derived from the keccak-256 of the function signature, identical
to how Solidity computes them. This allows the same calldata produced by
`ethers.js` or Solidity to be understood by the Rust dispatcher.

## Building the Precompile

```bash
cd precompiles
cargo build --release --target riscv32em-unknown-none-elf
# or for PolkaVM WASM target once toolchain support lands:
# cargo build --release --target wasm32-unknown-unknown
```

## Running Benchmarks

```bash
npm install
npm run compile
npm run benchmark
```

The benchmark script (`tests/benchmark.ts`) measures on-chain gas for the
Solidity reference implementation. Once the precompile is deployed on a live
network the same harness can be pointed at it to compare gas figures.

## Gas Savings (estimated)

PolkaVM executes native RISC-V instructions metered by a separate gas model
that is significantly cheaper for computation-heavy workloads compared to the
EVM opcode pricing. Expected savings for iterative algorithms: **60-80 %**.
