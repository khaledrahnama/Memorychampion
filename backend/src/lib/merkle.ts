import { encodeAbiParameters, keccak256, parseAbiParameters, zeroHash } from "viem";
import { MerkleTree } from "merkletreejs";

export interface RewardEntry {
  wallet: `0x${string}`;
  amountWei: bigint;
}

const toBuf = (hex: `0x${string}`) => Buffer.from(hex.slice(2), "hex");
const hashBuf = (b: Buffer) => toBuf(keccak256(`0x${b.toString("hex")}`));

// Matches MemoryGame.sol: keccak256(bytes.concat(keccak256(abi.encode(wallet, amount))))
function leaf(e: RewardEntry) {
  const inner = keccak256(encodeAbiParameters(parseAbiParameters("address, uint256"), [e.wallet, e.amountWei]));
  return toBuf(keccak256(inner));
}

/** Deterministic: the same entries always give the same root and proofs. */
export function buildRewardsTree(entries: RewardEntry[]) {
  if (entries.length === 0) {
    return { root: zeroHash, proofFor: (_e: RewardEntry) => [] as `0x${string}`[] };
  }
  const sorted = [...entries].sort((a, b) => a.wallet.toLowerCase().localeCompare(b.wallet.toLowerCase()));
  const tree = new MerkleTree(sorted.map(leaf), hashBuf, { sortPairs: true });
  return {
    root: `0x${tree.getRoot().toString("hex")}` as `0x${string}`,
    proofFor: (e: RewardEntry) => tree.getHexProof(leaf(e)) as `0x${string}`[]
  };
}
