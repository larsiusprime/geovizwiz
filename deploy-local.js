// deploy-local.js (no dependencies)
const fs = require("fs/promises");
const path = require("path");
const { spawnSync } = require("child_process");

const repoRoot = process.cwd();
const deployDir = path.join(repoRoot, "local-deploy");
const staticSrc = path.join(repoRoot, "site");
const nodeAppSrc = path.join(repoRoot, "viz");
const utilAppSrc = path.join(repoRoot, "util");

async function rmrf(p) {
  await fs.rm(p, { recursive: true, force: true });
}

async function copyDir(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

(async () => {
  await rmrf(deployDir);
  await fs.mkdir(deployDir, { recursive: true });
  await copyDir(staticSrc, path.join(deployDir, "site"));
  await copyDir(nodeAppSrc, path.join(deployDir, "site/viz"));
  await copyDir(utilAppSrc, path.join(deployDir, "site/util"));

  // Start your app — adjust as needed:
  spawnSync("npm", ["start"], { cwd: path.join(deployDir, "viz"), stdio: "inherit" });
})();
