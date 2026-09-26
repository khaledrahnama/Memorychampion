// Fallback compiler for environments where Hardhat's own compiler downloader
// (binaries.soliditylang.org) is blocked by network policy. Uses the `solc`
// npm package (compiler bundled, only needs the npm registry) instead.
// Usage: node scripts/compile-solcjs.cjs  ->  writes build/MemoryGame.json
const fs = require("fs");
const path = require("path");
const solc = require("solc");

const contractPath = path.join(__dirname, "..", "contracts", "MemoryGame.sol");
const source = fs.readFileSync(contractPath, "utf8");

function findImports(importPath) {
  try {
    const resolved = path.join(__dirname, "..", "node_modules", importPath);
    return { contents: fs.readFileSync(resolved, "utf8") };
  } catch (e) {
    return { error: `File not found: ${importPath}` };
  }
}

const input = {
  language: "Solidity",
  sources: { "MemoryGame.sol": { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } }
  }
};

const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));

const errors = (output.errors || []).filter((e) => e.severity === "error");
if (errors.length) {
  console.error(errors.map((e) => e.formattedMessage).join("\n"));
  process.exit(1);
}
(output.errors || []).forEach((e) => console.warn(e.formattedMessage));

const contract = output.contracts["MemoryGame.sol"]["MemoryGame"];
const buildDir = path.join(__dirname, "..", "build");
fs.mkdirSync(buildDir, { recursive: true });
fs.writeFileSync(
  path.join(buildDir, "MemoryGame.json"),
  JSON.stringify({ abi: contract.abi, bytecode: "0x" + contract.evm.bytecode.object }, null, 2)
);
console.log("Compiled OK ->", path.join(buildDir, "MemoryGame.json"));
