export {};
// Create a funded game from the command line (same as the Admin page).
// Works against local dev or your deployed site:
//
//   API_URL=https://your-app.vercel.app ADMIN_KEY=... npm run create-game
//
// Optional: GAME_NAME, START_IN_MINUTES (default 5), POOL_MON (default 1), ROUNDS (default 5).
const API_URL = (process.env.API_URL ?? "http://localhost:4000").replace(/\/$/, "");
const ADMIN_KEY = process.env.ADMIN_KEY ?? "dev-admin-key";
const startInMinutes = Number(process.env.START_IN_MINUTES ?? 5);

const body = {
  name: process.env.GAME_NAME ?? `Memory Challenge ${new Date().toISOString().slice(5, 16).replace("T", " ")}`,
  startTime: Math.floor(Date.now() / 1000) + Math.round(startInMinutes * 60),
  poolMon: process.env.POOL_MON ?? "1",
  roundsCount: Number(process.env.ROUNDS ?? 5)
};

const res = await fetch(`${API_URL}/api/admin/games`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-admin-key": ADMIN_KEY },
  body: JSON.stringify(body)
});
const json = await res.json();
if (!res.ok) {
  console.error("Failed:", json.error ?? json);
  process.exit(1);
}
console.log(`✅ "${body.name}" created (id ${json.id}, on-chain #${json.onchainGameId}), pool ${body.poolMon} MON,`);
console.log(`   starts ${new Date(body.startTime * 1000).toLocaleString()} — tx ${json.txHash}`);
