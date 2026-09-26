// Builds the whole app for Vercel using the Build Output API
// (https://vercel.com/docs/build-output-api/v3):
//   .vercel/output/static/             <- the React app (frontend/dist)
//   .vercel/output/functions/api.func/ <- the Express API, bundled into one file
//   .vercel/output/config.json         <- /api/* goes to the function, everything else to the SPA
//
// Vercel runs this via `npm run vercel-build` (see vercel.json). You can also
// run it locally: `npm run vercel-install && npm run vercel-build`.
import { execSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, ".vercel", "output");
const fnDir = path.join(out, "functions", "api.func");

rmSync(out, { recursive: true, force: true });
mkdirSync(fnDir, { recursive: true });

console.log("▸ Building frontend");
execSync("npm run build", { cwd: path.join(root, "frontend"), stdio: "inherit" });
cpSync(path.join(root, "frontend", "dist"), path.join(out, "static"), { recursive: true });

console.log("▸ Bundling API function");
const esbuild = createRequire(path.join(root, "backend", "package.json"))("esbuild");
await esbuild.build({
  entryPoints: [path.join(root, "backend", "src", "app.ts")],
  outfile: path.join(fnDir, "index.mjs"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  // Some bundled CommonJS dependencies call require() on Node built-ins.
  banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" },
  // pg-native is optional; PGlite is only for local dev (production uses DATABASE_URL).
  external: ["pg-native", "@electric-sql/pglite", "cloudflare:sockets"],
  logLevel: "warning"
});

writeFileSync(
  path.join(fnDir, ".vc-config.json"),
  JSON.stringify({ runtime: "nodejs22.x", handler: "index.mjs", launcherType: "Nodejs", shouldAddHelpers: false, maxDuration: 60 }, null, 2)
);

writeFileSync(
  path.join(out, "config.json"),
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: "^/api(/.*)?$", dest: "/api" },
        { src: "^/assets/(.*)$", headers: { "cache-control": "public, max-age=31536000, immutable" }, continue: true },
        { handle: "filesystem" },
        { src: "/.*", dest: "/index.html" }
      ]
    },
    null,
    2
  )
);

console.log("✓ Vercel build output written to .vercel/output");
