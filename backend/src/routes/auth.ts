import { Router } from "express";
import { z } from "zod";
import { nanoid } from "nanoid";
import { createHash, randomInt } from "node:crypto";
import { getAddress, isAddress, verifyMessage } from "viem";
import { query, queryOne } from "../db.js";
import { sendVerificationEmail } from "../lib/email.js";
import { requireAuth, signToken, type AuthedRequest } from "../lib/auth.js";
import { HttpError, route } from "../lib/http.js";
import { hasClaimedOnchain } from "../lib/chain.js";

export const authRouter = Router();

const CODE_TTL_MS = 15 * 60 * 1000;
const RESEND_COOLDOWN_MS = 45 * 1000;
const MAX_CODE_ATTEMPTS = 5;

const hashCode = (email: string, code: string) => createHash("sha256").update(`${email}:${code}`).digest("hex");
const normEmail = (e: string) => e.trim().toLowerCase();
const walletMessage = (nonce: string) =>
  `Monad Memory Challenge\n\nSign this message to link this wallet to your account.\nThis does not cost anything.\n\nNonce: ${nonce}`;

// 1. Email -> send a 6-digit code (also how returning players sign in).
authRouter.post(
  "/register",
  route(async (req, res) => {
    const email = normEmail(z.object({ email: z.string().email() }).parse(req.body).email);
    const now = Date.now();
    let account = await queryOne("SELECT id, code_sent_at FROM accounts WHERE email = $1", [email]);

    if (account?.code_sent_at && now - account.code_sent_at < RESEND_COOLDOWN_MS) {
      const wait = Math.ceil((RESEND_COOLDOWN_MS - (now - account.code_sent_at)) / 1000);
      throw new HttpError(429, `A code was just sent. You can request another in ${wait}s.`);
    }

    const code = String(randomInt(100000, 1000000));
    if (!account) {
      account = { id: nanoid() };
      await query("INSERT INTO accounts (id, email, created_at) VALUES ($1, $2, $3)", [account.id, email, now]);
    }
    await query(
      "UPDATE accounts SET code_hash = $2, code_expires_at = $3, code_attempts = 0, code_sent_at = $4 WHERE id = $1",
      [account.id, hashCode(email, code), now + CODE_TTL_MS, now]
    );

    const { devCode } = await sendVerificationEmail(email, code);
    res.json({ ok: true, devCode });
  })
);

// 2. Verify the code -> session token.
authRouter.post(
  "/verify",
  route(async (req, res) => {
    const body = z.object({ email: z.string().email(), code: z.string().trim().regex(/^\d{6}$/, "must be 6 digits") }).parse(req.body);
    const email = normEmail(body.email);
    const account = await queryOne("SELECT * FROM accounts WHERE email = $1", [email]);
    if (!account?.code_hash) throw new HttpError(400, "Request a code first");
    if (Date.now() > account.code_expires_at) throw new HttpError(400, "That code expired. Request a new one.");
    if (account.code_attempts >= MAX_CODE_ATTEMPTS) throw new HttpError(429, "Too many wrong attempts. Request a new code.");

    if (account.code_hash !== hashCode(email, body.code)) {
      await query("UPDATE accounts SET code_attempts = code_attempts + 1 WHERE id = $1", [account.id]);
      throw new HttpError(400, "Wrong code");
    }

    await query("UPDATE accounts SET email_verified = TRUE, code_hash = NULL WHERE id = $1", [account.id]);
    res.json({ token: signToken(account.id) });
  })
);

// 3. Unique nickname.
authRouter.post(
  "/nickname",
  requireAuth,
  route(async (req: AuthedRequest, res) => {
    const { nickname } = z
      .object({ nickname: z.string().trim().min(3, "at least 3 characters").max(20).regex(/^[a-zA-Z0-9_]+$/, "letters, numbers and _ only") })
      .parse(req.body);
    const taken = await queryOne("SELECT id FROM accounts WHERE nickname_key = $1 AND id <> $2", [nickname.toLowerCase(), req.accountId]);
    if (taken) throw new HttpError(409, "That nickname is taken");
    await query("UPDATE accounts SET nickname = $2, nickname_key = $3 WHERE id = $1", [req.accountId, nickname, nickname.toLowerCase()]);
    res.json({ ok: true });
  })
);

// 4a. Nonce to sign, proving wallet ownership.
authRouter.post(
  "/wallet/nonce",
  requireAuth,
  route(async (req: AuthedRequest, res) => {
    const nonce = nanoid(24);
    await query("UPDATE accounts SET wallet_nonce = $2 WHERE id = $1", [req.accountId, nonce]);
    res.json({ message: walletMessage(nonce) });
  })
);

// 4b. Verify the signature and link the wallet.
authRouter.post(
  "/wallet/link",
  requireAuth,
  route(async (req: AuthedRequest, res) => {
    const body = z.object({ address: z.string().refine((a) => isAddress(a), "not an address"), signature: z.string() }).parse(req.body);
    const account = await queryOne("SELECT wallet_nonce FROM accounts WHERE id = $1", [req.accountId]);
    if (!account?.wallet_nonce) throw new HttpError(400, "Request a nonce first");

    const valid = await verifyMessage({
      address: body.address as `0x${string}`,
      message: walletMessage(account.wallet_nonce),
      signature: body.signature as `0x${string}`
    });
    if (!valid) throw new HttpError(400, "Signature does not match the wallet");

    const address = getAddress(body.address);
    const inUse = await queryOne("SELECT id FROM accounts WHERE wallet_address = $1 AND id <> $2", [address, req.accountId]);
    if (inUse) throw new HttpError(409, "This wallet is already linked to another account");

    await query("UPDATE accounts SET wallet_address = $2, wallet_nonce = NULL WHERE id = $1", [req.accountId, address]);
    res.json({ ok: true, address });
  })
);

// Player info for the top bar: nickname, wallet, rewards won / claimable.
authRouter.get(
  "/me",
  requireAuth,
  route(async (req: AuthedRequest, res) => {
    const account = await queryOne("SELECT * FROM accounts WHERE id = $1", [req.accountId]);
    if (!account) throw new HttpError(401, "Please sign in again");

    const rewards = await query<{ game_id: string; name: string; onchain_game_id: number; reward_wei: string; wallet_address: string }>(
      `SELECT gp.game_id, g.name, g.onchain_game_id, gp.reward_wei, gp.wallet_address
       FROM game_participants gp JOIN games g ON g.id = gp.game_id
       WHERE gp.account_id = $1 AND gp.reward_wei IS NOT NULL AND gp.reward_wei > 0`,
      [req.accountId]
    );

    let totalWon = 0n;
    let claimable = 0n;
    const claimableGames: { gameId: string; name: string; amountWei: string }[] = [];
    for (const r of rewards) {
      const amount = BigInt(r.reward_wei);
      totalWon += amount;
      const claimed = await hasClaimedOnchain(r.onchain_game_id, r.wallet_address).catch(() => false);
      if (!claimed) {
        claimable += amount;
        claimableGames.push({ gameId: r.game_id, name: r.name, amountWei: r.reward_wei });
      }
    }

    res.json({
      email: account.email,
      emailVerified: account.email_verified,
      nickname: account.nickname,
      walletAddress: account.wallet_address,
      totalWonWei: totalWon.toString(),
      claimableWei: claimable.toString(),
      claimableGames
    });
  })
);
