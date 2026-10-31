import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, statSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * `check`: one command, one report — the verification set a change must pass before a
 * commit. Mirrors the parent's speed work (D-254/D-255) without losing coverage:
 *
 *  - **content-hash skipping**: if nothing under `vendor/` (core + data) changed since
 *    the last green check, the content gates (authoring, data-check, golden) are
 *    skipped. `--all` forces them; `--full` additionally forces them and widens the
 *    genome scope.
 *  - **genome narrowing**: content stages take `AFFECTED_GENOMES` from `tools/affected.ts`
 *    so a single-genome edit lints only that genome. Shared-machinery edits widen to
 *    `all` automatically.
 *
 * A red run never writes the stamp, so it always re-checks next time.
 */
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const full = process.argv.includes("--full");
const force = process.argv.includes("--all") || full;
const STAMP = join(ROOT, "node_modules", ".cache", "chrysalis-helper-check-hash");

interface Check {
  name: string;
  args: string[];
  /** Content gates depend on vendor/ (core+data); skipped when unchanged. */
  contentSensitive?: boolean;
}

const CHECKS: Check[] = [
  { name: "typecheck", args: ["run", "typecheck"] },
  { name: "validate", args: ["run", "validate"], contentSensitive: true },
  { name: "authoring", args: ["run", "lint:authoring"], contentSensitive: true },
  { name: "data-check", args: ["run", "data-check"], contentSensitive: true },
  { name: "smoke", args: ["run", "smoke"] },
  { name: "detect", args: ["run", "detect"] },
  { name: "detect-eval", args: ["run", "detect-eval"] },
  { name: "coupling", args: ["run", "coupling"] },
  { name: "pace", args: ["run", "pace"] },
  { name: "name-restore", args: ["run", "name-restore"] },
  { name: "time", args: ["run", "time"] },
  { name: "lycan", args: ["run", "lycan"] },
  { name: "eyes", args: ["run", "eyes"], contentSensitive: true },
  { name: "drive", args: ["run", "drive"] },
  { name: "visualize", args: ["run", "visualize"] },
  { name: "golden", args: ["run", "golden"], contentSensitive: true },
  { name: "persist", args: ["run", "persist"] },
  { name: "control", args: ["run", "control"] },
  { name: "genital", args: ["run", "genital"] },
  { name: "mirror", args: ["run", "mirror"] },
  { name: "multigenome", args: ["run", "multigenome"] },
];

/** Hash of every vendored core/data file's path+mtime+size (the content set). */
function contentHash(): string {
  const h = createHash("sha1");
  const walk = (rel: string): void => {
    const abs = join(ROOT, rel);
    const st = statSync(abs);
    if (st.isDirectory()) for (const e of readdirSync(abs).sort()) walk(`${rel}/${e}`);
    else h.update(`${rel}:${st.mtimeMs}:${st.size}\n`);
  };
  walk("vendor");
  return h.digest("hex");
}

let contentChanged = true;
let affected = "all";
if (!force) {
  const hash = contentHash();
  let last = "";
  try { last = readFileSync(STAMP, "utf8").trim(); } catch { /* first run */ }
  contentChanged = hash !== last;
  if (!contentChanged) {
    console.log("check: no vendor/ change since the last green check — skipping content gates (use --all to force).");
  } else {
    const r = spawnSync("npx", ["tsx", "tools/affected.ts"], { cwd: ROOT, encoding: "utf8", shell: process.platform === "win32" });
    if (r.status === 0 && r.stdout.trim()) affected = r.stdout.trim();
  }
}

const results: Array<{ name: string; ok: boolean; ms: number; skipped?: boolean }> = [];
let failed = 0;

for (const check of CHECKS) {
  if (check.contentSensitive && !contentChanged) {
    results.push({ name: check.name, ok: true, ms: 0, skipped: true });
    continue;
  }
  const started = Date.now();
  process.stdout.write(`\n=== ${check.name} ===\n`);
  const env = { ...process.env, ...(check.contentSensitive ? { AFFECTED_GENOMES: affected } : {}) };
  const r = spawnSync("npm", check.args, { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32", env });
  const ok = r.status === 0;
  results.push({ name: check.name, ok, ms: Date.now() - started });
  if (!ok) failed++;
}

if (failed === 0 && !force) {
  try {
    mkdirSync(join(ROOT, "node_modules", ".cache"), { recursive: true });
    writeFileSync(STAMP, contentHash());
  } catch { /* best-effort */ }
}

console.log("\n=== check summary ===");
for (const r of results) console.log(`${r.skipped ? "skip" : r.ok ? "ok  " : "FAIL"} ${r.name}${r.ms ? ` (${r.ms}ms)` : ""}`);
if (failed > 0) {
  console.error(`\ncheck: ${failed} stage(s) failed`);
  process.exit(1);
}
console.log("\ncheck: all green");
