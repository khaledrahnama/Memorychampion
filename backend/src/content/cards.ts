// Procedural "memory cards" (design: Game content → Memory cards).
// Each round gets a fresh card: two sticker groups (a color + a shape, 1–5
// stickers each) and a badge number. The question is generated from the same
// card, so the correct answer is always exactly right.
import { randomInt } from "node:crypto";

export const COLORS = {
  red: "#E5484D",
  blue: "#3E63DD",
  green: "#2F9E62",
  yellow: "#F5C518",
  purple: "#8E4EC6",
  orange: "#F76B15"
} as const;
export type Color = keyof typeof COLORS;
export const SHAPES = ["circle", "square", "triangle", "star", "diamond", "heart"] as const;
export type Shape = (typeof SHAPES)[number];

const INK = "#1B1530";
const CREAM = "#F5F0E3";
const W = 600;
const H = 400;

export interface Group {
  color: Color;
  shape: Shape;
  count: number;
}
export interface CardSpec {
  groups: [Group, Group];
  badge: number;
  stickers: { color: Color; shape: Shape; x: number; y: number; r: number; rot: number }[];
}
export interface CardQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  kind: "count" | "shape" | "color" | "badge";
}

type Rng = (maxExclusive: number) => number;
const cryptoRng: Rng = (n) => randomInt(n);

const pick = <T>(arr: readonly T[], rng: Rng) => arr[rng(arr.length)];
function shuffle<T>(arr: T[], rng: Rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const plural = (s: Shape) => `${s}s`;

// ---------- Layout ----------

export function makeCard(rng: Rng = cryptoRng): CardSpec {
  const colors = shuffle(Object.keys(COLORS) as Color[], rng);
  const shapes = shuffle([...SHAPES], rng);
  const groups: [Group, Group] = [
    { color: colors[0], shape: shapes[0], count: 1 + rng(5) },
    { color: colors[1], shape: shapes[1], count: 1 + rng(5) }
  ];

  // 5x3 grid of cells; the top-right cell holds the badge.
  const cols = 5;
  const rows = 3;
  const cellW = (W - 60) / cols;
  const cellH = (H - 60) / rows;
  const cells: [number, number][] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (!(r === 0 && c === cols - 1)) cells.push([c, r]);
  const chosen = shuffle(cells, rng);

  const stickers: CardSpec["stickers"] = [];
  let i = 0;
  for (const g of groups) {
    for (let k = 0; k < g.count; k++) {
      const [c, r] = chosen[i++];
      const radius = 30 + rng(9);
      const jitterX = rng(Math.max(1, Math.floor(cellW - 2 * radius - 16))) - (cellW - 2 * radius - 16) / 2;
      const jitterY = rng(Math.max(1, Math.floor(cellH - 2 * radius - 16))) - (cellH - 2 * radius - 16) / 2;
      stickers.push({
        color: g.color,
        shape: g.shape,
        x: 30 + cellW * (c + 0.5) + jitterX,
        y: 30 + cellH * (r + 0.5) + jitterY,
        r: radius,
        rot: g.shape === "circle" ? 0 : rng(31) - 15
      });
    }
  }
  return { groups, badge: 10 + rng(90), stickers };
}

// ---------- Drawing ----------

function shapePath(shape: Shape, r: number): string {
  switch (shape) {
    case "circle":
      return `<circle cx="0" cy="0" r="${(r * 0.9).toFixed(1)}"/>`;
    case "square": {
      const s = r * 1.55;
      return `<rect x="${(-s / 2).toFixed(1)}" y="${(-s / 2).toFixed(1)}" width="${s.toFixed(1)}" height="${s.toFixed(1)}" rx="${(r * 0.18).toFixed(1)}"/>`;
    }
    case "triangle":
      return `<polygon points="0,${(-r * 1.05).toFixed(1)} ${(r * 1.0).toFixed(1)},${(r * 0.75).toFixed(1)} ${(-r * 1.0).toFixed(1)},${(r * 0.75).toFixed(1)}"/>`;
    case "diamond":
      return `<polygon points="0,${(-r * 1.15).toFixed(1)} ${(r * 0.72).toFixed(1)},0 0,${(r * 1.15).toFixed(1)} ${(-r * 0.72).toFixed(1)},0"/>`;
    case "star": {
      const pts: string[] = [];
      for (let k = 0; k < 10; k++) {
        const rad = k % 2 === 0 ? r * 1.12 : r * 0.5;
        const a = -Math.PI / 2 + (k * Math.PI) / 5;
        pts.push(`${(rad * Math.cos(a)).toFixed(1)},${(rad * Math.sin(a)).toFixed(1)}`);
      }
      return `<polygon points="${pts.join(" ")}"/>`;
    }
    case "heart":
      return `<path d="M0,${(r * 0.95).toFixed(1)} C${(-r * 1.35).toFixed(1)},${(r * 0.05).toFixed(1)} ${(-r * 0.95).toFixed(1)},${(-r * 1.05).toFixed(1)} 0,${(-r * 0.4).toFixed(1)} C${(r * 0.95).toFixed(1)},${(-r * 1.05).toFixed(1)} ${(r * 1.35).toFixed(1)},${(r * 0.05).toFixed(1)} 0,${(r * 0.95).toFixed(1)} Z"/>`;
  }
}

export function renderCard(card: CardSpec): string {
  const stickers = card.stickers
    .map((s) => {
      const path = shapePath(s.shape, s.r);
      return (
        `<g transform="translate(${s.x.toFixed(1)} ${s.y.toFixed(1)}) rotate(${s.rot})">` +
        `<g transform="translate(4 5)" fill="${INK}" stroke="${INK}" stroke-width="5" stroke-linejoin="round">${path}</g>` +
        `<g fill="${COLORS[s.color]}" stroke="${INK}" stroke-width="5" stroke-linejoin="round">${path}</g>` +
        `</g>`
      );
    })
    .join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">` +
    `<defs><pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="11" cy="11" r="1.6" fill="#DDD3BD"/></pattern></defs>` +
    `<rect width="${W}" height="${H}" fill="${CREAM}"/><rect width="${W}" height="${H}" fill="url(#dots)"/>` +
    stickers +
    `<rect x="${W - 132}" y="26" width="104" height="70" rx="12" fill="${INK}"/>` +
    `<text x="${W - 80}" y="75" text-anchor="middle" font-family="Arial Black, Arial, Helvetica, sans-serif" font-weight="900" font-size="40" fill="${CREAM}">${card.badge}</text>` +
    `</svg>`
  );
}

