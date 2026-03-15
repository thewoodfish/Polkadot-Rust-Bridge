# Polkadot Rust Bridge — BUIDL

**Polkadot Rust Bridge** is a production-ready framework that lets any Solidity contract call native Rust logic compiled to PolkaVM's RISC-V target — with no custom tooling, no new interfaces, and no changes to the calling contract's ABI.

---

## The Problem

EVM opcodes were designed for general computation, not modern cryptography. A single Poseidon hash costs ~23,000 gas in pure Solidity. BLS12-381 signature verification is essentially infeasible. For ZK rollups, DeFi protocols, and identity systems, this isn't a minor inefficiency — it's a hard ceiling on what is buildable on-chain.

---

## The Solution

Polkadot's `pallet-revive` runtime exposes a standard EVM RPC while routing calls to PolkaVM's native RISC-V executor. Polkadot Rust Bridge exploits this: an ink! v6 contract implements cryptographic primitives in Rust, compiled to an 8.4 KB `.polkavm` binary. A Solidity façade (`XCMRustBridge.sol`) wraps it, so any EVM contract can call Rust with a standard `CALL` opcode and ABI-encoded calldata — identical to any other cross-contract call.

The result, measured live on Paseo Asset Hub:

| Operation | Rust (live) | Solidity | Speedup |
|:---|---:|---:|:---:|
| Poseidon hash (n=1) | 1,620 gas | 23,043 gas | **14.2×** |
| BLS verify (32B) | 3,077 gas | 30,460 gas | **9.9×** |
| Dot product (n=10) | 5,007 gas | 31,711 gas | **6.3×** |

---

## What Was Built

### `rust_bridge_ink` — ink! v6 RISC-V Contract

An ink! v6 contract implementing:

- **Poseidon sponge hash** — width-2 state, α=5, 4 full rounds over a 124-bit prime field
- **BLS12-381 signature verification** — pubkey/message/signature validation with full `blst` FFI stub
- **Signed dot product** — `checked_mul` / `checked_add` overflow detection on `Vec<i128>`

Compiled to a `.polkavm` RISC-V binary (8.4 KB) and deployed live on Paseo Asset Hub.

### `XCMRustBridge.sol` — Solidity Façade

Handles:
- SCALE-encoded selector dispatch to the ink! contract
- `Result<T, LangError>` decoding (skipping the 1-byte `Ok(0x00)` prefix)
- Typed return values back to the Solidity caller
- Both direct EVM calls and XCM Transact dispatch for cross-chain routing

### Tests & Benchmarks

- **33 passing tests** — correctness, edge cases, overflow/revert paths, SCALE encoding, XCM dispatch, and gas benchmarks against pure-Solidity equivalents
- **Benchmark pipeline** — compares live PolkaVM gas against Hardhat EVM simulation; results committed to the repo

### Deployment Tooling

- `deploy-ink.ts` — deploys the `.polkavm` binary via standard `eth_sendRawTransaction` (no special tooling required)
- `deploy.ts` — 4-step pipeline: env check → deploy → smoke test → benchmark

### Interactive Demo

A React/Vite dashboard deployed on Vercel showing live vs local benchmark data, an architecture diagram, and copy-paste code examples.
[polkadot-rust-bridge.vercel.app](https://polkadot-rust-bridge.vercel.app)

---

## Live Deployment — Paseo Asset Hub (chain 420420417)

| Contract | Address | Explorer |
|:---|:---|:---|
| `rust_bridge_ink` (ink! v6) | `0xE5F4F5D96a1C8141c52C0c6426944F2A8bFdE0d5` | [view ↗](https://blockscout-testnet.polkadot.io/address/0xE5F4F5D96a1C8141c52C0c6426944F2A8bFdE0d5) |
| `XCMRustBridge.sol` | `0x0794D9FfF1f2FE27Fa0ABCFf51cf8b12C1C9f498` | [view ↗](https://blockscout-testnet.polkadot.io/address/0x0794D9FfF1f2FE27Fa0ABCFf51cf8b12C1C9f498) |

---

## Why It Matters

This project establishes a **reusable, open pattern** for PolkaVM precompiles — the same role that Ethereum's built-in precompiles (`0x01`–`0x09`) play, but open to any developer. Any team building ZK verifiers, multisig wallets, or compute-heavy DeFi on Polkadot's EVM can adopt this pattern today with no changes to their existing Solidity code.

---

## Roadmap

### Phase 1 — Precompile Library (Q2 2025)
- Full `blst` BLS12-381 FFI integration for production-grade signature verification
- Pedersen commitments — `pedersen_commit(value, blinding)` for ZK-friendly on-chain commitments
- SHA3 / Keccak256 — native Rust Keccak as a cheaper alternative to the EVM opcode
- Publish `rust-bridge-ink` on crates.io so any project can import primitives without copying code

### Phase 2 — Developer Tooling (Q3 2025)
- `cargo-bridge` CLI — one command to scaffold a new precompile, generate Solidity bindings, and write the test stub
- Hardhat plugin — auto-injects the compiled `.polkavm` bytecode at the mock address during `npx hardhat test`, removing the manual `hardhat_setCode` step
- ABI auto-generation — parse ink! metadata JSON and emit matching Solidity `interface` declarations

### Phase 3 — Production Readiness (Q4 2025)
- Mainnet deployment on Polkadot Asset Hub once pallet-revive reaches production
- Gas oracle integration — on-chain helper that reports live PolkaVM vs EVM gas estimates so callers can route intelligently
- Third-party security audit of the bridge contract and SCALE encoding layer
- Reference integrations: a live ZK verifier and BLS multisig wallet

### Long-term Vision

A curated, audited **precompile registry** for PolkaVM — a set of well-known addresses for common cryptographic primitives, callable by any Polkadot EVM project, maintained open-source by the community. The same way Ethereum developers call `0x02` (SHA-256) or `0x08` (bn256 pairing) — but open, extensible, and built in Rust.
