import { Router } from "express";
import { z } from "zod";
import { nanoid } from "nanoid";
import { formatEther, parseEther } from "viem";
import { query, queryOne } from "../db.js";
import { requireAdmin } from "../lib/auth.js";
import { HttpError, route } from "../lib/http.js";
import { config } from "../config.js";
import {
  cancelOnchain, createGameOnchain, operatorAddress, operatorKeyProblem, publicClient, readAccounting, readGame, withdrawOnchain
} from "../lib/chain.js";
import { ensureFinalized, type GameRow } from "../lib/finalize.js";
import { displayStatus, gameEndMs } from "../lib/schedule.js";
import { pickRounds } from "../content/cards.js";

export const adminRouter = Router();
adminRouter.use(requireAdmin);

async function loadGame(id: string) {
  const game = await queryOne<GameRow>("SELECT * FROM games WHERE id = $1", [id]);
  if (!game) throw new HttpError(404, "Game not found");
  return game;
}

adminRouter.get(
  "/status",
  route(async (_req, res) => {
    const operator = operatorAddress();
    const balance = operator ? await publicClient.getBalance({ address: operator }).catch(() => null) : null;
    res.json({
      chainId: config.chain.id,
      contractAddress: config.contractAddress || null,
      operatorAddress: operator ?? null,
      operatorKeyProblem: operatorKeyProblem(),
      operatorBalanceMon: balance === null ? null : formatEther(balance),
      emailConfigured: !!config.resendApiKey,
      photoSeconds: config.photoSeconds,
      questionSeconds: config.questionSeconds
    });
  })
);

adminRouter.get(
  "/games",
  route(async (_req, res) => {
    const now = Date.now();
    const games = await query<GameRow>("SELECT * FROM games ORDER BY start_time DESC LIMIT 100");
    const out = await Promise.all(
      games.map(async (g) => {
        const [onchain, acct, players] = await Promise.all([
          readGame(g.onchain_game_id).catch(() => null),
          readAccounting(g.onchain_game_id).catch(() => null),
          queryOne("SELECT COUNT(*)::int AS n FROM game_participants WHERE game_id = $1", [g.id])
        ]);
        return {
          id: g.id,
          onchainGameId: g.onchain_game_id,
          name: g.name,
          startTime: g.start_time,
          endTime: Math.floor(gameEndMs(g) / 1000),
          roundsCount: g.rounds_count,
          status: displayStatus(g, now),
          finalizeState: g.finalize_state,
          winnersCount: g.winners_count,
          poolMon: onchain ? formatEther(onchain.pool) : null,
          participantCount: onchain?.participantCount ?? null,
          playersInApp: players?.n ?? 0,
          onchainStatus: onchain?.status ?? null,
          organizerWithdrawn: acct?.organizerWithdrawn ?? null,
          withdrawableMon:
            onchain && acct && !acct.organizerWithdrawn
              ? onchain.status === "cancelled"
                ? formatEther(acct.funding)
                : onchain.status === "finalized"
                  ? formatEther(onchain.pool - acct.allocated)
                  : null
              : null
        };
      })
    );
    res.json({ games: out });
  })
);

// Creates a game end to end: funds it on-chain from the operator wallet, then
// stores its photos/questions (random scenes from the bank, or custom rounds).
adminRouter.post(
  "/games",
  route(async (req, res) => {
    const body = z
      .object({
        name: z.string().trim().min(1).max(60),
        startTime: z.number().int(), // unix seconds
        poolMon: z.string().regex(/^\d+(\.\d+)?$/, "a number like 10 or 0.5"),
        entryFeeMon: z.string().regex(/^\d+(\.\d+)?$/).default("0"),
        roundsCount: z.number().int().min(1).max(5).default(5),
        rounds: z
          .array(
            z.object({
              photoUrl: z.string().url(),
              question: z.string().min(1),
              options: z.array(z.string().min(1)).min(2).max(6),
              correctIndex: z.number().int().min(0)
            })
          )
          .min(1)
          .max(5)
          .optional()
      })
      .parse(req.body);

    const now = Math.floor(Date.now() / 1000);
    if (body.startTime < now + config.minLeadSeconds) {
      throw new HttpError(400, `Start time must be at least ${config.minLeadSeconds}s from now so players can register`);
    }
    for (const r of body.rounds ?? []) if (r.correctIndex >= r.options.length) throw new HttpError(400, "correctIndex out of range");

    const rounds = body.rounds
      ? body.rounds.map((r) => ({ sceneId: null, photo: r.photoUrl, question: r.question, options: r.options, correctIndex: r.correctIndex }))
      : pickRounds(body.roundsCount);

    const { onchainGameId, txHash } = await createGameOnchain(body.startTime, parseEther(body.poolMon), parseEther(body.entryFeeMon));

    const id = nanoid(12);
    await query(
      `INSERT INTO games (id, onchain_game_id, name, start_time, rounds_count, photo_seconds, question_seconds, entry_fee_wei, created_tx, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [id, onchainGameId, body.name, body.startTime, rounds.length, config.photoSeconds, config.questionSeconds,
       parseEther(body.entryFeeMon).toString(), txHash, Date.now()]
    );
    for (const [i, r] of rounds.entries()) {
      await query(
        `INSERT INTO game_rounds (game_id, round_index, scene_id, photo, question, options, correct_index)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, i, r.sceneId, r.photo, r.question, JSON.stringify(r.options), r.correctIndex]
      );
    }
    res.json({ id, onchainGameId, txHash });
  })
);

// Organizer preview of a game's content, including the correct answers.
adminRouter.get(
  "/games/:id/rounds",
  route(async (req, res) => {
    const game = await loadGame(req.params.id);
    const rounds = await query(
      "SELECT round_index, scene_id, photo, question, options, correct_index FROM game_rounds WHERE game_id = $1 ORDER BY round_index",
      [game.id]
    );
    res.json({
      rounds: rounds.map((r) => ({
        roundIndex: r.round_index, sceneId: r.scene_id, photo: r.photo, question: r.question,
        options: r.options, correctIndex: r.correct_index
      }))
    });
  })
);

adminRouter.post(
  "/games/:id/cancel",
  route(async (req, res) => {
    const game = await loadGame(req.params.id);
    if (Date.now() >= game.start_time * 1000) throw new HttpError(400, "Games can only be cancelled before they start");
    const tx = await cancelOnchain(game.onchain_game_id);
    await query("UPDATE games SET cancelled = TRUE WHERE id = $1", [game.id]);
    res.json({ ok: true, tx });
  })
);

adminRouter.post(
  "/games/:id/finalize",
  route(async (req, res) => {
    const game = await ensureFinalized(await loadGame(req.params.id));
    res.json({ ok: true, finalizeState: game.finalize_state, tx: game.finalize_tx });
  })
);

// Returns the organizer's share to the operator wallet: the funding of a
// cancelled game, or whatever wasn't won in a finalized one.
adminRouter.post(
  "/games/:id/withdraw",
  route(async (req, res) => {
    const game = await loadGame(req.params.id);
    const tx = await withdrawOnchain(game.onchain_game_id);
    res.json({ ok: true, tx });
  })
);
