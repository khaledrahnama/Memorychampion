import path from "path";
import { HardhatUserConfig, subtask } from "hardhat/config";
import { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } from "hardhat/builtin-tasks/task-names";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";
dotenv.config();

const SOLC_VERSION = "0.8.24";

// Use the solc compiler bundled in the `solc` npm package instead of letting
// Hardhat download one from binaries.soliditylang.org. That host is blocked on
// some networks (and in CI sandboxes); the npm registry is almost never blocked.
subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async (args: { solcVersion: string }, _hre, runSuper) => {
  if (args.solcVersion === SOLC_VERSION) {
    const solc = require("solc");
    return {
      compilerPath: path.join(path.dirname(require.resolve("solc/package.json")), "soljson.js"),
      isSolcJs: true,
      version: SOLC_VERSION,
      longVersion: solc.version()
    };
  }
  return runSuper();
});

const PRIVATE_KEY = process.env.PRIVATE_KEY || "0x" + "11".repeat(32);
const MONAD_TESTNET_RPC_URL = process.env.MONAD_TESTNET_RPC_URL || "https://testnet-rpc.monad.xyz";

const config: HardhatUserConfig = {
  solidity: {
    version: SOLC_VERSION,
    settings: {
      optimizer: { enabled: true, runs: 200 }
    }
  },
  networks: {
    monadTestnet: {
      url: MONAD_TESTNET_RPC_URL,
      chainId: 10143,
      accounts: [PRIVATE_KEY]
    },
    hardhat: {}
  }
};

export default config;
