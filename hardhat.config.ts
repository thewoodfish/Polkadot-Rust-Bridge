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
    // Polkadot Hub testnet — Westend Asset Hub (EVM chain ID 420420421).
    // Both names point to the same network; `polkadotHub` is the short alias
    // used in npm scripts and README examples.
    // Set POLKADOT_HUB_RPC_URL and DEPLOYER_PRIVATE_KEY in .env before using.
    polkadotHub: {
      url:      process.env.POLKADOT_HUB_RPC_URL ?? "",
      accounts: process.env.DEPLOYER_PRIVATE_KEY
                  ? [process.env.DEPLOYER_PRIVATE_KEY]
                  : [],
      // Westend Asset Hub EVM chain ID (420420421).
      // Verify current value at: https://chainlist.org/?search=westend+asset+hub
      chainId:  420420421,
    },
    polkadotHubTestnet: {
      url:      process.env.POLKADOT_HUB_RPC_URL ?? "",
      accounts: process.env.DEPLOYER_PRIVATE_KEY
                  ? [process.env.DEPLOYER_PRIVATE_KEY]
                  : [],
      chainId:  420420421,
    },
  },
};

export default config;
