import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { MerkleTree } from "merkletreejs";
import keccak256 from "keccak256";

// Leaves match the contract: keccak256(bytes.concat(keccak256(abi.encode(wallet, amount))))
function leaf(address: string, amount: bigint) {
  const inner = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [address, amount]));
  return Buffer.from(ethers.getBytes(ethers.keccak256(inner)));
}

function buildTree(entries: { address: string; amount: bigint }[]) {
  const tree = new MerkleTree(entries.map((e) => leaf(e.address, e.amount)), keccak256, { sortPairs: true });
  return { root: tree.getHexRoot(), proof: (e: { address: string; amount: bigint }) => tree.getHexProof(leaf(e.address, e.amount)) };
}

describe("MemoryGame", function () {
  async function deploy() {
    const [owner, operator, player1, player2, outsider] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("MemoryGame");
    const game = await Factory.deploy(operator.address);
    await game.waitForDeployment();
    return { game, owner, operator, player1, player2, outsider };
  }

  async function startIn(seconds: number) {
    return (await time.latest()) + seconds;
  }

  it("creates and funds a game; only the operator can create", async function () {
    const { game, operator, outsider } = await deploy();
    const start = await startIn(3600);
    await expect(game.connect(outsider).createGame(start, 0, { value: 1n })).to.be.revertedWith("MemoryGame: not operator");
    await expect(game.connect(operator).createGame(start, 0, { value: ethers.parseEther("10") })).to.emit(game, "GameCreated");

    const info = await game.getGame(0);
    expect(info.pool).to.equal(ethers.parseEther("10"));
    expect(info.status).to.equal(0); // Open
  });

  it("registers players before start and blocks duplicate and late joins", async function () {
    const { game, operator, player1, player2 } = await deploy();
    const start = await startIn(3600);
    await game.connect(operator).createGame(start, 0, { value: ethers.parseEther("10") });

    await game.connect(player1).joinGame(0);
    await expect(game.connect(player1).joinGame(0)).to.be.revertedWith("MemoryGame: already registered");
    expect((await game.getGame(0)).participantCount).to.equal(1);

    await time.increaseTo(start);
    await expect(game.connect(player2).joinGame(0)).to.be.revertedWith("MemoryGame: registration closed");
  });

  it("pays each winner once, and the organizer can only withdraw the unallocated remainder", async function () {
    const { game, operator, player1, player2 } = await deploy();
    const start = await startIn(60);
    await game.connect(operator).createGame(start, 0, { value: ethers.parseEther("10") });
    await game.connect(player1).joinGame(0);
    await game.connect(player2).joinGame(0);
    await time.increaseTo(start + 60);

    // Two winners get 3 MON each out of a 10 MON pool, leaving 4 MON unallocated.
    const e1 = { address: player1.address, amount: ethers.parseEther("3") };
    const e2 = { address: player2.address, amount: ethers.parseEther("3") };
    const { root, proof } = buildTree([e1, e2]);
    await game.connect(operator).finalizeGame(0, root, ethers.parseEther("6"));

    // Organizer withdraws only the 4 MON that was never allocated — winners' 6 MON stays put.
    await expect(game.connect(operator).withdrawUnclaimed(0)).to.changeEtherBalance(operator, ethers.parseEther("4"));
    await expect(game.connect(operator).withdrawUnclaimed(0)).to.be.revertedWith("MemoryGame: already withdrawn");

    await expect(game.connect(player1).claimReward(0, e1.amount, proof(e1))).to.changeEtherBalance(player1, e1.amount);
    await expect(game.connect(player1).claimReward(0, e1.amount, proof(e1))).to.be.revertedWith("MemoryGame: already claimed");
    await expect(game.connect(player2).claimReward(0, e2.amount, proof(e2))).to.changeEtherBalance(player2, e2.amount);
  });

  it("rejects proofs for someone else's allocation", async function () {
    const { game, operator, player1, player2 } = await deploy();
    const start = await startIn(60);
    await game.connect(operator).createGame(start, 0, { value: ethers.parseEther("5") });
    await game.connect(player1).joinGame(0);
    await time.increaseTo(start + 60);

    const e1 = { address: player1.address, amount: ethers.parseEther("5") };
    const { root, proof } = buildTree([e1]);
    await game.connect(operator).finalizeGame(0, root, e1.amount);
    await expect(game.connect(player2).claimReward(0, e1.amount, proof(e1))).to.be.revertedWith("MemoryGame: invalid proof");
  });

  it("with no winners, finalizes with an empty root and returns the whole pool to the organizer", async function () {
    const { game, operator, player1 } = await deploy();
    const start = await startIn(60);
    await game.connect(operator).createGame(start, 0, { value: ethers.parseEther("7") });
    await game.connect(player1).joinGame(0);
    await time.increaseTo(start + 60);

    await expect(game.connect(operator).finalizeGame(0, ethers.ZeroHash, 1)).to.be.revertedWith("MemoryGame: root/allocation mismatch");
    await game.connect(operator).finalizeGame(0, ethers.ZeroHash, 0);
    await expect(game.connect(operator).withdrawUnclaimed(0)).to.changeEtherBalance(operator, ethers.parseEther("7"));
  });

  it("on cancellation, players refund their own entry fees and the organizer gets only their funding", async function () {
    const { game, operator, player1 } = await deploy();
    const start = await startIn(3600);
    await game.connect(operator).createGame(start, ethers.parseEther("1"), { value: ethers.parseEther("2") });
    await game.connect(player1).joinGame(0, { value: ethers.parseEther("1") });

    await game.connect(operator).cancelGame(0);
    await expect(game.connect(operator).withdrawUnclaimed(0)).to.changeEtherBalance(operator, ethers.parseEther("2"));
    await expect(game.connect(player1).refundEntryFee(0)).to.changeEtherBalance(player1, ethers.parseEther("1"));
    await expect(game.connect(player1).refundEntryFee(0)).to.be.revertedWith("MemoryGame: already refunded");
  });

  it("only the operator can finalize, and not before the start", async function () {
    const { game, operator, outsider } = await deploy();
    const start = await startIn(3600);
    await game.connect(operator).createGame(start, 0, { value: 1n });
    await expect(game.connect(operator).finalizeGame(0, ethers.ZeroHash, 0)).to.be.revertedWith("MemoryGame: game has not started");
    await time.increaseTo(start);
    await expect(game.connect(outsider).finalizeGame(0, ethers.ZeroHash, 0)).to.be.revertedWith("MemoryGame: not operator");
  });
});
