# frontend

React + Vite + Tailwind, with wagmi/viem for wallets.

```bash
npm install
npm run dev      # http://localhost:5173 — /api is proxied to the API on :4000
```

It needs **no environment variables**: chain id, RPC, explorer and contract address come from the API's `/api/config`. Set `API_PROXY_TARGET` if your local API runs somewhere other than `http://localhost:4000`.

## Screens

- **Games** (`/`): upcoming games with local start time, live countdown, registered players, prize pool, status, and Join / Enter lobby / View results. Recent results appear below.
- **Account** (`/account`): email → code → nickname → wallet (connect MetaMask → switch network → sign). Returning players sign in with the same email.
- **Lobby / Play** (`/games/:id`): countdown, pool, players and instructions, then switches automatically into the rounds: memory card (5 s) then question (5 s) with timer bars, synced to the server clock.
- **Results** (`/games/:id/results`): leaderboard (ties share a rank, you're highlighted), your score, reward and **Claim**.
- **Host** (`/host`): schedule and fund games, preview cards and answers, cancel, publish results, withdraw.

The top bar shows your nickname, wallet, MON balance (read from the chain), rewards won and rewards to claim.

Transactions switch the wallet to the right network first, and add the network if the wallet doesn't know it.
