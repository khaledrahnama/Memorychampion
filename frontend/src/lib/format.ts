import { formatEther } from "viem";
import type { GameStatus } from "./api";

/** Fixed-decimal MON amount, e.g. "0.500" (no unit). */
export function mon(wei: string | bigint | null | undefined, decimals = 3) {
  if (wei === null || wei === undefined) return "—";
  const [whole, frac = ""] = formatEther(BigInt(wei)).split(".");
  const f = (frac + "0".repeat(decimals)).slice(0, decimals);
  return decimals > 0 ? `${whole}.${f}` : whole;
}

/** Trimmed MON amount with unit, e.g. "0.1666 MON". */
export function formatMon(wei: string | bigint | null | undefined, maxDecimals = 4) {
  if (wei === null || wei === undefined) return "—";
  const [whole, frac = ""] = formatEther(BigInt(wei)).split(".");
  const trimmed = frac.slice(0, maxDecimals).replace(/0+$/, "");
  return `${whole}${trimmed ? "." + trimmed : ""} MON`;
}

export function shortAddress(a?: string | null) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "";
}

export function shortHash(h?: string | null) {
  return h ? `${h.slice(0, 6)}…${h.slice(-4)}` : "";
}

/** 02:41 under an hour, 1:02:41 under a day, then "2d 03:04:05". */
export function formatCountdown(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (d > 0) return `${d}d ${pad(h)}:${pad(m)}:${pad(s)}`;
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

export const clockTime = (unixSeconds: number, seconds = false) =>
  new Date(unixSeconds * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}) });

/** "Today, 21:30" · "Tomorrow, 12:30" · "Sat 3 Oct, 18:00" — in the player's timezone. */
export function formatDay(unixSeconds: number) {
  const date = new Date(unixSeconds * 1000);
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const day = same(date, today)
    ? "Today"
    : same(date, tomorrow)
      ? "Tomorrow"
      : same(date, yesterday)
        ? "Yesterday"
        : date.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
  return `${day}, ${clockTime(unixSeconds)}`;
}

export const STATUS_LABEL: Record<GameStatus, string> = {
  registration_open: "Registration open",
  starting_soon: "Starting soon",
  live: "Live",
  finished: "Finished",
  cancelled: "Cancelled"
};

const CHAIN_NAMES: Record<number, string> = {
  1: "Ethereum Mainnet",
  11155111: "Sepolia",
  10143: "Monad Testnet",
  143: "Monad",
  31337: "Local Hardhat",
  1337: "Localhost 1337",
  137: "Polygon",
  8453: "Base",
  42161: "Arbitrum",
  10: "Optimism"
};
export const chainLabel = (id?: number) => (id ? CHAIN_NAMES[id] ?? `chain ${id}` : "no network");

/** Turns wallet/viem errors into something a player can act on. */
export function friendlyError(err: unknown): string {
  const e = err as { shortMessage?: string; message?: string; details?: string };
  const msg = `${e?.shortMessage ?? ""} ${e?.details ?? ""} ${e?.message ?? String(err)}`;
  if (/user rejected|user denied|rejected the request|denied transaction/i.test(msg)) return "You cancelled the request in MetaMask.";
  if (/already pending|request of type .* already pending/i.test(msg)) return "MetaMask already has a request open — click the MetaMask icon in your browser toolbar to finish it.";
  if (/insufficient funds/i.test(msg)) return "Not enough MON in this wallet to pay the network fee.";
  if (/nonce too (high|low)|invalid nonce/i.test(msg))
    return "MetaMask's transaction history is out of date (this happens after restarting the local chain). In MetaMask: Settings → Advanced → Clear activity tab data, then try again.";
  if (/unrecognized chain|chain .* not (been )?added|4902/i.test(msg)) return "MetaMask doesn't know this network yet — press Switch network to add it.";
  if (/registration closed/i.test(msg)) return "Registration for this game has closed.";
  if (/already registered/i.test(msg)) return "This wallet is already registered for this game.";
  if (/already claimed/i.test(msg)) return "You've already claimed this reward.";
  if (/connector not connected|not connected/i.test(msg)) return "Your wallet isn't connected. Connect MetaMask and try again.";
  const clean = (e?.shortMessage ?? e?.message ?? String(err)).split("\n")[0];
  return clean.length > 180 ? clean.slice(0, 180) + "…" : clean;
}
