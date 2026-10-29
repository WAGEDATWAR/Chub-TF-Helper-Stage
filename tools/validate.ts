/**
 * Runs the parent's content validator over the merged (parent + overlay) set.
 * Any schema or referential error in a new genome fails here.
 */
import { validateContentSet } from "@core/validator";
import { mergedContentSet } from "./content";

const report = validateContentSet(mergedContentSet());

for (const w of report.warnings) console.error(`warn  ${w.rule} [${w.path}]: ${w.message}`);
for (const e of report.errors) console.error(`ERROR ${e.rule} [${e.path}]: ${e.message}`);

if (!report.ok) {
  console.error(`validate: ${report.errors.length} error(s)`);
  process.exit(1);
}
console.log(`validate: ok (${report.warnings.length} warning(s))`);
