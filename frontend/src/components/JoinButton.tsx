import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { api, getToken, type GameSummary } from "../lib/api";
import { useContractTx, useMe } from "../lib/hooks";
import { formatMon, friendlyError, mon, shortAddress } from "../lib/format";

/**
 * "Join game": checks the account is ready (email, nickname, linked wallet and
 * that same wallet active in MetaMask), sends joinGame() on-chain, then tells
 * the backend and opens the lobby.
 */
export function JoinButton({ game, className = "", full = false, hideNote = false }: { game: GameSummary; className?: string; full?: boolean; hideNote?: boolean }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const { address, isConnected } = useAccount();
  const send = useContractTx();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const needsAccount = !getToken() || !me || !me.nickname || !me.walletAddress;
  const wrongWallet = isConnected && !!me?.walletAddress && address?.toLowerCase() !== me.walletAddress.toLowerCase();
  const fee = BigInt(game.entryFeeWei);

  async function join() {
    setError(null);
    if (needsAccount) return navigate("/account");
    try {
      setBusy("Confirm in MetaMask…");
      const hash = await send({ functionName: "joinGame", args: [BigInt(game.onchainGameId)], value: fee });
      setBusy("Registering…");
      await api(`/games/${game.id}/join`, { body: { txHash: hash } });
      await queryClient.invalidateQueries();
      navigate(`/games/${game.id}`);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(null);
    }
  }

  const label = needsAccount ? "Create player to join" : fee > 0n ? `Join · ${mon(fee, 2)} MON` : "Join game";

  return (
    <div className={className}>
      <button className={`btn-violet ${full ? "w-full" : "min-w-[150px]"} py-3.5 text-[16px]`} disabled={!!busy || wrongWallet} onClick={join}>
        {busy ?? label}
      </button>
      {wrongWallet && <p className="mt-2 text-xs text-sun">MetaMask is on {shortAddress(address)}. Switch to your linked wallet {shortAddress(me!.walletAddress)} to join.</p>}
      {error && <p className="mt-2 text-xs text-rose">{error}</p>}
      {!full && !hideNote && !error && !wrongWallet && (
        <p className="mt-3 max-w-md text-sm text-muted">
          Joining sends one transaction from your wallet. {fee > 0n ? `Entry is ${formatMon(fee)}, plus network gas.` : "Free entry, so you only pay network gas."}
        </p>
      )}
    </div>
  );
}
