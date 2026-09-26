import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying MemoryGame with operator/deployer:", deployer.address);

  const MemoryGame = await ethers.getContractFactory("MemoryGame");
  const operator = process.env.OPERATOR_ADDRESS || deployer.address;
  const memoryGame = await MemoryGame.deploy(operator);
  await memoryGame.waitForDeployment();

  const address = await memoryGame.getAddress();
  console.log("MemoryGame deployed to:", address);
  console.log("Operator set to:", operator);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
