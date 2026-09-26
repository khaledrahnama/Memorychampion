// End-to-end test of the whole flow against a running API + chain, with real
// wallets (viem) instead of a browser:
//   admin creates + funds a game -> two players register (email code), pick
//   nicknames, link wallets, join on-chain -> both play every round as the
//   server reveals it (one answers perfectly, one misses a question) -> results
//   trigger grading + on-chain finalization -> the winner claims on-chain.
//
// Usage: API_URL=http://localhost:4000 RPC_URL=http://127.0.0.1:8545 CHAIN_ID=31337 \
//        CONTRACT_ADDRESS=0x... ADMIN_KEY=dev-admin-key npx tsx src/e2e/run.ts
// The API must run without RESEND_API_KEY (dev mode returns codes) and ideally
// with PHOTO_SECONDS=1 QUESTION_SECONDS=1 MIN_LEAD_SECONDS=5 to keep it fast.
import { createPublicClient, createWalletClient, defineChain, formatEther, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const API = (process.env.API_URL ?? "http://localhost:4000") + "/api";
const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const CHAIN_ID = Number(process.env.CHAIN_ID ?? 31337);
const CONTRACT = process.env.CONTRACT_ADDRESS as `0x${string}`;
const ADMIN_KEY = process.env.ADMIN_KEY ?? "dev-admin-key";

// Well-known Hardhat test accounts #1 and #2 (never hold real funds).
const RUN = Date.now().toString(36).slice(-5);
const PLAYERS = [
  { email: `alice+${RUN}@example.com`, nickname: `alice_${RUN}`, pk: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const },
  { email: `bob+${RUN}@example.com`, nickname: `bob_${RUN}`, pk: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as const }
];

const chain = defineChain({
  id: CHAIN_ID, name: "test", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [RPC_URL] } }
});
const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });
const abi = [
  { type: "function", name: "joinGame", stateMutability: "payable", inputs: [{ name: "gameId", type: "uint256" }], outputs: [] },
  {
    type: "function", name: "claimReward", stateMutability: "nonpayable",
    inputs: [{ name: "gameId", type: "uint256" }, { name: "amount", type: "uint256" }, { name: "proof", type: "bytes32[]" }], outputs: []
  }
] as const;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

