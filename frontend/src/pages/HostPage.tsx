import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useBalance } from "wagmi";
import { api, type GameStatus } from "../lib/api";
import { useAppConfig } from "../lib/hooks";
import { clockTime, mon, shortAddress } from "../lib/format";
import { StatusPill } from "../components/Brand";
import { ArrowUpRightIcon, CopyIcon, MinusIcon, PlusIcon } from "../components/Icons";

const KEY_STORAGE = "mmc_admin_key";

interface AdminGame {
  id: string;
  onchainGameId: number;
  name: string;
  startTime: number;
  endTime: number;
  roundsCount: number;
  status: GameStatus;
  finalizeState: string;
  winnersCount: number | null;
  poolMon: string | null;
  participantCount: number | null;
  withdrawableMon: string | null;
}

const STARTS = [
  { label: "3 min", minutes: 3 },
  { label: "10 min", minutes: 10 },
  { label: "30 min", minutes: 30 },
  { label: "1 hour", minutes: 60 },
  { label: "Custom", minutes: 0 }
];

function localInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function HostPage() {
  const cfg = useAppConfig();
  const queryClient = useQueryClient();
  const [key, setKey] = useState(() => { try { return sessionStorage.getItem(KEY_STORAGE) ?? ""; } catch { return ""; } });
  const [name, setName] = useState("Friday Night Recall");
  const [startsIdx, setStartsIdx] = useState(1);
  const [custom, setCustom] = useState(() => localInput(new Date(Date.now() + 60 * 60 * 1000)));
  const [pool, setPool] = useState("0.5");
  const [fee, setFee] = useState("0");
  const [rounds, setRounds] = useState(5);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [preview, setPreview] = useState<{ name: string; rounds: any[] } | null>(null);
  const [copied, setCopied] = useState(false);

  const saveKey = (k: string) => {
    setKey(k);
    try { k ? sessionStorage.setItem(KEY_STORAGE, k) : sessionStorage.removeItem(KEY_STORAGE); } catch { /* ignore */ }
  };

  const { data: opBalance } = useBalance({
    address: cfg.operatorAddress ?? undefined,
    chainId: cfg.chainId,
    query: { enabled: !!cfg.operatorAddress, refetchInterval: 15_000 }
  });

  const games = useQuery({
    queryKey: ["host-games", key],
    queryFn: () => api<{ games: AdminGame[] }>("/admin/games", { adminKey: key }),
    enabled: key.length > 0,
    retry: false,
    refetchInterval: 10_000
  });

  async function act(label: string, fn: () => Promise<string>) {
    setBusy(label);
    setMsg(null);
    try {
      setMsg({ ok: true, text: await fn() });
      await queryClient.invalidateQueries();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  function create(e: React.FormEvent) {
    e.preventDefault();
    const choice = STARTS[startsIdx];
    const startTime = choice.minutes
      ? Math.floor(Date.now() / 1000) + choice.minutes * 60
      : Math.floor(new Date(custom).getTime() / 1000);
    act("create", async () => {
      const r = await api<{ id: string; onchainGameId: number }>("/admin/games", {
        adminKey: key,
        body: { name, startTime, poolMon: pool, entryFeeMon: fee || "0", roundsCount: rounds }
      });
      return `“${name}” is live on the Games page (on-chain game #${r.onchainGameId}), starting at ${clockTime(startTime)}.`;
    });
  }

  const now = Date.now();

  return (
    <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
      {cfg.operatorKeyProblem && (
        <div className="rounded-2xl border border-rose/50 bg-rose-soft p-5 text-sm text-rose lg:col-span-2">
          <b>Server setup problem:</b> {cfg.operatorKeyProblem} Fix it in Vercel → Settings → Environment Variables, then redeploy.
        </div>
      )}
      <form onSubmit={create} className="panel p-7 sm:p-10">
        <h1 className="font-display text-[44px] font-extrabold leading-none sm:text-[52px]">Host a game</h1>
        <p className="mt-4 text-[16px] text-cream/75">
          Creates the game on {cfg.chainName.replace("Local Hardhat", "the chain")} and funds the prize pool from your operator wallet in one transaction. Cards and questions are generated for you.
        </p>

        <label className="field-label mt-8" htmlFor="gname">Game name</label>
        <input id="gname" className="input text-[16px]" required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />

        <p className="field-label mt-7">Starts in</p>
        <div className="grid grid-cols-5 rounded-2xl border border-line bg-ink/60 p-1">
          {STARTS.map((s, i) => (
            <button type="button" key={s.label} onClick={() => setStartsIdx(i)} className={`rounded-xl px-2 py-3 text-[15px] font-bold transition ${startsIdx === i ? "bg-raised text-cream" : "text-muted hover:text-cream"}`}>
              {s.label}
            </button>
          ))}
        </div>
        {STARTS[startsIdx].minutes === 0 && (
          <input className="input mt-3" type="datetime-local" required value={custom} onChange={(e) => setCustom(e.target.value)} />
        )}
        <p className="help">Registration closes when the game starts.</p>

        <div className="mt-7 grid gap-5 sm:grid-cols-2">
          <div>
            <label className="field-label" htmlFor="pool">Prize pool</label>
            <div className="relative">
              <input id="pool" className="input pr-16 font-mono text-lg" required inputMode="decimal" pattern="\d+(\.\d+)?" value={pool} onChange={(e) => setPool(e.target.value)} />
              <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 font-mono text-sm text-muted">MON</span>
            </div>
            <p className="help">Operator balance: <span className="font-mono text-cream">{opBalance ? mon(opBalance.value) : "—"} MON</span></p>
          </div>
          <div>
            <label className="field-label" htmlFor="fee">Entry fee</label>
            <div className="relative">
              <input id="fee" className="input pr-16 font-mono text-lg" inputMode="decimal" pattern="\d+(\.\d+)?" value={fee} onChange={(e) => setFee(e.target.value)} />
              <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 font-mono text-sm text-muted">MON</span>
            </div>
            <p className="help">0 = free. Players still pay gas to join.</p>
          </div>
          <div>
            <p className="field-label">Rounds</p>
            <div className="flex items-center gap-2">
              <button type="button" className="grid h-12 w-12 place-items-center rounded-xl border border-line bg-raised disabled:opacity-40" onClick={() => setRounds((r) => Math.max(1, r - 1))} disabled={rounds <= 1}><MinusIcon /></button>
              <span className="grid h-12 w-16 place-items-center rounded-xl border border-line bg-ink font-mono text-lg">{rounds}</span>
              <button type="button" className="grid h-12 w-12 place-items-center rounded-xl border border-line bg-raised disabled:opacity-40" onClick={() => setRounds((r) => Math.min(5, r + 1))} disabled={rounds >= 5}><PlusIcon /></button>
            </div>
            <p className="help">5s to look, 5s to answer, per round.</p>
          </div>
          <div>
            <label className="field-label" htmlFor="akey">Admin key</label>
            <input id="akey" className="input font-mono" type="password" autoComplete="current-password" required value={key} onChange={(e) => saveKey(e.target.value)} placeholder="••••••••••••" />
            <p className="help">ADMIN_KEY from your .env. Kept in this tab only.</p>
          </div>
        </div>

        {msg && <p className={`mt-6 rounded-xl px-4 py-3 text-sm ${msg.ok ? "bg-mint-soft text-mint" : "bg-rose-soft text-rose"}`}>{msg.text}</p>}
        <button className="btn-violet mt-7 w-full py-4 text-[17px]" disabled={!!busy || !key}>
          {busy === "create" ? "Funding on-chain…" : `Create & fund game · ${pool || 0} MON`}
        </button>
      </form>

      <aside className="space-y-6">
        <div className="panel p-7">
          <h2 className="text-lg font-extrabold">Operator wallet</h2>
          <dl className="mt-5 space-y-3.5 text-[15px]">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted">Address</dt>
              <dd className="flex items-center gap-2 font-mono">
                {cfg.operatorAddress ? shortAddress(cfg.operatorAddress) : <span className="text-rose">not set</span>}
                {cfg.operatorAddress && (
                  <button type="button" title="Copy address" onClick={() => { navigator.clipboard?.writeText(cfg.operatorAddress!); setCopied(true); setTimeout(() => setCopied(false), 1200); }}>
                    <CopyIcon className={`h-4 w-4 ${copied ? "text-mint" : "text-muted"}`} />
                  </button>
                )}
              </dd>
            </div>
            <div className="flex justify-between gap-3"><dt className="text-muted">Balance</dt><dd className="font-mono text-sun">{opBalance ? mon(opBalance.value) : "—"} MON</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted">Network</dt><dd>{cfg.chainName} · {cfg.chainId}</dd></div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Contract</dt>
              <dd className="font-mono">
                {cfg.contractAddress ? (
                  cfg.explorerUrl ? (
                    <a className="inline-flex items-center gap-1 text-violet-light hover:underline" href={`${cfg.explorerUrl}/address/${cfg.contractAddress}`} target="_blank" rel="noreferrer">{shortAddress(cfg.contractAddress)} <ArrowUpRightIcon className="h-4 w-4" /></a>
                  ) : shortAddress(cfg.contractAddress)
                ) : <span className="text-rose">not set</span>}
              </dd>
            </div>
          </dl>
          {cfg.faucetUrl && <a className="mt-5 inline-flex items-center gap-1 text-sm font-bold text-sun hover:underline" href={cfg.faucetUrl} target="_blank" rel="noreferrer">Top up with test MON <ArrowUpRightIcon className="h-4 w-4" /></a>}
        </div>

        <div className="panel p-7">
          <h2 className="text-lg font-extrabold">Your games</h2>
          {!key ? (
            <p className="mt-4 text-sm text-muted">Enter your admin key to manage your games.</p>
          ) : games.error ? (
            <p className="mt-4 text-sm text-rose">{(games.error as Error).message}</p>
          ) : !games.data?.games.length ? (
            <p className="mt-4 text-sm text-muted">No games yet — create your first one.</p>
          ) : (
            <ul className="mt-2 divide-y divide-line">
              {games.data.games.slice(0, 12).map((g) => {
                const live = now >= g.startTime * 1000 && now < g.endTime * 1000 && g.status !== "cancelled";
                const status: GameStatus = g.status === "cancelled" ? "cancelled" : live ? "live" : now >= g.endTime * 1000 ? "finished" : g.status;
                const round = live ? Math.min(g.roundsCount, Math.floor(((now / 1000 - g.startTime) / (g.endTime - g.startTime)) * g.roundsCount) + 1) : undefined;
                const open = status === "registration_open" || status === "starting_soon";
                return (
                  <li key={g.id} className="py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-bold">{g.name}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-2.5 text-sm text-muted">
                          <StatusPill status={status} />
                          {open && <span>{clockTime(g.startTime)} · {Number(g.poolMon ?? 0).toFixed(3)} MON</span>}
                          {live && <span>Round {round} of {g.roundsCount}</span>}
                          {status === "finished" && g.finalizeState === "done" && <span>{g.winnersCount} winner{g.winnersCount === 1 ? "" : "s"}</span>}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        {open && (
                          <button className="btn-danger px-4 py-2 text-sm" disabled={!!busy} onClick={() => confirm(`Cancel “${g.name}”? Joined players can refund any entry fee.`) && act("cancel", async () => { await api(`/admin/games/${g.id}/cancel`, { adminKey: key, body: {} }); return `Cancelled “${g.name}”. Withdraw its pool below.`; })}>Cancel</button>
                        )}
                        {status === "finished" && g.finalizeState !== "done" && (
                          <button className="btn-ghost px-4 py-2 text-sm" disabled={!!busy} onClick={() => act("fin", async () => { await api(`/admin/games/${g.id}/finalize`, { adminKey: key, body: {} }); return "Results published on-chain."; })}>Publish</button>
                        )}
                        {status === "finished" && g.finalizeState === "done" && <Link className="btn-ghost px-4 py-2 text-sm" to={`/games/${g.id}/results`}>Results</Link>}
                        {g.withdrawableMon && Number(g.withdrawableMon) >= 0.0005 && (
                          <button className="btn-ghost px-4 py-2 text-sm text-mint" disabled={!!busy} onClick={() => act("wd", async () => { await api(`/admin/games/${g.id}/withdraw`, { adminKey: key, body: {} }); return `Withdrew ${g.withdrawableMon} MON to the operator wallet.`; })}>Withdraw {Number(g.withdrawableMon).toFixed(3)}</button>
                        )}
                        <button className="text-xs text-muted underline" onClick={async () => setPreview({ name: g.name, rounds: (await api<{ rounds: any[] }>(`/admin/games/${g.id}/rounds`, { adminKey: key })).rounds })}>Preview cards</button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>

      {preview && (
        <section className="panel p-7 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-extrabold">{preview.name} — cards &amp; answers <span className="text-sm font-normal text-muted">(host only)</span></h2>
            <button className="text-sm underline" onClick={() => setPreview(null)}>Close</button>
          </div>
          <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {preview.rounds.map((r) => (
              <div key={r.roundIndex}>
                <img src={r.photo} alt="" className="w-full rounded-2xl" />
                <p className="mt-3 text-sm font-bold">{r.roundIndex + 1}. {r.question} <span className="font-normal text-muted">Answer: {r.options[r.correctIndex]}</span></p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
