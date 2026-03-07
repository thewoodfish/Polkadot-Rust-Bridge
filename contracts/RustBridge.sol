// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title RustBridge
/// @notice Interface contract for calling PolkaVM precompile functions.
///         The precompile address is the deployment address of the Rust crate
///         compiled for PolkaVM and registered on the Polkadot network.
contract RustBridge {
    /// @dev Address where the PolkaVM precompile is registered.
    address public immutable precompileAddress;

    event PrecompileCalled(bytes4 indexed selector, uint256 gasUsed);

    constructor(address _precompileAddress) {
        precompileAddress = _precompileAddress;
    }

    /// @notice Call an arbitrary function on the PolkaVM precompile.
    /// @param data ABI-encoded call data (selector + arguments).
    /// @return result Raw bytes returned by the precompile.
    function callPrecompile(bytes calldata data)
        external
        returns (bytes memory result)
    {
        uint256 gasBefore = gasleft();
        bool success;
        (success, result) = precompileAddress.call(data);
        require(success, "RustBridge: precompile call failed");
        emit PrecompileCalled(bytes4(data[:4]), gasBefore - gasleft());
    }

    /// @notice Pure Solidity fibonacci for benchmark comparison.
    /// @dev Uses unchecked arithmetic to wrap on overflow (matches Rust wrapping_add),
    ///      so large n values are valid for gas benchmarking even if the result wraps.
    function fibonacci(uint256 n) external pure returns (uint256) {
        if (n <= 1) return n;
        uint256 a = 0;
        uint256 b = 1;
        unchecked {
            for (uint256 i = 2; i <= n; i++) {
                uint256 c = a + b;
                a = b;
                b = c;
            }
        }
        return b;
    }
}
