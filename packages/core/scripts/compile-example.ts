import { compileProduction, MOCK_PROFILE } from "../src/index.js";
import { exampleSpec } from "../src/fixtures.js";

const r = compileProduction(exampleSpec(), MOCK_PROFILE);

console.log(`spec ${r.specHash}`);
console.log(`canRun: ${r.canRun}, images: ${r.images.length}, conflicts: ${r.conflicts.length}\n`);
for (const c of r.conflicts) console.log(`  [${c.severity}] ${c.code} ${c.sku ?? ""} ${c.message}`);
console.log();
for (const i of r.images) {
  console.log(`${i.sku.padEnd(12)} ${i.preset.padEnd(14)} pose=${i.assignment.poseId.padEnd(20)} expr=${i.assignment.expressionId.padEnd(20)} refs=${i.refs.map((x) => x.role).join(",")}`);
}
const sample = r.images.find((i) => i.sku === "TEST-TP-002" && i.preset === "front_crop")!;
console.log(`\n--- prompt: ${sample.sku} ${sample.preset} (${sample.compileHash.slice(0, 20)}…) ---\n`);
console.log(sample.prompt);
