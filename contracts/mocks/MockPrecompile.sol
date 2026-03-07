// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MockPrecompile
/// @notice Stand-in for the three PolkaVM precompiles (0x900 / 0x901 / 0x902).
///
/// The same bytecode is injected at all three addresses via `hardhat_setCode`.
/// Dispatch is driven by the 4-byte Solidity ABI selector so the call path
/// through RustBridge.callPrecompile() is exercised end-to-end.
///
/// Selectors (keccak256 of the function signatures):
///   poseidonHash(uint256[])        → 0x2a58cd44
///   blsVerify(bytes,bytes,bytes)   → 0xa65ebb25
///   dotProduct(int256[],int256[])  → 0x55989ee5
contract MockPrecompile {

    // -------------------------------------------------------------------------
    // Fallback — routes all low-level calls made by RustBridge.callPrecompile()
    // -------------------------------------------------------------------------

    /// @dev New-style fallback (Solidity ≥ 0.7) receives raw calldata and
    ///      returns raw bytes, matching the low-level `.call(data)` ABI used
    ///      by the bridge contract.
    fallback(bytes calldata input) external returns (bytes memory output) {
        require(input.length >= 4, "MockPrecompile: calldata too short");

        bytes4 sel = bytes4(input[:4]);
        bytes calldata args = input[4:];

        if (sel == 0x2a58cd44) {
            output = _poseidonHash(args);
        } else if (sel == 0xa65ebb25) {
            output = _blsVerify(args);
        } else if (sel == 0x55989ee5) {
            output = _dotProduct(args);
        } else {
            revert("MockPrecompile: unknown selector");
        }
    }

    // -------------------------------------------------------------------------
    // poseidonHash(uint256[]) → uint256
    //
    // Stand-in: keccak256(abi.encodePacked(inputs)) cast to uint256.
    // Same input/output ABI shape as the real Poseidon precompile; the hash
    // value differs but all structural tests (array decode, uint256 encode)
    // are exercised correctly.
    // -------------------------------------------------------------------------
    function _poseidonHash(bytes calldata args)
        internal
        pure
        returns (bytes memory)
    {
        uint256[] memory inputs = abi.decode(args, (uint256[]));
        require(inputs.length > 0, "MockPrecompile: empty input");
        // Pack the array elements and keccak256-hash them as a Poseidon stand-in.
        bytes32 h = keccak256(abi.encodePacked(inputs));
        return abi.encode(uint256(h));
    }

    // -------------------------------------------------------------------------
    // blsVerify(bytes,bytes,bytes) → bool
    //
    // Stub: always returns true. The test harness exercises the full
    // encode/decode path; signature mathematics require a real BLS runtime.
    // -------------------------------------------------------------------------
    function _blsVerify(bytes calldata args)
        internal
        pure
        returns (bytes memory)
    {
        (bytes memory pubkey, , bytes memory sig) = abi.decode(
            args,
            (bytes, bytes, bytes)
        );
        require(pubkey.length == 48, "MockPrecompile: pubkey must be 48 bytes");
        require(sig.length == 96,    "MockPrecompile: signature must be 96 bytes");
        return abi.encode(true);
    }

    // -------------------------------------------------------------------------
    // dotProduct(int256[],int256[]) → int256
    //
    // Correct implementation. Solidity 0.8 checked arithmetic reverts on any
    // intermediate overflow, matching the Rust handler's checked_mul /
    // checked_add semantics.
    // -------------------------------------------------------------------------
    function _dotProduct(bytes calldata args)
        internal
        pure
        returns (bytes memory)
    {
        (int256[] memory a, int256[] memory b) = abi.decode(
            args,
            (int256[], int256[])
        );
        require(a.length == b.length, "MockPrecompile: array length mismatch");

        int256 result = 0;
        for (uint256 i = 0; i < a.length; i++) {
            // Solidity 0.8 reverts on overflow for both * and +=.
            result += a[i] * b[i];
        }
        return abi.encode(result);
    }
}
