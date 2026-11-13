/**
 * Prints the exact compiled requests for a production draft, optionally with a session anchor frozen in.
 * No API calls.   npx tsx scripts/inspect-payload.ts <draft.json> [anchorAssetHash]
 */
import { readFileSync } from "node:fs";
import { compileProduction } from "@ow-studio/core";
import { buildSpecForInspection, DEFAULT_PROFILE } from "../lib/server/repo";

async function main() {
const [draftPath, anchorArg] = process.argv.slice(2);
const anchor = anchorArg?.startsWith("sha256:") ? anchorArg : undefined;
const draft = JSON.parse(readFileSync(draftPath!, "utf8"));
const spec = await buildSpecForInspection(draft);
const r = compileProduction(spec, DEFAULT_PROFILE, undefined, anchor ? { anchors: { [draft.products[0].sku]: anchor } } : {});
for (const i of r.images) {
  console.log(`\n=== ${i.preset}  ${i.compileHash.slice(0, 20)}  dependsOn=${i.dependsOn ? i.dependsOn.slice(0, 12) : "-"}`);
  i.refs.forEach((x, n) => console.log(`  ref ${n + 1}: ${x.role.padEnd(20)} ${x.asset.slice(7, 19)}  controls=${x.controls.join(",")}`));
}
// --blocks framing,pose prints those instruction blocks for every shot.
const bi = process.argv.indexOf("--blocks");
if (bi > 0) {
  const keys = process.argv[bi + 1]!.split(",");
  for (const i of r.images) for (const k of keys) console.log(`[${i.preset} · ${k}] ${i.instructionBlocks.find((b) => b.key === k)?.text ?? "-"}`);
  return;
}
const styled = r.images.find((i) => i.preset === "styled_full")!;
console.log("\n--- styled_full prompt ---\n" + styled.prompt);
}
main().catch((e) => { console.error(e); process.exit(1); });
