import { spawn, execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Scan sound files and regenerate manifest before starting
console.log("[dev] Generating sound manifest...");
execSync(`node "${join(__dirname, "generate-sound-manifest.mjs")}"`, {
  stdio: "inherit",
});

const isWindows = process.platform === "win32";
const pnpmCommand = isWindows ? "pnpm.cmd" : "pnpm";

const children = ["dev:proxy", "dev:apps"].map((script) => {
  const child = spawn(pnpmCommand, ["run", script], {
    stdio: "inherit",
    shell: isWindows,
  });

  child.on("error", (error) => {
    console.error(`[${script}] ${error.message}`);
    process.exit(1);
  });

  return child;
});

let shuttingDown = false;

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
