.PHONY: build test check clean

## Compile the contract to WASM and generate the .contract bundle.
## Requires: cargo install cargo-contract --version "^4"
##           rustup component add rust-src
build:
	cargo contract build --release

## Run all #[ink::test] unit tests via the standard Rust test runner.
## Does NOT require the PolkaVM / WASM toolchain.
test:
	cargo test

## Typecheck the contract without producing a WASM artefact.
## Faster than `build`; useful in CI.
check:
	cargo contract check

## Remove build artefacts.
clean:
	cargo clean
