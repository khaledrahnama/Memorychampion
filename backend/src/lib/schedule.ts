// The whole game timeline is a pure function of (start time, now). No server
// process has to "run" the game: every request — and every browser, after
// syncing its clock with the server — computes the same phase. That's what
// lets this run on stateless serverless functions, and why refreshing the page
// never restarts a game.

export interface GameTiming {
  start_time: number; // unix seconds
  rounds_count: number;
  photo_seconds: number;
  question_seconds: number;
}

export type Phase =
  | { phase: "waiting"; endsAt: number }
  | { phase: "photo"; roundIndex: number; startsAt: number; endsAt: number }
  | { phase: "question"; roundIndex: number; startsAt: number; endsAt: number }
  | { phase: "finished"; endedAt: number };

// Answers submitted slightly after a question closes still count, to absorb
// network latency between the player's click and the server.
export const ANSWER_GRACE_MS = 1500;

export function roundMs(g: GameTiming) {
  return (g.photo_seconds + g.question_seconds) * 1000;
}

export function gameEndMs(g: GameTiming) {
  return g.start_time * 1000 + g.rounds_count * roundMs(g);
}

export function getPhase(g: GameTiming, nowMs: number): Phase {
  const startMs = g.start_time * 1000;
  if (nowMs < startMs) return { phase: "waiting", endsAt: startMs };
  const end = gameEndMs(g);
  if (nowMs >= end) return { phase: "finished", endedAt: end };

  const roundIndex = Math.floor((nowMs - startMs) / roundMs(g));
  const roundStart = startMs + roundIndex * roundMs(g);
  const photoEnd = roundStart + g.photo_seconds * 1000;
  if (nowMs < photoEnd) return { phase: "photo", roundIndex, startsAt: roundStart, endsAt: photoEnd };
  return { phase: "question", roundIndex, startsAt: photoEnd, endsAt: roundStart + roundMs(g) };
}

/** Window in which an answer for `roundIndex` is accepted, in ms. */
export function answerWindow(g: GameTiming, roundIndex: number) {
  const roundStart = g.start_time * 1000 + roundIndex * roundMs(g);
  const opens = roundStart + g.photo_seconds * 1000;
  const closes = roundStart + roundMs(g);
  return { opens, closes: closes + ANSWER_GRACE_MS };
}

export type DisplayStatus = "registration_open" | "starting_soon" | "live" | "finished" | "cancelled";

const STARTING_SOON_MS = 10 * 60 * 1000;

export function displayStatus(g: GameTiming & { cancelled: boolean }, nowMs: number): DisplayStatus {
  if (g.cancelled) return "cancelled";
  const startMs = g.start_time * 1000;
  if (nowMs >= gameEndMs(g)) return "finished";
  if (nowMs >= startMs) return "live";
  if (startMs - nowMs <= STARTING_SOON_MS) return "starting_soon";
  return "registration_open";
}
