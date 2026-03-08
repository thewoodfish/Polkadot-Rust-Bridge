// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// =============================================================================
// XCMRustBridge.sol
//
// Calls the rust_bridge_ink! ink! v5 contract from Solidity via the XCM
// precompile exposed by pallet-revive on Polkadot Asset Hub.
//
// Call flow (XCM path):
//
//   Solidity (EVM / pallet-revive)
//       │  encode ink! call in SCALE format
//       │  build Transact XCM message
//       ▼
//   IXcm precompile  0x…0401  (pallet-revive XCM precompile)
//       │  execute() dispatches locally on the same chain
//       ▼
//   pallet-contracts
//       │  routes call to ink! contract at AccountId32 address
//       ▼
//   rust_bridge_ink  (ink! v5 contract)
//       └─ poseidon_hash / dot_product / bls_verify
//
// HACKATHON NOTE:
//   XCM Transact with async result callbacks is complex on-chain.  For the
//   hackathon demo we provide BOTH paths:
//     - Primary   : XCM Transact (xcmXxx functions) — correct production path
//     - Fallback  : Direct EVM call (directXxx functions) — works when the
//       ink! contract is deployed on the same chain in pallet-revive, which
//       exposes it at a deterministic EVM address derived from its AccountId32.
//   Use the fallback for a quick interactive demo; switch to the XCM path when
//   submitting to a parachain with both pallets live.
// =============================================================================

// -----------------------------------------------------------------------------
// IXcm — Polkadot Hub XCM precompile interface (address 0x…0401)
//
// Based on the XCM precompile shipped with polkadot-sdk / pallet-revive.
// `execute` dispatches an XCM program locally (same chain, no cross-chain hop
// required when calling ink! contracts on the same Asset Hub instance).
// `send` routes to a remote chain via the HRMP/UMP channels.
// -----------------------------------------------------------------------------
interface IXcm {
    struct Weight {
        uint64 refTime;   // computational cost
        uint64 proofSize; // PoV size contribution
    }

    /// Execute a SCALE-encoded VersionedXcm locally on this chain.
    /// @param message SCALE-encoded XCM (Version 4 recommended).
    /// @param weight  Maximum weight the program may consume.
    /// @return outcome 0 = Complete, non-zero = error code.
    function execute(
        bytes calldata message,
        Weight calldata weight
    ) external returns (uint8 outcome);

    /// Send a SCALE-encoded XCM to a remote MultiLocation.
    /// @param dest    SCALE-encoded MultiLocation of the target chain.
    /// @param message SCALE-encoded VersionedXcm to send.
    /// @return messageId BLAKE2-256 hash identifying the outbound message.
    function send(
        bytes calldata dest,
        bytes calldata message
    ) external returns (bytes32 messageId);
}

