// deploy-local.js (no external dependencies)
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

const fs = require("fs/promises");
const path = require("path");
const http = require("http");
const { spawnSync } = require("child_process");

const repoRoot = process.cwd();
const deployDir = path.join(repoRoot, "local-deploy");
const staticSrc = path.join(repoRoot, "site");
const utilSrc = path.join(repoRoot, "util");
const vizSrc = path.join(repoRoot, "viz");

const siteOut = path.join(deployDir, "site");
const vizOut = path.join(siteOut, "viz");
const utilOut = path.join(siteOut, "util");

const PORT = 3000;

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

function run(cmd, args, cwd) {
  const result = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
  if (result.error) {
    console.error(result.error);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".gif": "image/gif",
    ".ico": "image/x-icon",
    ".map": "application/json; charset=utf-8",
    ".wasm": "application/wasm",
    ".data": "application/octet-stream",
  }[ext] || "application/octet-stream";
}

function startServer(rootDir) {
  const server = http.createServer(async (req, res) => {
    try {
      const reqPath = decodeURIComponent(req.url.split("?")[0]);
      const safePath = reqPath.replace(/\.\./g, "");
      let filePath = path.join(rootDir, safePath);

      // Serve index.html at /
      if (reqPath === "/") {
        filePath = path.join(rootDir, "index.html");
      }

      // If path is a directory, try index.html
      const stat = await fs.stat(filePath).catch(() => null);
      if (stat && stat.isDirectory()) {
        filePath = path.join(filePath, "index.html");
      }

      const data = await fs.readFile(filePath);
      res.writeHead(200, { "Content-Type": contentType(filePath) });
      res.end(data);
    } catch (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
    }
  });

  server.listen(PORT, () => {
    console.log(`Local deploy server running at http://localhost:${PORT}`);
    console.log(`Root: ${rootDir}`);
  });
}

(async () => {
  await rmrf(deployDir);
  await fs.mkdir(deployDir, { recursive: true });

  await copyDir(staticSrc, siteOut);
  await copyDir(utilSrc, utilOut);

  // Build viz into local-deploy/site/viz
  // Ensure viz deps are installed once: cd viz && npm install
  console.log("Building viz into:", vizOut);
  run(npmCmd, ["run", "build", "--", "--outDir", vizOut, "--emptyOutDir"], vizSrc);
  console.log("Viz build complete");

  // Serve local-deploy/site
  console.log("Starting local server...");
  startServer(siteOut);
})();
