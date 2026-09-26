// Mirror of backend/src/lib/schedule.ts — the game timeline is a pure function
// of the start time, so the browser can run the countdown and timer bars locally.

export interface Timing {
  startTime: number; // unix seconds
  roundsCount: number;
  photoSeconds: number;
  questionSeconds: number;
}

export type Phase =
  | { phase: "waiting"; endsAt: number }
  | { phase: "photo" | "question"; roundIndex: number; startsAt: number; endsAt: number }
  | { phase: "finished"; endedAt: number };

export function getPhase(g: Timing, nowMs: number): Phase {
  const startMs = g.startTime * 1000;
  const roundMs = (g.photoSeconds + g.questionSeconds) * 1000;
  if (nowMs < startMs) return { phase: "waiting", endsAt: startMs };
  const end = startMs + g.roundsCount * roundMs;
  if (nowMs >= end) return { phase: "finished", endedAt: end };
  const roundIndex = Math.floor((nowMs - startMs) / roundMs);
  const roundStart = startMs + roundIndex * roundMs;
  const photoEnd = roundStart + g.photoSeconds * 1000;
  if (nowMs < photoEnd) return { phase: "photo", roundIndex, startsAt: roundStart, endsAt: photoEnd };
  return { phase: "question", roundIndex, startsAt: photoEnd, endsAt: roundStart + roundMs };
}

export function phaseKey(p: Phase) {
  return p.phase === "photo" || p.phase === "question" ? `${p.phase}:${p.roundIndex}` : p.phase;
}
