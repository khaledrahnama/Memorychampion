import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, getToken, type GameDetail } from "../lib/api";
import { useAppConfig, useMe, useNow } from "../lib/hooks";
import { getPhase, phaseKey, type Phase } from "../lib/schedule";
import { serverNow } from "../lib/clock";
import { clockTime, formatCountdown, mon, shortHash } from "../lib/format";
import { JoinButton } from "../components/JoinButton";
import { Avatar, LogoMark } from "../components/Brand";
import { ArrowUpRightIcon, CheckIcon, EyeIcon, RefreshIcon, UsersIcon } from "../components/Icons";

interface PlayState {
  registered: boolean;
  phase: Phase;
  photo?: string;
  question?: string;
  options?: { id: number; text: string }[];
  myAnswer?: number | null;
}

interface GameResponse {
  game: GameDetail;
  players: { nickname: string; isMe: boolean }[];
}

function TimerBar({ startsAt, endsAt, now }: { startsAt: number; endsAt: number; now: number }) {
  const left = Math.max(0, endsAt - now);
  return (
    <div className="flex items-center gap-5">
      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-raised">
        <div className="h-full rounded-full bg-sun transition-[width] duration-100 ease-linear" style={{ width: `${(left / (endsAt - startsAt)) * 100}%` }} />
      </div>
      <span className="w-10 text-right font-display text-2xl font-bold text-sun tabular-nums">{Math.ceil(left / 1000)}s</span>
    </div>
  );
}

function Ring({ remainingMs }: { remainingMs: number }) {
  // The ring drains once per minute; in the final minute it counts down to the start.
  const r = 175;
  const c = 2 * Math.PI * r;
  const frac = remainingMs <= 0 ? 0 : ((remainingMs - 1) % 60_000) / 60_000;
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[380px]">
      <svg viewBox="0 0 400 400" className="h-full w-full -rotate-90">
        <circle cx="200" cy="200" r={r} fill="none" stroke="#221D38" strokeWidth="14" />
        <circle cx="200" cy="200" r={r} fill="none" stroke="#F5B83D" strokeWidth="14" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - frac)} className="transition-[stroke-dashoffset] duration-500" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`font-display font-black leading-none text-sun tabular-nums ${remainingMs >= 3_600_000 ? "text-[44px] sm:text-[52px]" : "text-[60px] sm:text-[78px]"}`}>{formatCountdown(remainingMs)}</span>
        <span className="mt-3 text-[15px] text-cream/75">until the cards flip</span>
      </div>
    </div>
  );
}

/** Full-screen play chrome: game name, round progress, player. */
function PlayShell({ game, round, children }: { game: GameDetail; round: number; children: React.ReactNode }) {
  const { data: me } = useMe();
  const squares = Array.from({ length: game.roundsCount }, (_, i) => i);
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-ink">
      <header className="border-b border-line/70">
        <div className="mx-auto flex max-w-[1260px] items-center gap-4 px-5 py-3.5 sm:px-8">
          <LogoMark className="hidden h-8 w-8 sm:block" />
          <div className="min-w-0 leading-tight">
            <p className="truncate font-display text-[17px] font-extrabold sm:text-[19px]">{game.name}</p>
            <p className="hidden text-sm text-muted sm:block">Round {round} of {game.roundsCount}</p>
          </div>
          <div className="mx-auto hidden gap-2 sm:flex">
            {squares.map((i) => (
              <span key={i} className={`h-8 w-7 rounded-md border ${i + 1 < round ? "border-violet bg-violet" : i + 1 === round ? "border-sun bg-sun-soft" : "border-line bg-panel"}`} />
            ))}
          </div>
          <span className="ml-auto font-display text-lg font-bold text-sun sm:hidden">{round} / {game.roundsCount}</span>
          <span className="hidden items-center gap-2 rounded-full border border-violet/60 bg-violet-soft py-1 pl-1 pr-4 text-sm font-bold sm:flex">
            <Avatar name={me?.nickname} className="h-7 w-7 text-xs" />
            {me?.nickname} <span className="text-violet-light">· you</span>
          </span>
        </div>
        <div className="flex gap-1.5 px-5 pb-3 sm:hidden">
          {squares.map((i) => (
            <span key={i} className={`h-1.5 flex-1 rounded-full ${i + 1 < round ? "bg-violet" : i + 1 === round ? "bg-sun" : "bg-raised"}`} />
          ))}
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1000px] px-5 py-8 sm:py-10">{children}</main>
    </div>
  );
}

