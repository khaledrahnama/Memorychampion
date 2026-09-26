import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, getToken, type GameStatus, type GameSummary } from "../lib/api";
import { useNow } from "../lib/hooks";
import { getPhase } from "../lib/schedule";
import { clockTime, formatCountdown, formatDay, mon } from "../lib/format";
import { JoinButton } from "../components/JoinButton";
import { CardStack, StatusPill } from "../components/Brand";
import { CheckIcon, ClockIcon, CoinIcon, LayersIcon, SparkleIcon, UsersIcon } from "../components/Icons";

/** Status as of `now` (the list is fetched every few seconds, the clock ticks every second). */
function liveStatus(g: GameSummary, now: number): GameStatus {
  if (g.status === "cancelled") return "cancelled";
  if (now >= g.endTime * 1000) return "finished";
  if (now >= g.startTime * 1000) return "live";
  return g.startTime * 1000 - now <= 10 * 60 * 1000 ? "starting_soon" : "registration_open";
}

function currentRound(g: GameSummary, now: number) {
  const p = getPhase(g, now);
  return p.phase === "photo" || p.phase === "question" ? p.roundIndex + 1 : undefined;
}

function Hero({ game, now }: { game: GameSummary; now: number }) {
  const [howOpen, setHowOpen] = useState(false);
  const status = liveStatus(game, now);
  const fee = BigInt(game.entryFeeWei);
  const open = status === "registration_open" || status === "starting_soon";

  return (
    <section className="panel relative overflow-hidden p-7 sm:p-11">
      <div className="grid items-center gap-10 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <StatusPill status={status} round={currentRound(game, now)} rounds={game.roundsCount} />
            <span className="caps">{open ? "Next game" : status === "live" ? "Happening now" : "Game"}</span>
          </div>
          <h1 className="font-display mt-5 text-[44px] font-extrabold leading-[0.95] sm:text-[64px]">{game.name}</h1>
          <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-[15px] text-cream/80">
            <span className="inline-flex items-center gap-2"><ClockIcon className="h-[18px] w-[18px] text-muted" />{formatDay(game.startTime)}</span>
            <span className="inline-flex items-center gap-2"><LayersIcon className="h-[18px] w-[18px] text-muted" />{game.roundsCount} rounds</span>
            <span className="inline-flex items-center gap-2"><UsersIcon className="h-[18px] w-[18px] text-muted" />{game.participantCount ?? 0} joined</span>
            <span className="inline-flex items-center gap-2"><CoinIcon className="h-[18px] w-[18px] text-muted" />{fee > 0n ? `${mon(fee, 2)} MON entry` : "Free entry"}</span>
          </div>

          {open ? (
            <>
              <p className="caps mt-8">Cards flip in</p>
              <p className="font-display mt-1 text-[76px] font-black leading-none text-sun tabular-nums sm:text-[112px]">{formatCountdown(game.startTime * 1000 - now)}</p>
            </>
          ) : (
            <p className="font-display mt-8 text-4xl font-extrabold text-sun">Round {currentRound(game, now) ?? game.roundsCount} of {game.roundsCount}</p>
          )}

          <div className="mt-8 flex flex-wrap items-start gap-3">
            {game.joined ? (
              <Link to={`/games/${game.id}`} className={`${status === "live" ? "btn-sun" : "btn-violet"} min-w-[150px] py-3.5 text-[16px]`}>
                {status === "live" ? "Back to the game" : "Enter lobby"}
              </Link>
            ) : open ? (
              <JoinButton game={game} hideNote />
            ) : null}
            <button className="btn-ghost py-3.5 text-[16px]" onClick={() => setHowOpen((v) => !v)}>How it works</button>
          </div>
          {open && !game.joined && (
            <p className="mt-4 max-w-md text-sm text-muted">
              Joining sends one transaction from your wallet. {fee > 0n ? `Entry is ${mon(fee, 2)} MON, plus network gas.` : "Free entry, so you only pay network gas."}
            </p>
          )}
          {howOpen && (
            <ol className="mt-6 grid gap-3 text-sm sm:grid-cols-3">
              {[
                ["Look", `A memory card appears for ${game.photoSeconds} seconds.`],
                ["Answer", `One question about it, ${game.questionSeconds} seconds to answer.`],
                ["Repeat", `${game.roundsCount} rounds. Score ${game.roundsCount} / ${game.roundsCount} to share the pool.`]
              ].map(([t, d], i) => (
                <li key={t} className="rounded-2xl border border-line bg-raised/50 p-4">
                  <span className="grid h-7 w-7 place-items-center rounded-lg bg-raised font-display font-bold text-sun">{i + 1}</span>
                  <p className="mt-2 font-bold">{t}</p>
                  <p className="text-muted">{d}</p>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="space-y-8">
          <div className="rounded-3xl border border-line bg-raised/40 p-6 sm:p-7">
            <p className="caps">Prize pool</p>
            <p className="mt-2 font-mono text-[42px] font-bold leading-none text-sun sm:text-[52px]">{mon(game.poolWei)} MON</p>
            <p className="mt-4 text-[15px] text-cream/75">Split equally between everyone who scores {game.roundsCount} / {game.roundsCount}.</p>
          </div>
          <CardStack />
        </div>
      </div>
    </section>
  );
}

function GameCard({ game, now }: { game: GameSummary; now: number }) {
  const status = liveStatus(game, now);
  const fee = BigInt(game.entryFeeWei);
  const open = status === "registration_open" || status === "starting_soon";
  const when = status === "live" ? `Started ${clockTime(game.startTime)}` : formatDay(game.startTime);

  return (
    <div className="panel flex flex-col p-6">
      <div className="flex items-center justify-between gap-3">
        <StatusPill status={status} round={currentRound(game, now)} rounds={game.roundsCount} />
        <span className="text-sm text-muted">{when}</span>
      </div>
      <h3 className="font-display mt-5 text-[24px] font-extrabold leading-tight">{game.name}</h3>
      <div className="mt-5 grid grid-cols-3 gap-2">
        <div><p className="caps !text-[11px]">Prize</p><p className="mt-1 font-mono text-lg text-sun">{mon(game.poolWei)}</p></div>
        <div><p className="caps !text-[11px]">Players</p><p className="mt-1 font-mono text-lg">{game.participantCount ?? 0}</p></div>
        <div><p className="caps !text-[11px]">Entry</p><p className="mt-1 font-mono text-lg">{fee > 0n ? mon(fee, 2) : "Free"}</p></div>
      </div>

      <p className="mt-5 flex min-h-[24px] items-center gap-2 text-[15px] text-cream/80">
        {status === "live" && game.joined && (<><CheckIcon className="h-4 w-4 text-mint" /> You're playing</>)}
        {status === "live" && !game.joined && <span className="text-muted">Registration closed</span>}
        {open && (<><ClockIcon className="h-4 w-4 text-muted" /> Starts in <span className="font-mono">{formatCountdown(game.startTime * 1000 - now)}</span></>)}
        {status === "finished" && game.finalized && (
          <>
            <SparkleIcon className="h-4 w-4 text-sun" />
            {game.winnersCount
              ? `${game.winnersCount} winner${game.winnersCount === 1 ? "" : "s"} · ${mon(game.rewardPerWinnerWei, 4)} MON each`
              : "No perfect scores this time"}
          </>
        )}
        {status === "finished" && !game.finalized && <span className="text-muted">Results being published…</span>}
        {status === "cancelled" && <span className="text-muted">Cancelled by the host</span>}
      </p>

      <div className="mt-5 pt-1">
        {status === "live" && game.joined ? (
          <Link to={`/games/${game.id}`} className="btn-sun w-full py-3.5">Back to the game</Link>
        ) : open && game.joined ? (
          <Link to={`/games/${game.id}`} className="btn-violet w-full py-3.5">Enter lobby</Link>
        ) : open ? (
          <JoinButton game={game} full />
        ) : status === "finished" ? (
          <Link to={`/games/${game.id}/results`} className="btn-ghost w-full py-3.5">View results</Link>
        ) : (
          <button className="btn-ghost w-full py-3.5" disabled>{status === "live" ? "In progress" : "Cancelled"}</button>
        )}
      </div>
    </div>
  );
}

type Tab = "upcoming" | "live" | "finished";

export function GamesPage() {
  const now = useNow(1000);
  const [tab, setTab] = useState<Tab>("upcoming");
  const { data, isLoading, error } = useQuery({
    queryKey: ["games", !!getToken()],
    queryFn: () => api<{ games: GameSummary[] }>("/games"),
    refetchInterval: 8_000
  });

  const games = data?.games ?? [];
  const withStatus = games.map((g) => ({ g, s: liveStatus(g, now) }));
  const upcoming = withStatus.filter((x) => x.s === "registration_open" || x.s === "starting_soon").map((x) => x.g);
  const live = withStatus.filter((x) => x.s === "live").map((x) => x.g);
  const finished = withStatus.filter((x) => x.s === "finished").map((x) => x.g).sort((a, b) => b.startTime - a.startTime);
  const hero = upcoming[0] ?? live.find((g) => g.joined) ?? live[0];
  const lists: Record<Tab, GameSummary[]> = { upcoming, live, finished };
  const shown = lists[tab];

  return (
    <div className="space-y-14">
      {isLoading && <div className="panel p-10 text-muted">Loading games…</div>}
      {error && <div className="panel p-10 text-rose">{(error as Error).message}</div>}
      {!isLoading && !error && hero && <Hero game={hero} now={now} />}
      {!isLoading && !error && !hero && (
        <section className="panel grid items-center gap-8 p-10 lg:grid-cols-2">
          <div>
            <span className="caps">Next game</span>
            <h1 className="font-display mt-4 text-5xl font-extrabold leading-none">No game scheduled yet</h1>
            <p className="mt-4 text-muted">Check back soon, or host one from the Host tab.</p>
            <Link to="/host" className="btn-violet mt-6">Host a game</Link>
          </div>
          <CardStack />
        </section>
      )}

      <section>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="font-display text-[32px] font-extrabold">All games</h2>
          <div className="flex rounded-2xl border border-line bg-panel p-1">
            {(["upcoming", "live", "finished"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`rounded-xl px-5 py-2.5 text-[15px] font-bold capitalize transition ${tab === t ? "bg-raised text-cream" : "text-muted hover:text-cream"}`}
              >
                {t}{lists[t].length ? <span className="ml-1.5 text-xs text-muted">{lists[t].length}</span> : null}
              </button>
            ))}
          </div>
        </div>
        {!shown.length ? (
          <div className="panel mt-6 p-10 text-center text-muted">
            {tab === "upcoming" ? "No upcoming games right now." : tab === "live" ? "No game is being played right now." : "No finished games yet."}
          </div>
        ) : (
          <div className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {shown.map((g) => <GameCard key={g.id} game={g} now={now} />)}
          </div>
        )}
      </section>
    </div>
  );
}
