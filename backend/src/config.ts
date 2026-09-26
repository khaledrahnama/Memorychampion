import "dotenv/config";

// Vercel sets VERCEL=1; NODE_ENV=production covers other hosts.
export const isProduction = process.env.VERCEL === "1" || process.env.NODE_ENV === "production";

function requiredInProd(name: string, devFallback: string): string {
  const v = process.env[name];
  if (v) return v;
  if (isProduction) throw new Error(`Missing required environment variable ${name}`);
  return devFallback;
}

const chainId = Number(process.env.CHAIN_ID ?? 10143);

function normalizeKey(raw?: string): `0x${string}` {
  const k = (raw ?? "").trim().replace(/^["']|["']$/g, "");
  if (!k) return "" as `0x${string}`;
  return (k.startsWith("0x") ? k : `0x${k}`) as `0x${string}`;
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  jwtSecret: requiredInProd("JWT_SECRET", "local-dev-secret"),
  // Admin endpoints are disabled entirely when ADMIN_KEY is unset.
  adminKey: process.env.ADMIN_KEY ?? (isProduction ? "" : "dev-admin-key"),

  // Postgres in production (Neon via the Vercel marketplace sets DATABASE_URL / POSTGRES_URL).
  // Without one, local dev uses an embedded Postgres (PGlite) stored in PGLITE_DIR.
  databaseUrl: process.env.DATABASE_URL || process.env.POSTGRES_URL || "",
  pgliteDir: process.env.PGLITE_DIR ?? "./.pglite",

  chain: {
    id: chainId,
    name: chainId === 10143 ? "Monad Testnet" : chainId === 31337 ? "Local Hardhat" : `Chain ${chainId}`,
    rpcUrl: process.env.RPC_URL || process.env.MONAD_TESTNET_RPC_URL || "https://testnet-rpc.monad.xyz",
    explorerUrl: process.env.EXPLORER_URL ?? (chainId === 10143 ? "https://testnet.monadvision.com" : "")
  },
  contractAddress: (process.env.CONTRACT_ADDRESS ?? "") as `0x${string}`,
  // Accept the key with or without 0x (MetaMask exports it without).
  operatorPrivateKey: normalizeKey(process.env.OPERATOR_PRIVATE_KEY),

  resendApiKey: process.env.RESEND_API_KEY ?? "",
  emailFrom: process.env.EMAIL_FROM ?? "Monad Memory Challenge <onboarding@resend.dev>",
  devCodeFile: process.env.DEV_CODE_FILE ?? "",

  corsOrigin: process.env.FRONTEND_ORIGIN ?? "",

  // Spec: photo shown 5s, then its question for 5s. Stored per game at creation,
  // so changing these later never affects a game already scheduled.
  photoSeconds: Number(process.env.PHOTO_SECONDS ?? 5),
  // Minimum gap between creating a game and its start (only lowered for automated tests).
  minLeadSeconds: Number(process.env.MIN_LEAD_SECONDS ?? 60),
  questionSeconds: Number(process.env.QUESTION_SECONDS ?? 5)
};
