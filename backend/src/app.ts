import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { authRouter } from "./routes/auth.js";
import { gamesRouter } from "./routes/games.js";
import { adminRouter } from "./routes/admin.js";
import { errorHandler } from "./lib/http.js";
import { operatorAddress } from "./lib/chain.js";

// One Express app, used both by the local dev server (server.ts) and as the
// Vercel serverless function (bundled by scripts/vercel-build.mjs).
const app = express();
app.disable("x-powered-by");
if (config.corsOrigin) app.use(cors({ origin: config.corsOrigin }));
app.use(express.json({ limit: "2mb" }));

const api = express.Router();
api.get("/health", (_req, res) => res.json({ ok: true, time: Date.now() }));

// Public chain settings so the frontend needs no env vars of its own.
api.get("/config", (_req, res) =>
  res.json({
    chainId: config.chain.id,
    chainName: config.chain.name,
    rpcUrl: config.chain.rpcUrl,
    explorerUrl: config.chain.explorerUrl,
    contractAddress: config.contractAddress || null,
    operatorAddress: operatorAddress() ?? null,
    faucetUrl: config.chain.id === 10143 ? "https://faucet.monad.xyz" : null,
    serverTime: Date.now()
  })
);

api.use("/auth", authRouter);
api.use("/games", gamesRouter);
api.use("/admin", adminRouter);
api.use((_req, res) => res.status(404).json({ error: "Not found" }));

app.use("/api", api);
app.use(errorHandler);

export default app;
