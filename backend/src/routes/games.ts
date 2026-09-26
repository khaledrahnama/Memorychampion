import { Router } from "express";
import { z } from "zod";
import { query, queryOne } from "../db.js";
import { optionalAuth, requireAuth, type AuthedRequest } from "../lib/auth.js";
import { HttpError, route } from "../lib/http.js";
import { answerWindow, displayStatus, gameEndMs, getPhase } from "../lib/schedule.js";
import { hasClaimedOnchain, isRegisteredOnchain, readGame } from "../lib/chain.js";
import { ensureFinalized, type GameRow } from "../lib/finalize.js";
import { buildRewardsTree } from "../lib/merkle.js";
import { shuffledOrder } from "../lib/shuffle.js";

export const gamesRouter = Router();

async function loadGame(id: string): Promise<GameRow> {
  const game = await queryOne<GameRow>("SELECT * FROM games WHERE id = $1", [id]);
  if (!game) throw new HttpError(404, "Game not found");
  return game;
}

async function onchainSummary(game: GameRow) {
  try {
    const g = await readGame(game.onchain_game_id);
    return { poolWei: g.pool.toString(), participantCount: g.participantCount, onchainStatus: g.status };
  } catch {
    return { poolWei: null, participantCount: null, onchainStatus: null };
  }
}

function publicGame(game: GameRow, now: number) {
  return {
    id: game.id,
    onchainGameId: game.onchain_game_id,
    name: game.name,
    startTime: game.start_time,
    endTime: Math.floor(gameEndMs(game) / 1000),
    roundsCount: game.rounds_count,
    photoSeconds: game.photo_seconds,
    questionSeconds: game.question_seconds,
    entryFeeWei: game.entry_fee_wei,
    status: displayStatus(game, now),
    finalized: game.finalize_state === "done",
    winnersCount: game.winners_count,
    rewardPerWinnerWei: game.reward_per_winner_wei
  };
}

/**
 * If the player joined on-chain but the follow-up call to the backend never
 * happened (closed tab, network error), sync them in now — the contract is the
 * source of truth for registration.
 */
async function ensureParticipant(game: GameRow, accountId: string): Promise<boolean> {
  const existing = await queryOne("SELECT 1 FROM game_participants WHERE game_id = $1 AND account_id = $2", [game.id, accountId]);
  if (existing) return true;
  const account = await queryOne("SELECT wallet_address FROM accounts WHERE id = $1", [accountId]);
  if (!account?.wallet_address) return false;
  const registered = await isRegisteredOnchain(game.onchain_game_id, account.wallet_address).catch(() => false);
  if (!registered) return false;
  await query(
    `INSERT INTO game_participants (game_id, account_id, wallet_address, joined_at) VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING`,
    [game.id, accountId, account.wallet_address, Date.now()]
  );
  return true;
}

// Games screen: upcoming, live and recent games.
gamesRouter.get(
  "/",
  optionalAuth,
  route(async (req: AuthedRequest, res) => {
    const now = Date.now();
    const games = await query<GameRow>(
      `SELECT * FROM games WHERE start_time > $1
       ORDER BY CASE WHEN start_time * 1000 + rounds_count * (photo_seconds + question_seconds) * 1000 > $2 THEN 0 ELSE 1 END,
                start_time ASC
       LIMIT 40`,
      [Math.floor(now / 1000) - 7 * 24 * 3600, now]
    );
    const joined = new Set(
      req.accountId
        ? (await query("SELECT game_id FROM game_participants WHERE account_id = $1", [req.accountId])).map((r) => r.game_id)
        : []
    );
    const out = await Promise.all(
      games.map(async (g) => ({ ...publicGame(g, now), ...(await onchainSummary(g)), joined: joined.has(g.id) }))
    );
    res.json({ serverTime: now, games: out });
  })
);

gamesRouter.get(
  "/:id",
  optionalAuth,
  route(async (req: AuthedRequest, res) => {
    const game = await loadGame(req.params.id);
    const now = Date.now();
    const joined = req.accountId ? await ensureParticipant(game, req.accountId) : false;
    const players = await query<{ account_id: string; nickname: string; join_tx: string | null }>(
      `SELECT gp.account_id, a.nickname, gp.join_tx FROM game_participants gp JOIN accounts a ON a.id = gp.account_id
       WHERE gp.game_id = $1 ORDER BY gp.joined_at ASC LIMIT 60`,
      [game.id]
    );
    const mine = players.find((p) => p.account_id === req.accountId);
    res.json({
      serverTime: now,
      game: { ...publicGame(game, now), ...(await onchainSummary(game)), joined, myJoinTx: mine?.join_tx ?? null },
      players: players.map((p) => ({ nickname: p.nickname, isMe: p.account_id === req.accountId })),
      phase: getPhase(game, now)
    });
  })
);

// Called right after the player's joinGame() transaction confirms.
gamesRouter.post(
  "/:id/join",
  requireAuth,
  route(async (req: AuthedRequest, res) => {
    const game = await loadGame(req.params.id);
    const account = await queryOne("SELECT email_verified, wallet_address, nickname FROM accounts WHERE id = $1", [req.accountId]);
    if (!account?.email_verified) throw new HttpError(403, "Verify your email first");
    if (!account.nickname) throw new HttpError(403, "Choose a nickname first");
    if (!account.wallet_address) throw new HttpError(403, "Link your wallet first");
    if (!(await ensureParticipant(game, req.accountId!))) {
      throw new HttpError(400, "Your linked wallet is not registered for this game on-chain yet");
    }
    const { txHash } = z.object({ txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional() }).parse(req.body ?? {});
    if (txHash) {
      await query("UPDATE game_participants SET join_tx = $3 WHERE game_id = $1 AND account_id = $2 AND join_tx IS NULL", [game.id, req.accountId, txHash]);
    }
    res.json({ ok: true });
  })
);

