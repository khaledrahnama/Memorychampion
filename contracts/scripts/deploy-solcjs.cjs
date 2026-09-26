// Deploys MemoryGame (compiled by compile-solcjs.cjs) with viem.
//
// Local:  DEPLOYER_PK=0x... node scripts/deploy-solcjs.cjs
// Monad:  DEPLOYER_PK=0x... npm run deploy:monad
//
// Env: DEPLOYER_PK (required), RPC_URL (default local node), CHAIN_ID (default 31337),
//      OPERATOR_ADDRESS (default: the deployer — the backend's OPERATOR_PRIVATE_KEY
//      must belong to this address, since it creates and finalizes games).
const fs = require("fs");
const path = require("path");
const { createPublicClient, createWalletClient, http, defineChain, formatEther } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");

const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
const CHAIN_ID = Number(process.env.CHAIN_ID || 31337);
const DEPLOYER_PK = process.env.DEPLOYER_PK;
if (!DEPLOYER_PK) throw new Error("Set DEPLOYER_PK to the private key that will deploy (and by default operate) the contract");

const build = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "build", "MemoryGame.json"), "utf8"));

const chain = defineChain({
  id: CHAIN_ID,
  name: CHAIN_ID === 10143 ? "Monad Testnet" : "local",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } }
});

async function main() {
  const account = privateKeyToAccount(DEPLOYER_PK);
  const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });
  const walletClient = createWalletClient({ account, chain, transport: http(RPC_URL) });

  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`Deployer ${account.address} on chain ${CHAIN_ID} — balance ${formatEther(balance)} MON`);
  if (balance === 0n) throw new Error("Deployer has no MON for gas. Fund it first (testnet faucet: https://faucet.monad.xyz).");

  const operator = process.env.OPERATOR_ADDRESS || account.address;
  const hash = await walletClient.deployContract({ abi: build.abi, bytecode: build.bytecode, args: [operator] });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  console.log("MemoryGame deployed to:", receipt.contractAddress);
  console.log("Operator:", operator);
  if (CHAIN_ID === 10143) console.log(`Explorer: https://testnet.monadvision.com/address/${receipt.contractAddress}`);
}

main().catch((e) => {
  console.error(e.shortMessage || e.message || e);
  process.exit(1);
});
