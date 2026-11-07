import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Core-drift gate (D-257/D-258). The engine is a pinned submodule; a consumer must not
 * edit it in place. Fails if:
 *  - the submodule is missing or not initialized;
 *  - the checked-out commit differs from the pin recorded in the index;
 *  - any file under the submodule is locally modified.
 *
 * Usage: `npm run core:drift`. Exit 0 clean, 1 drifted.
 */
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIR = "chimera-core";

function git(args: string[]): { out: string; code: number } {
  const r = spawnSync("git", args, { cwd: ROOT, encoding: "utf8", shell: process.platform === "win32" });
  return { out: (r.stdout ?? "") + (r.stderr ?? ""), code: r.status ?? 1 };
}

if (!existsSync(`${ROOT}/${DIR}/core`)) {
  console.error(`core:drift: ${DIR}/ is missing. Run: git submodule update --init --recursive`);
  process.exit(1);
}

const pinned = git(["ls-tree", "HEAD", DIR]).out.trim().split(/\s+/)[2];
const head = git(["-C", DIR, "rev-parse", "HEAD"]).out.trim();

if (!pinned) {
  console.error(`core:drift: ${DIR} is not recorded in HEAD (stage and commit the submodule).`);
  process.exit(1);
}
if (pinned !== head) {
  console.error(`core:drift: ${DIR} is at ${head.slice(0, 7)} but pinned to ${pinned.slice(0, 7)}.`);
  console.error("  Commit the pin change deliberately, or reset the submodule to the pin.");
  process.exit(1);
}

const dirty = git(["-C", DIR, "status", "--porcelain"]).out.trim();
if (dirty) {
  console.error(`core:drift: ${DIR} has local edits — fix them upstream in Chimera and bump the pin:`);
  for (const line of dirty.split("\n").slice(0, 20)) console.error(`  ${line}`);
  process.exit(1);
}

console.log(`core:drift: ${DIR} matches its pin (${head.slice(0, 7)}) and is unmodified`);
