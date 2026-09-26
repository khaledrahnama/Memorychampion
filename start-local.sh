#!/usr/bin/env bash
# One command to run everything locally:
#   local chain -> deploy contract -> API (embedded Postgres) -> demo game -> web app
# Run it in ONE terminal and leave it open; Ctrl+C stops everything.
#
#   ./start-local.sh           # normal run
#   ./start-local.sh --clean   # reinstall all dependencies first (fixes "wrong platform" npm errors)
set -e
cd "$(dirname "$0")"
ROOT="$(pwd)"

# Hardhat's well-known local test account #0 — local testing only, never for real funds.
DEPLOYER_PK=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

PIDS=()
cleanup() {
  echo ""
  echo ">>> Stopping..."
  for pid in "${PIDS[@]}"; do kill "$pid" 2>/dev/null || true; done
}
trap cleanup EXIT

if [ "$1" = "--clean" ]; then
  echo ">>> Removing node_modules so they're reinstalled for this computer"
  rm -rf contracts/node_modules backend/node_modules frontend/node_modules node_modules
fi

# Always sync dependencies (quick when nothing changed; picks up new ones after a git pull).
for dir in contracts backend frontend; do
  echo ">>> Installing $dir dependencies"
  (cd "$ROOT/$dir" && npm install --no-audit --no-fund --loglevel=error)
done

echo ">>> Freeing ports 8545 / 4000 / 5173"
for port in 8545 4000 5173; do lsof -ti :$port | xargs kill 2>/dev/null || true; done
sleep 1

echo ">>> [1/5] Starting local blockchain"
cd "$ROOT/contracts"
npx hardhat node > "$ROOT/.local-chain.log" 2>&1 &
PIDS+=($!)
for i in $(seq 1 40); do
  curl -s -X POST http://127.0.0.1:8545 -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' | grep -q result && break
  sleep 1
done

echo ">>> [2/5] Compiling + deploying MemoryGame"
node scripts/compile-solcjs.cjs
DEPLOY_OUT=$(DEPLOYER_PK=$DEPLOYER_PK node scripts/deploy-solcjs.cjs)
echo "$DEPLOY_OUT"
CONTRACT_ADDRESS=$(echo "$DEPLOY_OUT" | grep "deployed to" | grep -oE '0x[a-fA-F0-9]{40}')

echo ">>> [3/5] Starting API"
cd "$ROOT/backend"
# The local chain starts empty every run, so start the local database empty too.
rm -rf .pglite-local
cat > .env <<ENVEOF
JWT_SECRET=local-dev-secret
ADMIN_KEY=dev-admin-key
PGLITE_DIR=./.pglite-local
CHAIN_ID=31337
RPC_URL=http://127.0.0.1:8545
CONTRACT_ADDRESS=$CONTRACT_ADDRESS
OPERATOR_PRIVATE_KEY=$DEPLOYER_PK
MIN_LEAD_SECONDS=30
ENVEOF
npx tsx src/server.ts > "$ROOT/.local-api.log" 2>&1 &
PIDS+=($!)
for i in $(seq 1 40); do
  curl -s http://localhost:4000/api/health | grep -q ok && break
  sleep 1
done

echo ">>> [4/5] Creating demo games"
GAME_NAME="Memory Challenge #1" START_IN_MINUTES=2 POOL_MON=10 npx tsx src/scripts/create-game.ts
GAME_NAME="Evening Challenge" START_IN_MINUTES=30 POOL_MON=25 npx tsx src/scripts/create-game.ts

cat <<MSG

==================================================================
 Open http://localhost:5173 once the web app starts below.

 Wallet (MetaMask etc.) — add a network:
   RPC URL  http://127.0.0.1:8545     Chain ID 31337     Symbol MON
 Then import this TEST account (10,000 MON, local only):
   0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
 (The app asks your wallet to switch/add the network automatically.)

 Email codes are shown on screen locally (no email service needed).
 Host page: http://localhost:5173/host   admin key: dev-admin-key
 Logs: .local-chain.log, .local-api.log
==================================================================

MSG

echo ">>> [5/5] Starting web app (Ctrl+C to stop everything)"
cd "$ROOT/frontend"
npm run dev
