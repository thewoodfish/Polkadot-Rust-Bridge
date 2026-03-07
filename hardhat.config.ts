import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "dotenv/config"; // loads .env into process.env

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./tests",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    // Polkadot Hub testnet (Westend Asset Hub).
    // Set POLKADOT_HUB_RPC_URL and DEPLOYER_PRIVATE_KEY in .env before using.
    polkadotHubTestnet: {
      url:      process.env.POLKADOT_HUB_RPC_URL ?? "",
      accounts: process.env.DEPLOYER_PRIVATE_KEY
                  ? [process.env.DEPLOYER_PRIVATE_KEY]
                  : [],
      // Westend Asset Hub EVM chain ID.
      // Verify against: https://chainlist.org or the chain's runtime metadata.
      chainId:  420420421,
    },
  },
};

export default config;