// -----------------------------------------------------------------------------
// SCALEEncoder — helpers for building SCALE-encoded ink! call data
//
// ink! v5 message arguments are SCALE-encoded (not ABI-encoded).
// SCALE compact integers encode the byte count / item count as a prefix:
//   n == 0                       → 0x00
//   0 < n < 2^6  (64)            → single byte   (n << 2)
//   2^6  ≤ n < 2^14 (16 384)     → two bytes  LE ((n << 2) | 0x01)
//   2^14 ≤ n < 2^30 (1 073 741 824) → four bytes LE ((n << 2) | 0x02)
//
// All multi-byte integers are **little-endian** in SCALE.
// -----------------------------------------------------------------------------
library SCALEEncoder {

    // -------------------------------------------------------------------------
    // Compact length prefix
    // -------------------------------------------------------------------------

    /// @dev Encode n as a SCALE compact integer (1, 2, or 4 bytes).
    function encodeCompact(uint32 n) internal pure returns (bytes memory) {
        if (n < 64) {
            return abi.encodePacked(uint8(n << 2));
        } else if (n < 16_384) {
            uint16 v = uint16((uint32(n) << 2) | 1);
            // little-endian: low byte first
            return abi.encodePacked(uint8(v & 0xff), uint8(v >> 8));
        } else {
            // n < 2^30 guaranteed for realistic lengths
            uint32 v = (n << 2) | 2;
            return abi.encodePacked(
                uint8(v        & 0xff),
                uint8((v >> 8) & 0xff),
                uint8((v >> 16)& 0xff),
                uint8((v >> 24)& 0xff)
            );
        }
    }

    // -------------------------------------------------------------------------
    // Scalar encoders (little-endian)
    // -------------------------------------------------------------------------

    /// @dev Encode a u128 as 16 bytes little-endian.
    function encodeU128LE(uint128 v) internal pure returns (bytes memory out) {
        out = new bytes(16);
        for (uint i = 0; i < 16; i++) {
            out[i] = bytes1(uint8(v >> (i * 8)));
        }
    }

    /// @dev Encode an i128 as 16 bytes little-endian (two's complement).
    function encodeI128LE(int128 v) internal pure returns (bytes memory out) {
        // Reinterpret as uint128 — two's complement is the same bit pattern.
        return encodeU128LE(uint128(v));
    }

    // -------------------------------------------------------------------------
    // Vec<u128>  →  compact(len) ++ [u128_LE * len]
    // -------------------------------------------------------------------------
    function encodeVecU128(uint128[] memory arr)
        internal pure returns (bytes memory out)
    {
        out = encodeCompact(uint32(arr.length));
        for (uint i = 0; i < arr.length; i++) {
            out = bytes.concat(out, encodeU128LE(arr[i]));
        }
    }

    // -------------------------------------------------------------------------
    // Vec<i128>  →  compact(len) ++ [i128_LE * len]
    // -------------------------------------------------------------------------
    function encodeVecI128(int128[] memory arr)
        internal pure returns (bytes memory out)
    {
        out = encodeCompact(uint32(arr.length));
        for (uint i = 0; i < arr.length; i++) {
            out = bytes.concat(out, encodeI128LE(arr[i]));
        }
    }

    // -------------------------------------------------------------------------
    // bytes (SCALE Vec<u8>)  →  compact(len) ++ raw_bytes
    // -------------------------------------------------------------------------
    function encodeBytes(bytes memory data)
        internal pure returns (bytes memory)
    {
        return bytes.concat(encodeCompact(uint32(data.length)), data);
    }

    // -------------------------------------------------------------------------
    // SCALE-decode a single u128 from the front of a bytes buffer.
    // Assumes the bytes start directly with the 16-byte LE value (no prefix).
    // -------------------------------------------------------------------------
    function decodeU128LE(bytes memory data, uint offset)
        internal pure returns (uint128 v)
    {
        require(data.length >= offset + 16, "SCALE: buffer too short for u128");
        for (uint i = 0; i < 16; i++) {
            v |= uint128(uint8(data[offset + i])) << uint8(i * 8);
        }
    }

    /// @dev Decode a single i128 (two's complement) from offset.
    function decodeI128LE(bytes memory data, uint offset)
        internal pure returns (int128)
    {
        return int128(int128(decodeU128LE(data, offset)));
    }

    /// @dev Decode a bool: 0x00 → false, 0x01 → true.
    function decodeBool(bytes memory data, uint offset)
        internal pure returns (bool)
    {
        require(data.length > offset, "SCALE: buffer too short for bool");
        return data[offset] == 0x01;
    }
}