export const cardDataUri = (card: CardSpec) => `data:image/svg+xml;base64,${Buffer.from(renderCard(card)).toString("base64")}`;

// ---------- Questions ----------

function numberOptions(correct: number, min: number, max: number, rng: Rng): string[] {
  // Four consecutive numbers containing the answer, e.g. 2 3 4 5.
  const lowest = Math.max(min, Math.min(correct - rng(4), max - 3));
  return [0, 1, 2, 3].map((k) => String(lowest + k));
}

function badgeOptions(n: number, rng: Rng): string[] {
  const out = new Set<number>([n]);
  const swapped = (n % 10) * 10 + Math.floor(n / 10);
  if (swapped !== n && swapped >= 10) out.add(swapped);
  while (out.size < 4) {
    const delta = (1 + rng(9)) * (rng(2) ? 1 : -1);
    const candidate = n + delta;
    if (candidate >= 10 && candidate <= 99) out.add(candidate);
  }
  return [...out].sort((a, b) => a - b).map(String);
}

export function makeQuestion(card: CardSpec, rng: Rng = cryptoRng): CardQuestion {
  const [a, b] = card.groups;
  const g = rng(2) ? a : b;
  const other = g === a ? b : a;
  const kind = pick(["count", "count", "shape", "color", "badge"] as const, rng);

  let question: string;
  let options: string[];
  let answer: string;

  if (kind === "count") {
    question = `How many ${g.color} ${plural(g.shape)} were on the card?`;
    options = numberOptions(g.count, 1, 7, rng);
    answer = String(g.count);
  } else if (kind === "shape") {
    question = `Which shape was ${g.color}?`;
    const distractors = shuffle(SHAPES.filter((s) => s !== g.shape && s !== other.shape), rng).slice(0, 2);
    options = [g.shape, other.shape, ...distractors].map(cap);
    answer = cap(g.shape);
  } else if (kind === "color") {
    question = g.count === 1 ? `What color was the ${g.shape}?` : `What color were the ${plural(g.shape)}?`;
    const distractors = shuffle((Object.keys(COLORS) as Color[]).filter((c) => c !== g.color && c !== other.color), rng).slice(0, 2);
    options = [g.color, other.color, ...distractors].map(cap);
    answer = cap(g.color);
  } else {
    question = "What number was on the badge?";
    options = badgeOptions(card.badge, rng);
    answer = String(card.badge);
  }

  // Canonical order (numbers ascending, words alphabetical); players get their own shuffle.
  options = kind === "count" || kind === "badge" ? options : [...options].sort();
  return { question, options, correctIndex: options.indexOf(answer), kind };
}

/** `count` rounds, each with a fresh card and one question about it. */
export function pickRounds(count: number) {
  return Array.from({ length: count }, () => {
    const card = makeCard();
    const q = makeQuestion(card);
    return { sceneId: `card:${q.kind}`, photo: cardDataUri(card), question: q.question, options: q.options, correctIndex: q.correctIndex };
  });
}
