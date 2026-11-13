// Prints the realism score table and totals from realism-scores.json (or another scores file given as argument).
import { readFileSync } from "node:fs";
const f = process.argv[2] ?? new URL("./realism-scores.json", import.meta.url);
const s = JSON.parse(readFileSync(f, "utf8"));
const ids = Object.keys(s.defects);
const head = `| Image | ${ids.join(" | ")} | Sum |\n|---|${ids.map(() => "---").join("|")}|---|`;
const totals = Object.fromEntries(ids.map((d) => [d, 0]));
const rows = s.images.map(([name, sc]) => {
  let sum = 0;
  const cells = ids.map((d) => { const v = sc[d] ?? 0; totals[d] += v; sum += v; return v ? String(v) : "·"; });
  return `| ${name} | ${cells.join(" | ")} | ${sum} |`;
});
const grand = Object.values(totals).reduce((a, b) => a + b, 0);
console.log([head, ...rows, `| **Total** | ${ids.map((d) => `**${totals[d]}**`).join(" | ")} | **${grand}** |`].join("\n"));
