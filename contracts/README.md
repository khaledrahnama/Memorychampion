# contracts

`MemoryGame.sol`, the on-chain part of the Monad Memory Challenge: prize pools, registration, results and payouts.

```bash
npm install
npm test                                          # unit tests (compiler bundled; no download needed)
DEPLOYER_PK=0x... npm run deploy:monad            # deploy to Monad testnet (needs test MON for gas)
```

`deploy:monad` prints the contract address. Set it as `CONTRACT_ADDRESS` for the API (Vercel env / `backend/.env`). By default the deployer is also the **operator**, the account the API uses to create and finalize games, so `OPERATOR_PRIVATE_KEY` should be the same key. Pass `OPERATOR_ADDRESS=0x…` to use a different operator.

## Functions

| Function | Who | What |
|---|---|---|
| `createGame(startTime, entryFee)` payable | operator | Creates a game; `msg.value` funds the prize pool |
| `joinGame(gameId)` payable | anyone | Registers the caller before `startTime` (pays `entryFee`, 0 for free games) |
| `finalizeGame(gameId, root, totalAllocated)` | operator | After the start: publishes the Merkle root of `(wallet, amount)` rewards and their total (`0x0`/`0` when nobody won) |
| `claimReward(gameId, amount, proof)` | winner | Pays the caller's allocated reward, once |
| `cancelGame(gameId)` | operator | Before the start only |
| `withdrawUnclaimed(gameId)` | organizer | Once: the funding of a cancelled game, or the unallocated part of a finalized pool |
| `refundEntryFee(gameId)` | player | Entry-fee refund for a cancelled game |
| `getGame(gameId)` / `getGameAccounting(gameId)` | view | Schedule, pool, player count, status / allocation details |

**Guarantees:** only the operator can create, finalize or cancel games. Rewards are capped at the published allocation. The organizer can never withdraw the winners' share. Every claim and refund can happen only once.

## Compilers

`hardhat.config.ts` points Hardhat at the solc compiler shipped in the `solc` npm package, so compiling never needs to reach `binaries.soliditylang.org`, which is blocked on some networks. `scripts/compile-solcjs.cjs` and `scripts/deploy-solcjs.cjs` compile and deploy with viem directly; the deploy scripts use them.
