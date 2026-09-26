# backend (API)

Express + TypeScript API. Locally it runs as a normal server (`npm run dev`, port 4000); on Vercel the same app is bundled into one serverless function at `/api/*` (see `../scripts/vercel-build.mjs`).

```bash
npm install
cp .env.example .env     # locally only CONTRACT_ADDRESS / OPERATOR_PRIVATE_KEY / chain are needed
npm run dev
```

Easiest local setup: run `../start-local.sh`, which does all of this for you.

## Design

- **Database:** Postgres through `DATABASE_URL` (Neon in production). Without it, an embedded Postgres ([PGlite](https://pglite.dev)) stores data in `PGLITE_DIR`, so there's nothing to install. Tables are created automatically.
- **Timing:** `src/lib/schedule.ts` derives the phase (`waiting → photo → question → … → finished`) from the start time alone, with 5 s per picture and 5 s per question, stored per game. No timers or sockets, so it works on serverless and a refresh never restarts a game.
- **Secrecy:** `/play` returns a picture only during its window and a question with shuffled options (never the answer) only during its window. Answers are validated against the server clock, with a 1.5 s grace period.
- **Finalization:** `src/lib/finalize.ts` grades, splits the on-chain pool equally among perfect scores, builds the Merkle tree and calls `finalizeGame`. It is triggered the first time anyone opens a finished game's results (or from the organizer page), and a row-level lock makes it safe under concurrent requests.
- **Content:** `src/content/cards.ts` generates a fresh memory card per round: a cream card with two sticker groups (color + shape, 1–5 each) and a badge number. The question (how many X, which shape was X, what color were X, badge number) is derived from the same card, so the answer is always exact. The admin API also accepts custom rounds (`photoUrl`, `question`, `options`, `correctIndex`).
- **Email:** Resend (`RESEND_API_KEY`). Without it, local dev shows the code in the app. In production, registration returns a clear error until it's set.

## API (all under `/api`)

| Method | Path | |
|---|---|---|
| GET | `/config` | chain id, RPC, explorer, contract (used by the frontend) |
| POST | `/auth/register` | email → sends code (45 s resend cooldown) |
| POST | `/auth/verify` | email + code → token (5 attempts per code) |
| POST | `/auth/nickname` | unique, case-insensitive |
| POST | `/auth/wallet/nonce`, `/auth/wallet/link` | sign-to-link wallet |
| GET | `/auth/me` | nickname, wallet, rewards won / to claim |
| GET | `/games`, `/games/:id` | list / detail with on-chain pool, player count, status |
| POST | `/games/:id/join` | after `joinGame()` confirms (the contract is the source of truth) |
| GET | `/games/:id/play` | current picture or question |
| POST | `/games/:id/answer` | `{ roundIndex, optionIndex }` |
| GET | `/games/:id/results` | leaderboard, your score, reward + Merkle proof, claimed flag |
| * | `/admin/...` | header `x-admin-key`: status, create + fund game, preview, cancel, finalize, withdraw |

## Scripts

- `npm run create-game`: schedule a funded game via the admin API (works against a deployed URL with `API_URL=… ADMIN_KEY=…`).
- `npm run e2e`: full automated flow with two real wallets (see the file header for the env it expects).