export function GamePage() {
  const { gameId } = useParams<{ gameId: string }>();
  const cfg = useAppConfig();
  const navigate = useNavigate();
  const now = useNow(100);

  const { data, error } = useQuery({
    queryKey: ["game", gameId, !!getToken()],
    queryFn: () => api<GameResponse>(`/games/${gameId}`),
    refetchInterval: (q) => ((q.state.data?.game.startTime ?? 0) * 1000 > serverNow() ? 4_000 : false)
  });
  const game = data?.game;
  const phase = game ? getPhase(game, now) : null;
  const key = phase ? phaseKey(phase) : "";

  const [play, setPlay] = useState<PlayState | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [answerErr, setAnswerErr] = useState<string | null>(null);
  const seq = useRef(0);

  // Fetch the round's content the moment the synced clock enters a new
  // photo/question window (the server releases it only inside that window).
  useEffect(() => {
    if (!game || !phase || !getToken()) return;
    if (phase.phase !== "photo" && phase.phase !== "question") return;
    const mySeq = ++seq.current;
    setSelected(null);
    setAnswerErr(null);
    let tries = 0;
    const load = async () => {
      try {
        const s = await api<PlayState>(`/games/${game.id}/play`);
        if (mySeq !== seq.current) return;
        if (phaseKey(s.phase) !== key && tries++ < 8) return void setTimeout(load, 150);
        setPlay(s);
        if (s.myAnswer !== undefined && s.myAnswer !== null) setSelected(s.myAnswer);
      } catch {
        if (mySeq === seq.current && tries++ < 8) setTimeout(load, 300);
      }
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, game?.id]);

  useEffect(() => {
    if (phase?.phase === "finished" && game?.joined) {
      const t = setTimeout(() => navigate(`/games/${game.id}/results`), 1500);
      return () => clearTimeout(t);
    }
  }, [phase?.phase, game?.joined, game?.id, navigate]);

  async function answer(optionId: number) {
    if (!game || phase?.phase !== "question") return;
    setSelected(optionId);
    setAnswerErr(null);
    try {
      await api(`/games/${game.id}/answer`, { body: { roundIndex: phase.roundIndex, optionIndex: optionId } });
    } catch (e) {
      setAnswerErr((e as Error).message);
    }
  }

  if (error) return <div className="panel p-10 text-rose">{(error as Error).message}</div>;
  if (!game || !phase) return <div className="panel p-10 text-muted">Loading game…</div>;

  // ---------------- Lobby ----------------
  if (phase.phase === "waiting") {
    const players = data!.players;
    const total = Math.max(game.participantCount ?? 0, players.length);
    return (
      <div className="grid gap-6 lg:grid-cols-[1.45fr_1fr]">
        <section className="panel p-6 sm:p-10">
          {game.joined ? (
            <div className="flex items-center justify-between gap-3 rounded-2xl bg-mint-soft px-5 py-3.5">
              <span className="flex items-center gap-2.5 font-bold text-mint"><CheckIcon className="h-5 w-5" /> You're in. Registered on-chain.</span>
              {game.myJoinTx && (
                cfg.explorerUrl ? (
                  <a className="inline-flex items-center gap-1 font-mono text-sm text-violet-light hover:underline" href={`${cfg.explorerUrl}/tx/${game.myJoinTx}`} target="_blank" rel="noreferrer">
                    {shortHash(game.myJoinTx)} <ArrowUpRightIcon className="h-4 w-4" />
                  </a>
                ) : (
                  <span className="font-mono text-sm text-violet-light">{shortHash(game.myJoinTx)}</span>
                )
              )}
            </div>
          ) : null}
          <p className="caps mt-8 text-center">Lobby</p>
          <h1 className="font-display mt-2 text-center text-[36px] font-extrabold leading-tight sm:text-[44px]">{game.name}</h1>
          <div className="mt-8"><Ring remainingMs={phase.endsAt - now} /></div>
          <p className="mt-8 text-center text-[16px] text-cream/75">
            Everyone starts at <span className="font-mono text-cream">{clockTime(game.startTime, true)}</span>: same card, same second.
          </p>
          {!game.joined && game.status !== "cancelled" && (
            <div className="mt-8 flex justify-center"><JoinButton game={game} /></div>
          )}
        </section>

        <aside className="space-y-6">
          <div className="panel p-7">
            <p className="caps">Prize pool</p>
            <p className="mt-2 font-mono text-[42px] font-bold leading-none text-sun">{mon(game.poolWei)} MON</p>
            <p className="mt-3 text-cream/75">Split between every perfect {game.roundsCount} / {game.roundsCount}.</p>
          </div>
          <div className="panel p-7">
            <h2 className="text-lg font-extrabold">How it plays</h2>
            <ol className="mt-5 space-y-5">
              {[
                ["Look", `A memory card appears for ${game.photoSeconds} seconds.`],
                ["Answer", `One question about it: 4 choices, ${game.questionSeconds} seconds.`],
                ["Repeat", `${game.roundsCount} rounds. Score ${game.roundsCount} / ${game.roundsCount} to share the pool.`]
              ].map(([t, d], i) => (
                <li key={t} className="flex gap-4">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-raised font-display font-bold text-sun">{i + 1}</span>
                  <span><b className="block">{t}</b><span className="text-sm text-cream/70">{d}</span></span>
                </li>
              ))}
            </ol>
          </div>
          <div className="panel p-7">
            <h2 className="flex items-center gap-2 text-lg font-extrabold"><UsersIcon className="h-5 w-5 text-muted" /> {total} player{total === 1 ? "" : "s"} joined</h2>
            <div className="mt-5 flex flex-wrap gap-2">
              {players.slice(0, 11).map((p) => (
                <span key={p.nickname} className={`flex items-center gap-2 rounded-full border py-1 pl-1 pr-3.5 text-sm font-bold ${p.isMe ? "border-violet bg-violet-soft" : "border-line bg-raised/50"}`}>
                  <span className={`grid h-7 w-7 place-items-center rounded-full text-xs ${p.isMe ? "bg-violet text-white" : "bg-raised text-muted"}`}>{p.nickname.slice(0, 1).toUpperCase()}</span>
                  {p.nickname}{p.isMe && <span className="text-violet-light">· you</span>}
                </span>
              ))}
              {total > Math.min(players.length, 11) && <span className="px-3 py-1.5 text-sm text-muted">+{total - Math.min(players.length, 11)} more</span>}
              {total === 0 && <span className="text-sm text-muted">Be the first to join.</span>}
            </div>
          </div>
          <p className="flex gap-3 px-2 text-sm text-cream/70"><RefreshIcon className="h-5 w-5 shrink-0 text-muted" /> Refreshing won't restart anything. You rejoin exactly where the game is.</p>
        </aside>
      </div>
    );
  }

  // ---------------- Finished ----------------
  if (phase.phase === "finished") {
    return (
      <div className="panel mx-auto max-w-lg p-10 text-center">
        <h1 className="font-display text-3xl font-extrabold">Game over</h1>
        <p className="mt-3 text-muted">{game.joined ? "Tallying scores and publishing results on-chain…" : "This game has finished."}</p>
        <Link className="btn-violet mt-6" to={`/games/${game.id}/results`}>See results</Link>
      </div>
    );
  }

  // ---------------- Live but not playing ----------------
  if (!getToken()) {
    return (
      <div className="panel mx-auto max-w-lg p-10 text-center">
        <h1 className="font-display text-3xl font-extrabold">{game.name} is live</h1>
        <Link className="btn-violet mt-6" to="/account">Sign in to play</Link>
      </div>
    );
  }
  if (play && !play.registered) {
    return (
      <div className="panel mx-auto max-w-lg p-10 text-center">
        <h1 className="font-display text-3xl font-extrabold">{game.name} is live</h1>
        <p className="mt-3 text-muted">Registration closed when the game started, so you can't enter this one. Join an upcoming game instead.</p>
        <Link className="btn-violet mt-6" to="/">Upcoming games</Link>
      </div>
    );
  }

  const ready = play && phaseKey(play.phase) === key;
  const round = phase.roundIndex + 1;

  // ---------------- Photo ----------------
  if (phase.phase === "photo") {
    return (
      <PlayShell game={game} round={round}>
        <p className="flex items-center justify-center gap-2 text-sm font-extrabold uppercase tracking-[0.16em] text-sun"><EyeIcon className="h-5 w-5" /> Memorize</p>
        <div className="mx-auto mt-6 max-w-[800px]">
          <div className="aspect-[3/2] overflow-hidden rounded-[28px] bg-[#F5F0E3] shadow-[0_40px_80px_-20px_rgba(108,71,255,0.25)]">
            {ready && play.photo ? (
              <img src={play.photo} alt="Memory card — memorize it" className="h-full w-full select-none object-cover" draggable={false} />
            ) : (
              <div className="grid h-full place-items-center text-ink/50">Loading card…</div>
            )}
          </div>
          <div className="mt-7"><TimerBar startsAt={phase.startsAt} endsAt={phase.endsAt} now={now} /></div>
        </div>
      </PlayShell>
    );
  }

  // ---------------- Question ----------------
  return (
    <PlayShell game={game} round={round}>
      <div className="mx-auto max-w-[940px]">
        <p className="text-left text-sm font-extrabold uppercase tracking-[0.16em] text-sun sm:text-center">Answer from memory</p>
        <h1 className="font-display mt-4 text-left text-[34px] font-extrabold leading-[1.05] sm:text-center sm:text-[52px]">{ready ? play.question : "…"}</h1>
        <div className="mt-8 grid gap-3 sm:mt-10 sm:grid-cols-2 sm:gap-4">
          {ready &&
            play.options?.map((o, i) => {
              const on = selected === o.id;
              return (
                <button
                  key={o.id}
                  onClick={() => answer(o.id)}
                  className={`flex items-center gap-4 rounded-2xl border-2 px-5 py-4 text-left transition sm:px-7 sm:py-6 ${on ? "border-violet-light bg-violet-soft" : "border-line bg-panel hover:border-violet/50"}`}
                >
                  <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl font-mono font-bold ${on ? "bg-violet text-white" : "bg-raised text-muted"}`}>{String.fromCharCode(65 + i)}</span>
                  <span className="font-display flex-1 text-[26px] font-extrabold sm:text-[34px]">{o.text}</span>
                  {on && (<span className="flex items-center gap-1.5 text-sm font-bold text-violet-light"><CheckIcon className="h-4 w-4" /><span className="hidden sm:inline">Locked in</span></span>)}
                </button>
              );
            })}
        </div>
        <p className="mt-7 text-left text-[15px] text-cream/70 sm:text-center">
          {answerErr ? <span className="text-rose">{answerErr}</span> : selected !== null ? "Locked in. You can change it until time runs out." : "You can change your answer until time runs out."}
        </p>
        <div className="mt-6"><TimerBar startsAt={phase.startsAt} endsAt={phase.endsAt} now={now} /></div>
      </div>
    </PlayShell>
  );
}
