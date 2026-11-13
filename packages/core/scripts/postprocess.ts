/** Normalise backgrounds of generated images: npx tsx scripts/postprocess.ts <inDir> <outDir> */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { normalizeBackground } from "../src/post/background";

const [inDir = "out/phase3", outDir = "out/phase3/final"] = process.argv.slice(2);
await mkdir(outDir, { recursive: true });
for (const f of (await readdir(inDir)).filter((f) => f.endsWith(".jpg") && !f.startsWith("ref-")).sort()) {
  const t = Date.now();
  const { bytes, report } = await normalizeBackground(new Uint8Array(await readFile(join(inDir, f))));
  await writeFile(join(outDir, f), bytes);
  console.log(`${f.padEnd(30)} ok=${report.ok} bg=${(report.backgroundFraction * 100).toFixed(1)}% pockets=${report.enclosedPockets} before=${report.modelMeanBefore} corners=${JSON.stringify(report.cornerMeansAfter)} ${Date.now() - t}ms`);
}
