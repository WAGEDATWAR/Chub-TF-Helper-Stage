import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * Which genome ids a working-tree change touches, for the `check` fast path. Prints a
 * comma-separated id list or `all`.
 *
 * Mirrors the parent (D-255). Attribution is deliberately conservative:
 *  - a change to shared machinery (a vendored core file, the merge, the offset
 *    overlays, the gates) widens to `all`;
 *  - otherwise a change to a genome's own block narrows to the ids in the diff;
 *  - a change with no genome id in it stays `all`, so narrowing only runs when safe.
 */
function git(args: string[]): string {
  return spawnSync("git", args, { cwd: ROOT, encoding: "utf8", shell: process.platform === "win32" }).stdout ?? "";
}

const files = [...git(["diff", "--name-only", "HEAD"]).split("\n"), ...git(["ls-files", "--others", "--exclude-standard"]).split("\n")]
  .map((f) => f.trim()).filter(Boolean);

if (files.length === 0) { console.log(""); process.exit(0); }

// shared machinery: any vendored core file, the merge/overlay plumbing, or a gate
const broad = files.some((f) =>
  /^(vendor\/core\/|src\/sim\/(registries|bundle|subject|cast)\.ts|src\/overlay\.ts|tools\/|src\/detect\/)/.test(f) ||
  /^(package\.json|tsconfig\.json|vite\.config\.ts)$/.test(f),
);
if (broad) { console.log("all"); process.exit(0); }

const text = git(["diff", "-U8", "HEAD"]) + files.join("\n");
const ids = new Set<string>();
for (const m of text.matchAll(/genome\.([a-z_]+)/g)) ids.add(`genome.${m[1]}`);
console.log([...ids].sort().join(",") || "all");
