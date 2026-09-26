import { syncClock } from "./clock";

const TOKEN_KEY = "mmc_token";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable (private mode) — session-only login */
  }
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; adminKey?: string } = {}): Promise<T> {
  const token = getToken();
  const sentAt = Date.now();
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(opts.adminKey ? { "x-admin-key": opts.adminKey } : {})
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
    });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection and try again.");
  }
  const receivedAt = Date.now();
  const json = await res.json().catch(() => ({}));
  if (typeof json?.serverTime === "number") syncClock(json.serverTime, sentAt, receivedAt);
  if (res.status === 401 && token && !opts.adminKey) setToken(null);
  if (!res.ok) throw new ApiError(res.status, json?.error ?? `Request failed (${res.status})`);
  return json as T;
}

// ---- Types shared by pages ----

export type GameStatus = "registration_open" | "starting_soon" | "live" | "finished" | "cancelled";

export interface GameSummary {
  id: string;
  onchainGameId: number;
  name: string;
  startTime: number;
  endTime: number;
  roundsCount: number;
  photoSeconds: number;
  questionSeconds: number;
  entryFeeWei: string;
  status: GameStatus;
  finalized: boolean;
  winnersCount: number | null;
  rewardPerWinnerWei: string | null;
  poolWei: string | null;
  participantCount: number | null;
  onchainStatus: string | null;
  joined: boolean;
}

export interface Me {
  email: string;
  emailVerified: boolean;
  nickname: string | null;
  walletAddress: string | null;
  totalWonWei: string;
  claimableWei: string;
  claimableGames: { gameId: string; name: string; amountWei: string }[];
}

export interface AppConfig {
  chainId: number;
  chainName: string;
  rpcUrl: string;
  explorerUrl: string;
  contractAddress: `0x${string}` | null;
  operatorAddress: `0x${string}` | null;
  faucetUrl: string | null;
}

export interface GameDetail extends GameSummary {
  myJoinTx: string | null;
}