// Current photo or question. Content is only released during its own window,
// so questions (and their answers) never reach the browser early.
gamesRouter.get(
  "/:id/play",
  requireAuth,
  route(async (req: AuthedRequest, res) => {
    const game = await loadGame(req.params.id);
    const now = Date.now();
    const phase = getPhase(game, now);
    const base = { serverTime: now, phase, roundsCount: game.rounds_count };

    if (!(await ensureParticipant(game, req.accountId!))) {
      return res.json({ ...base, registered: false });
    }
    if (phase.phase === "waiting" || phase.phase === "finished") return res.json({ ...base, registered: true });

    const round = await queryOne("SELECT * FROM game_rounds WHERE game_id = $1 AND round_index = $2", [game.id, phase.roundIndex]);
    if (!round) throw new HttpError(500, "Round content missing");

    if (phase.phase === "photo") {
      return res.json({ ...base, registered: true, photo: round.photo });
    }

    const options: string[] = round.options;
    const order = shuffledOrder(options.length, `${game.id}:${req.accountId}:${phase.roundIndex}`);
    const answer = await queryOne(
      "SELECT option_index FROM game_answers WHERE game_id = $1 AND account_id = $2 AND round_index = $3",
      [game.id, req.accountId, phase.roundIndex]
    );
    res.json({
      ...base,
      registered: true,
      question: round.question,
      options: order.map((i) => ({ id: i, text: options[i] })),
      myAnswer: answer?.option_index ?? null
    });
  })
);

gamesRouter.post(
  "/:id/answer",
  requireAuth,
  route(async (req: AuthedRequest, res) => {
    const body = z.object({ roundIndex: z.number().int().min(0), optionIndex: z.number().int().min(0) }).parse(req.body);
    const game = await loadGame(req.params.id);
    const now = Date.now();
    const window = answerWindow(game, body.roundIndex);
    if (body.roundIndex >= game.rounds_count || now < window.opens || now > window.closes) {
      throw new HttpError(400, "Time's up for that question");
    }
    if (!(await ensureParticipant(game, req.accountId!))) throw new HttpError(403, "You're not registered for this game");

    const round = await queryOne("SELECT options FROM game_rounds WHERE game_id = $1 AND round_index = $2", [game.id, body.roundIndex]);
    if (!round || body.optionIndex >= round.options.length) throw new HttpError(400, "Unknown option");

    await query(
      `INSERT INTO game_answers (game_id, account_id, round_index, option_index, answered_at) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (game_id, account_id, round_index) DO UPDATE SET option_index = EXCLUDED.option_index, answered_at = EXCLUDED.answered_at`,
      [game.id, req.accountId, body.roundIndex, body.optionIndex, now]
    );
    res.json({ ok: true });
  })
);

// Leaderboard + the player's result and claim data. Opening this after a game
// ends is what triggers grading and on-chain finalization (see finalize.ts).
gamesRouter.get(
  "/:id/results",
  optionalAuth,
  route(async (req: AuthedRequest, res) => {
    let game = await loadGame(req.params.id);
    const now = Date.now();
    if (now < gameEndMs(game)) {
      return res.json({ serverTime: now, game: { ...publicGame(game, now), ...(await onchainSummary(game)) }, ready: false, leaderboard: [] });
    }

    let finalizeError: string | null = null;
    try {
      game = await ensureFinalized(game);
    } catch (err: any) {
      finalizeError = err?.shortMessage ?? err?.message ?? "Finalization failed";
    }

    const rows = await query<{ account_id: string; nickname: string; score: number | null; reward_wei: string | null; wallet_address: string }>(
      `SELECT gp.account_id, a.nickname, gp.score, gp.reward_wei, gp.wallet_address
       FROM game_participants gp JOIN accounts a ON a.id = gp.account_id
       WHERE gp.game_id = $1
       ORDER BY gp.score DESC NULLS LAST, lower(a.nickname) ASC`,
      [game.id]
    );

    // Equal scores share a rank (1, 1, 3, ...).
    let rank = 0;
    const leaderboard = rows.map((r, i) => {
      if (i === 0 || r.score !== rows[i - 1].score) rank = i + 1;
      return {
        rank,
        nickname: r.nickname,
        score: r.score ?? 0,
        rewardWei: r.reward_wei ?? "0",
        isMe: r.account_id === req.accountId
      };
    });

    let me: Record<string, unknown> | null = null;
    const mine = rows.find((r) => r.account_id === req.accountId);
    if (mine && game.finalize_state === "done") {
      const rewardWei = BigInt(mine.reward_wei ?? "0");
      let proof: string[] = [];
      let claimed = false;
      if (rewardWei > 0n) {
        const winners = rows.filter((r) => r.reward_wei && BigInt(r.reward_wei) > 0n);
        const tree = buildRewardsTree(winners.map((w) => ({ wallet: w.wallet_address as `0x${string}`, amountWei: BigInt(w.reward_wei!) })));
        proof = tree.proofFor({ wallet: mine.wallet_address as `0x${string}`, amountWei: rewardWei });
        claimed = await hasClaimedOnchain(game.onchain_game_id, mine.wallet_address).catch(() => false);
      }
      me = { score: mine.score ?? 0, rewardWei: rewardWei.toString(), proof, claimed, wallet: mine.wallet_address };
    }

    res.json({
      serverTime: now,
      game: { ...publicGame(game, now), ...(await onchainSummary(game)), finalizeTx: game.finalize_tx },
      ready: game.finalize_state === "done",
      finalizeError,
      leaderboard,
      me
    });
  })
);
