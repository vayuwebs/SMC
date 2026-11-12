/**
 * Build the Windows installer without running the PC out of memory or disk.
 *
 *   npm run pack:win:safe
 *
 * It runs the ordinary `npm run pack:win`, with three guards around it:
 *
 *  - It refuses to start when the PC is already short: under MIN_FREE_RAM_GB of
 *    free memory, or under MIN_FREE_DISK_GB free on the project's drive. Better
 *    a clear message now than a frozen PC or a half-written installer later.
 *  - Node's heap is capped at about half the free memory (between 1 and 4 GB),
 *    so the Vite build cannot grow until Windows starts swapping.
 *  - TEMP / TMP point at .build-tmp/ on the project's drive for the duration.
 *    electron-builder unpacks Electron and compresses the installer there, and
 *    the system drive is usually the one that is full. Removed afterwards.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, statfsSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const TEMP = path.join(ROOT, ".build-tmp");
const MIN_FREE_RAM_GB = 1.5;
const MIN_FREE_DISK_GB = 4;

const GB = 1024 ** 3;
const freeRamGb = os.freemem() / GB;
const disk = statfsSync(ROOT);
const freeDiskGb = (disk.bavail * disk.bsize) / GB;

console.log(`free memory ${freeRamGb.toFixed(1)} GB, free disk on the project's drive ${freeDiskGb.toFixed(1)} GB`);

if (freeRamGb < MIN_FREE_RAM_GB) {
  console.error(
    `Only ${freeRamGb.toFixed(1)} GB of memory is free; the build needs at least ${MIN_FREE_RAM_GB} GB.\n` +
      `Close the browser and other programs, then run it again.`,
  );
  process.exit(1);
}
if (freeDiskGb < MIN_FREE_DISK_GB) {
  console.error(
    `Only ${freeDiskGb.toFixed(1)} GB is free on the project's drive; the build needs at least ${MIN_FREE_DISK_GB} GB.\n` +
      `Free some space (old release/ folders, the recycle bin), then run it again.`,
  );
  process.exit(1);
}

const heapMb = Math.round(Math.min(4096, Math.max(1024, (freeRamGb * 1024) / 2)));
console.log(`Node heap capped at ${heapMb} MB; temporary files in ${TEMP}`);

// The unpacked app from a previous build is rebuilt from scratch anyway.
rmSync(path.join(ROOT, "release", "win-unpacked"), { recursive: true, force: true });
mkdirSync(TEMP, { recursive: true });

const result = spawnSync("npm run pack:win", {
  cwd: ROOT,
  stdio: "inherit",
  shell: true,
  env: {
    ...process.env,
    NODE_OPTIONS: `${process.env["NODE_OPTIONS"] ?? ""} --max-old-space-size=${heapMb}`.trim(),
    TEMP,
    TMP: TEMP,
  },
});

rmSync(TEMP, { recursive: true, force: true });

if (result.status !== 0) {
  console.error(`\nThe build failed (exit code ${result.status ?? result.signal}).`);
  process.exit(result.status ?? 1);
}

const release = path.join(ROOT, "release");
for (const name of readdirSync(release).filter((each) => each.endsWith(".exe"))) {
  const size = statSync(path.join(release, name)).size / 1024 ** 2;
  console.log(`\ninstaller: ${path.join(release, name)} (${size.toFixed(0)} MB)`);
}