async function api<T = any>(path: string, opts: { method?: string; body?: unknown; token?: string; admin?: boolean; expectError?: boolean } = {}): Promise<T> {
  const res = await fetch(API + path, {
    method: opts.method ?? (opts.body ? "POST" : "GET"),
    headers: {
      "Content-Type": "application/json",
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.admin ? { "x-admin-key": ADMIN_KEY } : {})
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const json = await res.json().catch(() => ({}));
  if (opts.expectError) {
    assert(!res.ok, `${path} should have failed`);
    return json;
  }
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${JSON.stringify(json)}`);
  return json;
}

function step(msg: string) {
  console.log(`\n=== ${msg}`);
}

async function main() {
  assert(CONTRACT, "set CONTRACT_ADDRESS");

  step("Config + health");
  const cfg = await api("/config");
  assert(cfg.chainId === CHAIN_ID, "chain id from /api/config matches");
  const status = await api("/admin/status", { admin: true });
  console.log(status);

  step("Admin creates and funds a 3-round game");
  await api("/admin/games", { body: { name: "Too soon", startTime: Math.floor(Date.now() / 1000), poolMon: "1" }, admin: true, expectError: true });
  const startTime = Math.floor(Date.now() / 1000) + 12;
  const created = await api("/admin/games", { body: { name: "E2E Challenge", startTime, poolMon: "10", roundsCount: 3 }, admin: true });
  console.log(created);
  const { rounds } = await api(`/admin/games/${created.id}/rounds`, { admin: true });
  assert(rounds.length === 3, "3 rounds stored");
  rounds.forEach((r: any) => console.log(`  round ${r.roundIndex}: [${r.sceneId}] ${r.question} -> ${r.options[r.correctIndex]}`));

  const list = await api("/games");
  const listed = list.games.find((g: any) => g.id === created.id);
  assert(listed && listed.poolWei === parseEther("10").toString(), "game listed with its on-chain pool");
  assert(["registration_open", "starting_soon"].includes(listed.status), "status before start");

  step("Players register, verify, pick nicknames, link wallets, join on-chain");
  const tokens: string[] = [];
  for (const p of PLAYERS) {
    const reg = await api("/auth/register", { body: { email: p.email } });
    assert(reg.devCode, "dev mode returns the code");
    await api("/auth/verify", { body: { email: p.email, code: "000000" }, expectError: true });
    const { token } = await api("/auth/verify", { body: { email: p.email, code: reg.devCode } });
    await api("/auth/nickname", { body: { nickname: p.nickname }, token });
    const account = privateKeyToAccount(p.pk);
    const { message } = await api("/auth/wallet/nonce", { body: {}, token });
    await api("/auth/wallet/link", { body: { address: account.address, signature: await account.signMessage({ message }) }, token });

    const wallet = createWalletClient({ account, chain, transport: http(RPC_URL) });
    const hash = await wallet.writeContract({ address: CONTRACT, abi, functionName: "joinGame", args: [BigInt(created.onchainGameId)] });
    await publicClient.waitForTransactionReceipt({ hash });
    await api(`/games/${created.id}/join`, { body: { txHash: hash }, token });
    tokens.push(token);
    console.log(`  ${p.nickname} joined (${account.address})`);
  }
  await api("/auth/nickname", { body: { nickname: PLAYERS[0].nickname.toUpperCase() }, token: tokens[1], expectError: true });

  step("Both play every round as the server reveals it");
  const answered = [new Set<number>(), new Set<number>()];
  let sawPhoto = false;
  while (true) {
    const states = await Promise.all(tokens.map((t) => api(`/games/${created.id}/play`, { token: t })));
    if (states[0].phase.phase === "finished") break;
    for (const [i, s] of states.entries()) {
      assert(s.registered, "player registered");
      if (s.phase.phase === "photo") {
        assert(s.photo && !s.question, "photo phase shows the photo only");
        sawPhoto = true;
      }
      if (s.phase.phase === "question" && !answered[i].has(s.phase.roundIndex)) {
        assert(!s.photo && s.options.length >= 2, "question phase hides the photo");
        const r = rounds[s.phase.roundIndex];
        // Player 0 answers perfectly; player 1 gets round 0 wrong.
        const choice = i === 1 && s.phase.roundIndex === 0 ? (r.correctIndex + 1) % r.options.length : r.correctIndex;
        await api(`/games/${created.id}/answer`, { body: { roundIndex: s.phase.roundIndex, optionIndex: choice }, token: tokens[i] });
        answered[i].add(s.phase.roundIndex);
        console.log(`  ${PLAYERS[i].nickname} answered round ${s.phase.roundIndex}: "${r.options[choice]}"`);
      }
    }
    await sleep(250);
  }
  assert(sawPhoto, "saw at least one photo phase");
  assert(answered[0].size === 3 && answered[1].size === 3, "every round answered");
  await api(`/games/${created.id}/answer`, { body: { roundIndex: 0, optionIndex: 0 }, token: tokens[0], expectError: true });

  step("Results: grading + on-chain finalization");
  let results: any;
  for (let i = 0; i < 20; i++) {
    results = await api(`/games/${created.id}/results`, { token: tokens[0] });
    if (results.ready) break;
    if (results.finalizeError) console.log("  finalize error (will retry):", results.finalizeError);
    await sleep(1000);
  }
  console.log(JSON.stringify(results.leaderboard, null, 2));
  assert(results.ready, "game finalized");
  assert(results.leaderboard[0].nickname === PLAYERS[0].nickname && results.leaderboard[0].score === 3, "alice 3/3 on top");
  assert(results.leaderboard[1].nickname === PLAYERS[1].nickname && results.leaderboard[1].score === 2, "bob 2/3");
  assert(results.me.rewardWei === parseEther("10").toString(), "alice wins the whole pool");
  const bobResults = await api(`/games/${created.id}/results`, { token: tokens[1] });
  assert(bobResults.me.rewardWei === "0", "bob wins nothing");

  const meBefore = await api("/auth/me", { token: tokens[0] });
  assert(meBefore.claimableWei === parseEther("10").toString(), "10 MON claimable in the player bar");

  step("Winner claims on-chain");
  const alice = privateKeyToAccount(PLAYERS[0].pk);
  const aliceWallet = createWalletClient({ account: alice, chain, transport: http(RPC_URL) });
  const before = await publicClient.getBalance({ address: alice.address });
  const hash = await aliceWallet.writeContract({
    address: CONTRACT, abi, functionName: "claimReward",
    args: [BigInt(created.onchainGameId), BigInt(results.me.rewardWei), results.me.proof]
  });
  await publicClient.waitForTransactionReceipt({ hash });
  const after = await publicClient.getBalance({ address: alice.address });
  console.log(`  balance ${formatEther(before)} -> ${formatEther(after)} MON`);
  assert(after - before > parseEther("9.99"), "reward received");

  const meAfter = await api("/auth/me", { token: tokens[0] });
  assert(meAfter.claimableWei === "0" && meAfter.totalWonWei === parseEther("10").toString(), "claimed reward no longer claimable");
  const resultsAfter = await api(`/games/${created.id}/results`, { token: tokens[0] });
  assert(resultsAfter.me.claimed === true, "results show claimed");

  step("Admin view");
  const adminGames = await api("/admin/games", { admin: true });
  console.log(adminGames.games.find((g: any) => g.id === created.id));

  console.log("\n✅ E2E passed: create+fund -> register -> link wallet -> join -> play -> finalize -> claim");
}

main().catch((err) => {
  console.error("\n❌ E2E failed:", err);
  process.exit(1);
});
