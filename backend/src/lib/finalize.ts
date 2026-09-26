import { query, queryOne } from "../db.js";
import { gameEndMs, ANSWER_GRACE_MS } from "./schedule.js";
import { buildRewardsTree } from "./merkle.js";
import { finalizeOnchain, readGame } from "./chain.js";

export interface GameRow {
  id: string;
  onchain_game_id: number;
  name: string;
  start_time: number;
  rounds_count: number;
  photo_seconds: number;
  question_seconds: number;
  entry_fee_wei: string;
  cancelled: boolean;
  finalize_state: "pending" | "finalizing" | "done";
  finalize_started_at: number | null;
  finalize_tx: string | null;
  winners_count: number | null;
  reward_per_winner_wei: string | null;
  rewards_root: string | null;
  created_tx: string | null;
  created_at: number;
}

const STALE_LOCK_MS = 90_000;

export async function scoreGame(gameId: string) {
  await query(
    `UPDATE game_participants gp SET score = COALESCE((
       SELECT COUNT(*) FROM game_answers ga
       JOIN game_rounds gr ON gr.game_id = ga.game_id AND gr.round_index = ga.round_index
       WHERE ga.game_id = gp.game_id AND ga.account_id = gp.account_id AND ga.option_index = gr.correct_index
     ), 0)
     WHERE gp.game_id = $1`,
    [gameId]
  );
}

/**
 * Grades a finished game and publishes its reward allocation on-chain.
 * Called lazily (when anyone opens the results) instead of by a background
 * timer, so it works on serverless. Safe to call concurrently: a row-level
 * claim ensures only one request does the work, and a stale claim (crashed
 * function) is retried after 90s.
 */
export async function ensureFinalized(game: GameRow): Promise<GameRow> {
  if (game.finalize_state === "done" || game.cancelled) return game;
  const now = Date.now();
  if (now < gameEndMs(game) + ANSWER_GRACE_MS + 500) return game;

  const claimed = await queryOne<GameRow>(
    `UPDATE games SET finalize_state = 'finalizing', finalize_started_at = $2
     WHERE id = $1 AND (finalize_state = 'pending' OR (finalize_state = 'finalizing' AND finalize_started_at < $3))
     RETURNING *`,
    [game.id, now, now - STALE_LOCK_MS]
  );
  if (!claimed) return (await queryOne<GameRow>("SELECT * FROM games WHERE id = $1", [game.id]))!;

  try {
    await scoreGame(game.id);
    const participants = await query<{ account_id: string; wallet_address: string; score: number }>(
      "SELECT account_id, wallet_address, score FROM game_participants WHERE game_id = $1",
      [game.id]
    );
    // Spec: the funded pool is split equally among players with a perfect score.
    const winners = participants.filter((p) => p.score === game.rounds_count);

    const onchain = await readGame(game.onchain_game_id);
    if (onchain.status === "cancelled") {
      await query("UPDATE games SET cancelled = TRUE, finalize_state = 'done' WHERE id = $1", [game.id]);
      return (await queryOne<GameRow>("SELECT * FROM games WHERE id = $1", [game.id]))!;
    }

    const perWinner = winners.length > 0 ? onchain.pool / BigInt(winners.length) : 0n;
    const entries = winners.map((w) => ({ wallet: w.wallet_address as `0x${string}`, amountWei: perWinner }));
    const { root } = buildRewardsTree(entries);
    const total = perWinner * BigInt(winners.length);

    // Idempotent: if a previous attempt already got the tx through, don't send it again.
    let txHash: string | null = claimed.finalize_tx;
    if (onchain.status !== "finalized") {
      txHash = await finalizeOnchain(game.onchain_game_id, root, total);
    }

    for (const w of winners) {
      await query("UPDATE game_participants SET reward_wei = $3 WHERE game_id = $1 AND account_id = $2", [
        game.id,
        w.account_id,
        perWinner.toString()
      ]);
    }
    return (await queryOne<GameRow>(
      `UPDATE games SET finalize_state = 'done', finalize_tx = $2, winners_count = $3,
         reward_per_winner_wei = $4, rewards_root = $5
       WHERE id = $1 RETURNING *`,
      [game.id, txHash, winners.length, perWinner.toString(), root]
    ))!;
  } catch (err) {
    await query("UPDATE games SET finalize_state = 'pending' WHERE id = $1", [game.id]);
    throw err;
  }
}
