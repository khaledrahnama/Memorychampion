import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { defineChain } from "viem";
import type { AppConfig } from "./api";

export function makeChain(cfg: AppConfig) {
  return defineChain({
    id: cfg.chainId,
    name: cfg.chainName,
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [cfg.rpcUrl] } },
    blockExplorers: cfg.explorerUrl ? { default: { name: "Explorer", url: cfg.explorerUrl } } : undefined,
    testnet: cfg.chainId !== 143
  });
}

export function makeWagmiConfig(cfg: AppConfig) {
  const chain = makeChain(cfg);
  return createConfig({
    chains: [chain],
    connectors: [injected()],
    transports: { [chain.id]: http(cfg.rpcUrl) }
  });
}

// Keep in sync with contracts/contracts/MemoryGame.sol
export const memoryGameAbi = [
  { type: "function", name: "joinGame", stateMutability: "payable", inputs: [{ name: "gameId", type: "uint256" }], outputs: [] },
  {
    type: "function", name: "claimReward", stateMutability: "nonpayable",
    inputs: [{ name: "gameId", type: "uint256" }, { name: "amount", type: "uint256" }, { name: "proof", type: "bytes32[]" }],
    outputs: []
  },
  {
    type: "function", name: "isRegistered", stateMutability: "view",
    inputs: [{ name: "gameId", type: "uint256" }, { name: "wallet", type: "address" }], outputs: [{ type: "bool" }]
  }
] as const;
