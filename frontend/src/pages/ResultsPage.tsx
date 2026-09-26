import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { api, getToken, type GameSummary } from "../lib/api";
import { useAppConfig, useContractTx } from "../lib/hooks";
import { friendlyError, mon, shortAddress, shortHash } from "../lib/format";
import { StatusPill } from "../components/Brand";
import { ArrowUpRightIcon, CheckIcon } from "../components/Icons";

interface Results {
  game: GameSummary & { finalizeTx: string | null };
  ready: boolean;
  finalizeError: string | null;
  leaderboard: { rank: number; nickname: string; score: number; rewardWei: string; isMe: boolean }[];
  me: { score: number; rewardWei: string; proof: `0x${string}`[]; claimed: boolean; wallet: string } | null;
}

function Pips({ score, total, perfect }: { score: number; total: number; perfect: boolean }) {
  return (
    <span className="flex gap-1">
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`h-4 w-2.5 rounded-[3px] ${i < score ? (perfect ? "bg-mint" : "bg-violet-light") : "bg-raised"}`} />
      ))}
    </span>
  );
}

export function ResultsPage() {
  const { gameId } = useParams<{ gameId: string }>();
  const cfg = useAppConfig();
  const queryClient = useQueryClient();
  const { address } = useAccount();
  const send = useContractTx();
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);

  const { data, error } = useQuery({
    queryKey: ["results", gameId, !!getToken()],
    queryFn: () => api<Results>(`/games/${gameId}/results`),
    refetchInterval: (q) => (q.state.data?.ready ? false : 3000)
  });

  useEffect(() => {
    if (data?.ready) queryClient.invalidateQueries({ queryKey: ["me"] });
  }, [data?.ready, queryClient]);

  async function claim() {
    if (!data?.me) return;
    setClaiming(true);
    setClaimError(null);
    try {
      await send({ functionName: "claimReward", args: [BigInt(data.game.onchainGameId), BigInt(data.me.rewardWei), data.me.proof] });
      await queryClient.invalidateQueries();
    } catch (e) {
      setClaimError(friendlyError(e));
    } finally {
      setClaiming(false);
    }
  }

  if (error) return <div className="panel p-10 text-rose">{(error as Error).message}</div>;
  if (!data) return <div className="panel p-10 text-muted">Loading results…</div>;

  const { game, me } = data;
  const total = game.roundsCount;
  const reward = me ? BigInt(me.rewardWei) : 0n;
  const winners = data.leaderboard.filter((r) => BigInt(r.rewardWei) > 0n).length;
  const wrongWallet = me && address && address.toLowerCase() !== me.wallet.toLowerCase();
  const txLink = game.finalizeTx && (
    cfg.explorerUrl ? (
      <a className="inline-flex items-center gap-1 font-mono text-sm text-violet-light hover:underline" href={`${cfg.explorerUrl}/tx/${game.finalizeTx}`} target="_blank" rel="noreferrer">
        {shortHash(game.finalizeTx)} <ArrowUpRightIcon className="h-4 w-4" />
      </a>
    ) : (
      <span className="font-mono text-sm text-violet-light">{shortHash(game.finalizeTx)}</span>
    )
  );

  if (!data.ready) {
    return (
      <div className="panel mx-auto flex max-w-xl items-center gap-4 p-10">
        <span className="h-6 w-6 shrink-0 animate-spin rounded-full border-[3px] border-violet border-t-transparent" />
        <div>
          <p className="font-display text-2xl font-extrabold">{game.name}</p>
          <p className="text-muted">{game.status === "live" ? "The game is still in progress…" : "Grading answers and publishing the results on-chain…"}</p>
          {data.finalizeError && <p className="mt-2 text-xs text-sun">Retrying: {data.finalizeError}</p>}
        </div>
      </div>
    );
  }

  const perfect = me && me.score === total;
  const verdict = !me ? "" : perfect ? "Perfect recall" : me.score >= total - 1 ? "So close" : me.score > 0 ? "Nice try" : "Tough one";

  return (
    <div className="grid gap-6 lg:grid-cols-[440px_1fr]">
      <div className="space-y-6">
        <section className="panel p-7 sm:p-9">
          <div className="flex items-center gap-3">
            <StatusPill status="finished" />
            <span className="truncate text-muted">{game.name}</span>
          </div>
          {me ? (
            <>
              <div className="mt-5 flex items-end gap-4">
                <span className={`font-display text-[96px] font-black leading-[0.85] sm:text-[120px] ${perfect ? "text-mint" : "text-cream"}`}>{me.score}/{total}</span>
                <span className="font-display pb-2 text-2xl font-extrabold leading-tight">{verdict.split(" ")[0]}<br />{verdict.split(" ").slice(1).join(" ")}</span>
              </div>
              <p className="mt-5 text-cream/75">
                {perfect
                  ? winners > 1 ? `You're one of ${winners} players who got every round right.` : "You're the only player who got every round right."
                  : `You needed ${total}/${total} to share the prize.${winners ? ` ${winners} player${winners === 1 ? "" : "s"} did.` : ""}`}
              </p>
            </>
          ) : (
            <p className="mt-5 text-cream/75">{data.leaderboard.length} players took part. {winners ? `${winners} got a perfect score.` : "Nobody got a perfect score."}</p>
          )}
        </section>

        {reward > 0n ? (
          <section className="rounded-[28px] border-2 border-sun/80 bg-panel p-7 sm:p-9">
            <p className="caps">Your share</p>
            <p className="mt-2 font-mono text-[44px] font-bold leading-none text-sun">{mon(reward, 4)} MON</p>
            <p className="mt-4 text-cream/75">
              {winners > 1 ? `${winners} players split the ${mon(game.poolWei)} MON pool equally.` : `You take the whole ${mon(game.poolWei)} MON pool.`}
            </p>
            {me!.claimed ? (
              <p className="mt-6 flex items-center gap-2 rounded-xl bg-mint-soft px-4 py-3.5 font-bold text-mint"><CheckIcon className="h-5 w-5" /> Claimed to {shortAddress(me!.wallet)}</p>
            ) : (
              <>
                <button className="btn-sun mt-6 w-full py-4 text-[17px]" disabled={claiming || !!wrongWallet} onClick={claim}>
                  {claiming ? "Confirm in MetaMask…" : `Claim ${mon(reward, 4)} MON`}
                </button>
                <p className="mt-3 text-sm text-cream/70">Paid to <span className="font-mono">{shortAddress(me!.wallet)}</span>.</p>
                {wrongWallet && <p className="mt-2 text-sm text-sun">MetaMask is on {shortAddress(address)} — switch to {shortAddress(me!.wallet)} to claim.</p>}
                {claimError && <p className="mt-2 text-sm text-rose">{claimError}</p>}
              </>
            )}
            <div className="mt-6 flex items-center justify-between border-t border-line pt-5">
              <span className="flex items-center gap-2 font-bold text-mint"><CheckIcon className="h-5 w-5" /> Results finalized on-chain</span>
              {txLink}
            </div>
          </section>
        ) : (
          <section className="panel p-7">
            <p className="text-cream/75">
              {winners ? `${winners} winner${winners === 1 ? "" : "s"} shared ${mon(game.poolWei)} MON.` : `Nobody scored ${total}/${total}, so the ${mon(game.poolWei)} MON pool returns to the host.`}
            </p>
            <div className="mt-5 flex items-center justify-between border-t border-line pt-5">
              <span className="flex items-center gap-2 font-bold text-mint"><CheckIcon className="h-5 w-5" /> Results finalized on-chain</span>
              {txLink}
            </div>
            <Link to="/" className="btn-violet mt-6 w-full py-3.5">Find the next game</Link>
          </section>
        )}
      </div>

      <section className="panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-7 pb-5 pt-7">
          <h2 className="font-display text-[30px] font-extrabold">Leaderboard</h2>
          <span className="text-muted">{data.leaderboard.length} player{data.leaderboard.length === 1 ? "" : "s"} · {winners} winner{winners === 1 ? "" : "s"}</span>
        </div>
        {data.leaderboard.length === 0 ? (
          <p className="px-7 pb-8 text-muted">Nobody played this game.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left">
              <thead>
                <tr className="caps !text-[11px]">
                  <th className="px-7 pb-3 font-bold">Rank</th>
                  <th className="pb-3 font-bold">Player</th>
                  <th className="pb-3 font-bold">Score</th>
                  <th className="px-7 pb-3 text-right font-bold">Reward</th>
                </tr>
              </thead>
              <tbody>
                {data.leaderboard.map((row, i) => {
                  const won = BigInt(row.rewardWei) > 0n;
                  return (
                    <tr key={i} className={`border-t border-line ${row.isMe ? "bg-violet-soft" : ""}`}>
                      <td className="px-7 py-4">
                        <span className={`grid h-8 w-8 place-items-center rounded-lg font-mono text-sm font-bold ${won ? "bg-mint-soft text-mint" : "bg-raised text-muted"}`}>{row.rank}</span>
                      </td>
                      <td className="py-4 font-bold">{row.nickname}{row.isMe && <span className="ml-2 text-sm text-violet-light">You</span>}</td>
                      <td className="py-4">
                        <span className="flex items-center gap-3"><Pips score={row.score} total={total} perfect={row.score === total} /><span className="font-mono text-sm">{row.score}/{total}</span></span>
                      </td>
                      <td className={`px-7 py-4 text-right font-mono ${won ? "text-sun" : "text-muted"}`}>{won ? mon(row.rewardWei, 4) : "–"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
