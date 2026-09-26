import { createContext, useContext, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount, useConfig, useConnect, useSwitchChain, useWriteContract } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { api, getToken, type AppConfig, type Me } from "./api";
import { serverNow } from "./clock";
import { memoryGameAbi } from "./web3";

export const AppConfigContext = createContext<AppConfig | null>(null);

export function useAppConfig() {
  const cfg = useContext(AppConfigContext);
  if (!cfg) throw new Error("AppConfigContext missing");
  return cfg;
}

/** Re-renders every `intervalMs` with the server-synced time. */
export function useNow(intervalMs = 250) {
  const [now, setNow] = useState(serverNow());
  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function useMe() {
  const token = getToken();
  return useQuery({
    queryKey: ["me", token],
    queryFn: () => api<Me>("/auth/me"),
    enabled: !!token,
    refetchInterval: 30_000,
    retry: false
  });
}

/**
 * Connects MetaMask specifically when it's installed (EIP-6963 discovery),
 * falling back to any injected browser wallet. Having several wallet
 * extensions installed otherwise makes `window.ethereum` point at whichever
 * one loaded last.
 */
export function useWalletConnect() {
  const { connectors, connectAsync } = useConnect();
  const metaMask = connectors.find((c) => c.id === "io.metamask" || c.id === "metaMask" || /metamask/i.test(c.name));
  const fallback = connectors.find((c) => c.type === "injected");
  const connector = metaMask ?? fallback;
  const available = typeof window !== "undefined" && (!!metaMask || !!(window as any).ethereum);
  return {
    available,
    walletName: metaMask ? "MetaMask" : "your wallet",
    connect: async () => {
      if (!connector || !available) throw new Error("MetaMask isn't installed in this browser. Install it from metamask.io, then reload this page.");
      const res = await connectAsync({ connector });
      return res.accounts[0];
    }
  };
}

/**
 * Sends a MemoryGame transaction from the connected wallet: switches (or adds)
 * the right network first, then waits for the transaction to be mined.
 */
export function useContractTx() {
  const cfg = useAppConfig();
  const wagmiConfig = useConfig();
  const { chainId, isConnected } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const { connect } = useWalletConnect();

  return async function send(
    call:
      | { functionName: "joinGame"; args: readonly [bigint]; value?: bigint }
      | { functionName: "claimReward"; args: readonly [bigint, bigint, readonly `0x${string}`[]] }
  ) {
    if (!cfg.contractAddress) throw new Error("The game contract isn't configured on the server yet.");
    if (!isConnected) await connect();
    if (chainId !== cfg.chainId) await switchChainAsync({ chainId: cfg.chainId });
    const hash = await writeContractAsync({
      address: cfg.contractAddress,
      abi: memoryGameAbi,
      chainId: cfg.chainId,
      ...(call as any)
    });
    const receipt = await waitForTransactionReceipt(wagmiConfig, { hash, chainId: cfg.chainId });
    if (receipt.status !== "success") throw new Error("The transaction failed on-chain.");
    return hash;
  };
}
