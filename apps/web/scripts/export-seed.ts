/**
 * Writes the active model versions and their reference images to apps/web/seed/ (committed), so a new server starts
 * with the same models. Run from apps/web:  npx tsx scripts/export-seed.ts
 */
import { copyFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ASSET_DIR } from "../lib/server/db";
import { listModels } from "../lib/server/repo";

const out = join(process.cwd(), "seed");
rmSync(join(out, "assets"), { recursive: true, force: true });
mkdirSync(join(out, "assets"), { recursive: true });
const models = listModels().filter((m) => m.status === "active");
const files = readdirSync(ASSET_DIR);
const hashes = new Set(models.flatMap((m) => Object.values(m.data.refs).flat() as string[]));
for (const h of hashes) {
  const f = files.find((n) => n.startsWith(h.slice(7) + "."));
  if (!f) throw new Error(`Missing asset ${h}`);
  copyFileSync(join(ASSET_DIR, f), join(out, "assets", f));
}
writeFileSync(join(out, "models.json"), JSON.stringify({ exportedAt: new Date().toISOString(), models: models.map((m) => ({ status: m.status, data: m.data })) }, null, 2) + "\n");
console.log(`seed: ${models.length} models, ${hashes.size} assets`);
