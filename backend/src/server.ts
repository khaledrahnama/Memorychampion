// Local development server. In production the same app runs as a Vercel function.
import app from "./app.js";
import { config } from "./config.js";

app.listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port}/api`);
  console.log(`Chain ${config.chain.id} via ${config.chain.rpcUrl}, contract ${config.contractAddress || "(not set)"}`);
  console.log(config.databaseUrl ? "Database: Postgres (DATABASE_URL)" : `Database: embedded PGlite in ${config.pgliteDir}`);
  console.log(config.resendApiKey ? "Email: Resend" : "Email: not configured — codes are shown in the app and logged here");
});