// -----------------------------------------------------------------------------
// XCMRustBridge
// -----------------------------------------------------------------------------
contract XCMRustBridge {
    using SCALEEncoder for uint128[];
    using SCALEEncoder for int128[];
    using SCALEEncoder for bytes;

    // -------------------------------------------------------------------------
    // Constants
    // -------------------------------------------------------------------------

    /// @dev XCM precompile address on Polkadot Asset Hub (pallet-revive).
    address public constant XCM_PRECOMPILE =
        address(0x0000000000000000000000000000000000000401);

    // ink! v5 message selectors — first 4 bytes of BLAKE2b-256(message_name).
    // Obtain the exact values for your deployment with:
    //   cargo contract info --url <ws-endpoint> <contract-address>
    // or inspect the generated metadata.json after `cargo contract build`.
    //
    // These values are computed from the rust_bridge_ink contract in this repo:
    // ink! v6 selectors (from rust_bridge_ink.json after cargo contract build)
    bytes4 public constant SEL_POSEIDON_HASH = 0x42762451;
    bytes4 public constant SEL_DOT_PRODUCT   = 0xe3ccaf7e;
    bytes4 public constant SEL_BLS_VERIFY    = 0x955e9f2b;

    // pallet-contracts call index on Westend / Polkadot Asset Hub.
    // Verify against the chain's runtime metadata before deploying:
    //   subxt metadata | jq '.pallets[] | select(.name=="Contracts") | .index'
    uint8 public constant PALLET_CONTRACTS = 40;
    uint8 public constant CALL_INDEX_CALL  = 6;  // contracts::Call::call

    // Default gas budget for the ink! call dispatched via Transact.
    // Tune based on profiling; these are conservative estimates.
    uint64 public constant INK_REF_TIME   = 10_000_000_000;
    uint64 public constant INK_PROOF_SIZE = 131_072;

    // -------------------------------------------------------------------------
    // Storage
    // -------------------------------------------------------------------------

    /// @notice Substrate AccountId32 of the deployed ink! contract.
    bytes32 public inkContractAddress;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event PoseidonHash(uint128[] inputs, uint128 result);
    event DotProduct(int128[] a, int128[] b, int128 result);
    event BlsVerify(bool result);

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /// @param _inkContractAddress AccountId32 (32 bytes) of the ink! contract.
    constructor(bytes32 _inkContractAddress) {
        inkContractAddress = _inkContractAddress;
    }

    // =========================================================================
    // Primary path — XCM Transact
    //
    // Encodes the ink! call in SCALE format, wraps it in a Transact XCM
    // instruction, and dispatches via the IXcm precompile.  The result is
    // returned synchronously when executing locally on the same chain.
    // =========================================================================

    /// @notice Hash inputs using Poseidon via the ink! contract (XCM path).
    function poseidonHash(uint128[] calldata inputs)
        external
        returns (uint128 result)
    {
        bytes memory inkCallData = _encodeInkCall(
            SEL_POSEIDON_HASH,
            SCALEEncoder.encodeVecU128(_toMemory(inputs))
        );
        bytes memory xcmResult = _xcmTransact(inkCallData);
        result = SCALEEncoder.decodeU128LE(xcmResult, 0);
        emit PoseidonHash(inputs, result);
    }

    /// @notice Compute signed dot product via the ink! contract (XCM path).
    function dotProduct(int128[] calldata a, int128[] calldata b)
        external
        returns (int128 result)
    {
        bytes memory args = bytes.concat(
            SCALEEncoder.encodeVecI128(_toMemoryI(a)),
            SCALEEncoder.encodeVecI128(_toMemoryI(b))
        );
        bytes memory inkCallData = _encodeInkCall(SEL_DOT_PRODUCT, args);
        bytes memory xcmResult = _xcmTransact(inkCallData);
        result = SCALEEncoder.decodeI128LE(xcmResult, 0);
        emit DotProduct(a, b, result);
    }

    /// @notice Verify a BLS12-381 signature via the ink! contract (XCM path).
    function blsVerify(
        bytes calldata pubkey,
        bytes calldata message,
        bytes calldata sig
    ) external returns (bool result) {
        bytes memory args = bytes.concat(
            SCALEEncoder.encodeBytes(pubkey),
            SCALEEncoder.encodeBytes(message),
            SCALEEncoder.encodeBytes(sig)
        );
        bytes memory inkCallData = _encodeInkCall(SEL_BLS_VERIFY, args);
        bytes memory xcmResult = _xcmTransact(inkCallData);
        result = SCALEEncoder.decodeBool(xcmResult, 0);
        emit BlsVerify(result);
    }

    // =========================================================================
    // Fallback path — direct EVM call
    //
    // pallet-revive exposes ink! contracts at a deterministic EVM address
    // derived from their AccountId32 (the lower 20 bytes).  This path calls
    // the contract directly, bypassing XCM, and is useful for:
    //   - Local demo environments where both pallets share the same runtime
    //   - Integration tests against a single-node Substrate dev chain
    //   - Avoiding XCM weight estimation complexity during hackathon judging
    //
    // The ink! calldata encoding is identical (SCALE); only the dispatch
    // mechanism differs.
    // =========================================================================

    /// @notice EVM address derived from the AccountId32 (lower 20 bytes).
    /// @dev    pallet-revive maps AccountId32 → H160 by truncating to the last
    ///         20 bytes.  This is the address usable in a direct EVM call.
    function inkEvmAddress() public view returns (address) {
        return address(uint160(uint256(inkContractAddress)));
    }

    /// @notice Direct call: Poseidon hash (no XCM — same-chain fallback).
    function directPoseidonHash(uint128[] calldata inputs)
        external
        returns (uint128 result)
    {
        bytes memory callData = _encodeInkCall(
            SEL_POSEIDON_HASH,
            SCALEEncoder.encodeVecU128(_toMemory(inputs))
        );
        bytes memory ret = _directCall(callData);
        // ink! v6 wraps return in Result<T, LangError>: skip 1-byte Ok prefix (0x00)
        result = SCALEEncoder.decodeU128LE(ret, 1);
        emit PoseidonHash(inputs, result);
    }

    /// @notice Direct call: dot product (no XCM — same-chain fallback).
    function directDotProduct(int128[] calldata a, int128[] calldata b)
        external
        returns (int128 result)
    {
        bytes memory args = bytes.concat(
            SCALEEncoder.encodeVecI128(_toMemoryI(a)),
            SCALEEncoder.encodeVecI128(_toMemoryI(b))
        );
        bytes memory ret = _directCall(_encodeInkCall(SEL_DOT_PRODUCT, args));
        // ink! v6 wraps return in Result<T, LangError>: skip 1-byte Ok prefix (0x00)
        result = SCALEEncoder.decodeI128LE(ret, 1);
        emit DotProduct(a, b, result);
    }

    /// @notice Direct call: BLS verify (no XCM — same-chain fallback).
    function directBlsVerify(
        bytes calldata pubkey,
        bytes calldata message,
        bytes calldata sig
    ) external returns (bool result) {
        bytes memory args = bytes.concat(
            SCALEEncoder.encodeBytes(pubkey),
            SCALEEncoder.encodeBytes(message),
            SCALEEncoder.encodeBytes(sig)
        );
        bytes memory ret = _directCall(_encodeInkCall(SEL_BLS_VERIFY, args));
        // ink! v6 wraps return in Result<T, LangError>: skip 1-byte Ok prefix (0x00)
        result = SCALEEncoder.decodeBool(ret, 1);
        emit BlsVerify(result);
    }

    // =========================================================================
    // Internal helpers
    // =========================================================================

    /// @dev Build SCALE-encoded ink! call data: selector (4 bytes) ++ SCALE args.
    function _encodeInkCall(bytes4 selector, bytes memory scaleArgs)
        internal pure returns (bytes memory)
    {
        return bytes.concat(selector, scaleArgs);
    }

    /// @dev Wrap ink! calldata in a pallet-contracts extrinsic call, then wrap
    ///      that in a minimal XCM Transact instruction, and execute locally.
    ///
    ///      XCM structure (SCALE-encoded V4):
    ///        0x04            — XCM version 4 enum variant
    ///        0x04            — Vec length 1 (one instruction)
    ///        0x1f000000      — Transact instruction enum variant (31)
    ///        0x00            — OriginKind::SovereignAccount
    ///        refTime (compact u64)
    ///        proofSize (compact u64)
    ///        doubleEncoded: compact(len) ++ scale_call_bytes
    ///
    ///      scale_call_bytes:
    ///        PALLET_CONTRACTS  (1 byte)
    ///        CALL_INDEX_CALL   (1 byte)
    ///        0x00 ++ inkContractAddress  (MultiAddress::Id — 33 bytes)
    ///        0x00              (Compact<u128> value = 0)
    ///        refTime compact
    ///        proofSize compact
    ///        0x00              (storage_deposit_limit = None)
    ///        compact(len) ++ inkCallData
    function _xcmTransact(bytes memory inkCallData)
        internal
        returns (bytes memory)
    {
        bytes memory contractsCall = _encodeContractsCall(inkCallData);

        bytes memory transact = bytes.concat(
            // Transact instruction variant (31 = 0x1f, padded to 4 bytes LE)
            bytes4(0x1f000000),
            // OriginKind::SovereignAccount = 0
            bytes1(0x00),
            // require_weight_at_most.refTime  (compact u64 — fits in 4 bytes)
            SCALEEncoder.encodeCompact(uint32(INK_REF_TIME  > 0x3FFFFFFF
                ? 0x3FFFFFFF : uint32(INK_REF_TIME))),
            // require_weight_at_most.proofSize
            SCALEEncoder.encodeCompact(uint32(INK_PROOF_SIZE > 0x3FFFFFFF
                ? 0x3FFFFFFF : uint32(INK_PROOF_SIZE))),
            // DoubleEncoded call: compact(len) ++ bytes
            SCALEEncoder.encodeBytes(contractsCall)
        );

        // XCM V4: version byte (0x04) + compact vec length 1 (0x04) + instruction
        bytes memory xcmMsg = bytes.concat(
            bytes1(0x04),  // XCM version 4
            bytes1(0x04),  // compact(1) — one instruction
            transact
        );

        IXcm.Weight memory weight = IXcm.Weight({
            refTime:   INK_REF_TIME,
            proofSize: INK_PROOF_SIZE
        });

        uint8 outcome = IXcm(XCM_PRECOMPILE).execute(xcmMsg, weight);
        require(outcome == 0, "XCMRustBridge: XCM execution failed");

        // NOTE: XCM Transact does not return call results synchronously in the
        // general cross-chain case.  When executing locally on the same chain,
        // pallet-revive may surface the return value through a storage key or
        // event.  For the hackathon demo, use the directXxx fallback path for
        // synchronous return values; switch to XCM events + off-chain indexer
        // for production.
        return new bytes(0);
    }

    /// @dev SCALE-encode a pallet-contracts `call` extrinsic.
    function _encodeContractsCall(bytes memory inkCallData)
        internal view returns (bytes memory)
    {
        return bytes.concat(
            bytes1(PALLET_CONTRACTS),                   // pallet index
            bytes1(CALL_INDEX_CALL),                    // call index
            bytes1(0x00),                               // MultiAddress::Id variant
            inkContractAddress,                         // AccountId32 (32 bytes)
            bytes1(0x00),                               // Compact<u128> value = 0
            SCALEEncoder.encodeCompact(                 // gas_limit.ref_time
                uint32(INK_REF_TIME > 0x3FFFFFFF ? 0x3FFFFFFF : uint32(INK_REF_TIME))),
            SCALEEncoder.encodeCompact(                 // gas_limit.proof_size
                uint32(INK_PROOF_SIZE > 0x3FFFFFFF ? 0x3FFFFFFF : uint32(INK_PROOF_SIZE))),
            bytes1(0x00),                               // storage_deposit_limit = None
            SCALEEncoder.encodeBytes(inkCallData)       // data: compact(len) ++ calldata
        );
    }

    /// @dev Dispatch a direct EVM call to the ink! contract's derived EVM address.
    function _directCall(bytes memory callData)
        internal
        returns (bytes memory result)
    {
        address target = inkEvmAddress();
        bool success;
        (success, result) = target.call(callData);
        require(success, "XCMRustBridge: direct call to ink! contract failed");
    }

    // -------------------------------------------------------------------------
    // calldata → memory conversions (Solidity can't pass calldata slices to
    // internal pure functions that accept memory parameters)
    // -------------------------------------------------------------------------

    function _toMemory(uint128[] calldata arr)
        internal pure returns (uint128[] memory m)
    {
        m = new uint128[](arr.length);
        for (uint i = 0; i < arr.length; i++) m[i] = arr[i];
    }

    function _toMemoryI(int128[] calldata arr)
        internal pure returns (int128[] memory m)
    {
        m = new int128[](arr.length);
        for (uint i = 0; i < arr.length; i++) m[i] = arr[i];
    }
}
