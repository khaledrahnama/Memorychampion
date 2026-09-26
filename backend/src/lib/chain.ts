import { createPublicClient, createWalletClient, defineChain, http, parseEventLogs } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "../config.js";
import { HttpError } from "./http.js";

export const chain = defineChain({
  id: config.chain.id,
  name: config.chain.name,
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [config.chain.rpcUrl] } }
});

export const publicClient = createPublicClient({ chain, transport: http(config.chain.rpcUrl) });

// Keep in sync with contracts/contracts/MemoryGame.sol
export const memoryGameAbi = [
  {
    type: "function", name: "getGame", stateMutability: "view",
    inputs: [{ name: "gameId", type: "uint256" }],
    outputs: [
      { name: "startTime", type: "uint64" }, { name: "pool", type: "uint256" }, { name: "claimed", type: "uint256" },
      { name: "participantCount", type: "uint32" }, { name: "entryFee", type: "uint128" }, { name: "status", type: "uint8" }
    ]
  },
  {
    type: "function", name: "getGameAccounting", stateMutability: "view",
    inputs: [{ name: "gameId", type: "uint256" }],
    outputs: [
      { name: "organizer", type: "address" }, { name: "funding", type: "uint256" }, { name: "allocated", type: "uint256" },
      { name: "rewardsPaid", type: "uint256" }, { name: "organizerWithdrawn", type: "bool" }, { name: "rewardsRoot", type: "bytes32" }
    ]
  },
  {
    type: "function", name: "createGame", stateMutability: "payable",
    inputs: [{ name: "startTime", type: "uint64" }, { name: "entryFee", type: "uint128" }],
    outputs: [{ name: "gameId", type: "uint256" }]
  },
  {
    type: "function", name: "finalizeGame", stateMutability: "nonpayable",
    inputs: [{ name: "gameId", type: "uint256" }, { name: "rewardsRoot", type: "bytes32" }, { name: "totalAllocated", type: "uint128" }],
    outputs: []
  },
  { type: "function", name: "cancelGame", stateMutability: "nonpayable", inputs: [{ name: "gameId", type: "uint256" }], outputs: [] },
  { type: "function", name: "withdrawUnclaimed", stateMutability: "nonpayable", inputs: [{ name: "gameId", type: "uint256" }], outputs: [] },
  {
    type: "function", name: "isRegistered", stateMutability: "view",
    inputs: [{ name: "gameId", type: "uint256" }, { name: "wallet", type: "address" }], outputs: [{ type: "bool" }]
  },
  {
    type: "function", name: "hasClaimed", stateMutability: "view",
    inputs: [{ name: "gameId", type: "uint256" }, { name: "wallet", type: "address" }], outputs: [{ type: "bool" }]
  },
  { type: "function", name: "operator", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  {
    type: "event", name: "GameCreated",
    inputs: [
      { name: "gameId", type: "uint256", indexed: true }, { name: "startTime", type: "uint64", indexed: false },
      { name: "funding", type: "uint256", indexed: false }, { name: "entryFee", type: "uint256", indexed: false },
      { name: "organizer", type: "address", indexed: false }
    ]
  }
] as const;

export const ONCHAIN_STATUS = ["open", "live", "finalized", "cancelled"] as const;

function requireContract() {
  if (!config.contractAddress) throw new HttpError(503, "CONTRACT_ADDRESS is not configured on the server");
  return config.contractAddress;
}

export async function readGame(onchainGameId: number) {
  const [startTime, pool, claimed, participantCount, entryFee, status] = await publicClient.readContract({
    address: requireContract(), abi: memoryGameAbi, functionName: "getGame", args: [BigInt(onchainGameId)]
  });
  return { startTime: Number(startTime), pool, claimed, participantCount, entryFee, status: ONCHAIN_STATUS[status] };
}

export async function readAccounting(onchainGameId: number) {
  const [organizer, funding, allocated, rewardsPaid, organizerWithdrawn, rewardsRoot] = await publicClient.readContract({
    address: requireContract(), abi: memoryGameAbi, functionName: "getGameAccounting", args: [BigInt(onchainGameId)]
  });
  return { organizer, funding, allocated, rewardsPaid, organizerWithdrawn, rewardsRoot };
}

export async function isRegisteredOnchain(onchainGameId: number, wallet: string) {
  return publicClient.readContract({
    address: requireContract(), abi: memoryGameAbi, functionName: "isRegistered",
    args: [BigInt(onchainGameId), wallet as `0x${string}`]
  });
}

export async function hasClaimedOnchain(onchainGameId: number, wallet: string) {
  return publicClient.readContract({
    address: requireContract(), abi: memoryGameAbi, functionName: "hasClaimed",
    args: [BigInt(onchainGameId), wallet as `0x${string}`]
  });
}

// ---- Operator (server-side signer) ----

const KEY_HELP =
  "OPERATOR_PRIVATE_KEY is not a valid private key. It must be the wallet's private key (64 hex characters, from MetaMask → Account details → Show private key) — not the wallet address.";

function operatorAccount() {
  if (!config.operatorPrivateKey) return undefined;
  try {
    return privateKeyToAccount(config.operatorPrivateKey);
  } catch {
    return null; // set but malformed
  }
}

function operator() {
  const account = operatorAccount();
  if (account === undefined) throw new HttpError(503, "OPERATOR_PRIVATE_KEY is not configured on the server");
  if (account === null) throw new HttpError(503, KEY_HELP);
  const wallet = createWalletClient({ account, chain, transport: http(config.chain.rpcUrl) });
  return { account, wallet };
}

/** Operator wallet address, or undefined if the key is missing or malformed (never throws). */
export function operatorAddress() {
  return operatorAccount()?.address;
}

/** Human-readable problem with the operator key, if any (shown on the Host page). */
export function operatorKeyProblem(): string | null {
  const account = operatorAccount();
  if (account === undefined) return "OPERATOR_PRIVATE_KEY is not set on the server.";
  if (account === null) return KEY_HELP;
  return null;
}

async function sendAndWait(functionName: "createGame" | "finalizeGame" | "cancelGame" | "withdrawUnclaimed", args: readonly unknown[], value?: bigint) {
  const { account, wallet } = operator();
  const hash = await wallet.writeContract({
    address: requireContract(), abi: memoryGameAbi, functionName, args: args as any, value, account, chain
  } as any);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
  if (receipt.status !== "success") throw new HttpError(502, `${functionName} transaction reverted (${hash})`);
  return receipt;
}

export async function createGameOnchain(startTime: number, poolWei: bigint, entryFeeWei: bigint) {
  const receipt = await sendAndWait("createGame", [BigInt(startTime), entryFeeWei], poolWei);
  const [created] = parseEventLogs({ abi: memoryGameAbi, eventName: "GameCreated", logs: receipt.logs });
  if (!created) throw new HttpError(502, "createGame succeeded but no GameCreated event was found");
  return { onchainGameId: Number(created.args.gameId), txHash: receipt.transactionHash };
}

export async function finalizeOnchain(onchainGameId: number, root: `0x${string}`, totalAllocated: bigint) {
  return (await sendAndWait("finalizeGame", [BigInt(onchainGameId), root, totalAllocated])).transactionHash;
}

export async function cancelOnchain(onchainGameId: number) {
  return (await sendAndWait("cancelGame", [BigInt(onchainGameId)])).transactionHash;
}

export async function withdrawOnchain(onchainGameId: number) {
  return (await sendAndWait("withdrawUnclaimed", [BigInt(onchainGameId)])).transactionHash;
}
