import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getDb } from "./db";
import { assets, insertModelVersion, listModels } from "./repo";

/**
 * Model seed: the registered model versions and their reference images, committed to the (private) repository so a
 * fresh server volume starts with the same models. Only model references: no packshots, productions or mood images.
 */
export const SEED_DIR = join(process.cwd(), "seed");

type SeedFile = { exportedAt: string; models: { status: string; data: any }[] };

/** Imports the seed when the database has no models yet. Every asset is verified against its content hash. */
/**
 * Models taken out of the library. Their versions are archived on every start (idempotent): they can no longer start a
 * production, and productions already made with them keep working. M05 Mei: removed by the owner on 2026-11-14.
 */
export const RETIRED_MODELS = ["M05"] as const;

export function retireModels(ids: readonly string[] = RETIRED_MODELS): number {
  if (!ids.length) return 0;
  const r = getDb().prepare(`UPDATE models SET status = 'archived' WHERE status = 'active' AND model_id IN (${ids.map(() => "?").join(",")})`).run(...ids);
  return Number(r.changes);
}

export async function seedIfEmpty(dir = SEED_DIR): Promise<{ imported: number; skipped?: string }> {
  if (listModels().length) return { imported: 0, skipped: "models already present" };
  const file = join(dir, "models.json");
  if (!existsSync(file)) return { imported: 0, skipped: "no seed" };
  const seed = JSON.parse(readFileSync(file, "utf8")) as SeedFile;
  const dirAssets = join(dir, "assets");
  for (const name of existsSync(dirAssets) ? readdirSync(dirAssets) : []) {
    const hash = await assets.putBytes(new Uint8Array(readFileSync(join(dirAssets, name))));
    if (!name.startsWith(hash.slice(7))) throw new Error(`Seed asset ${name} does not match its content hash`);
  }
  const db = getDb();
  db.exec("BEGIN");
  try {
    for (const m of seed.models) insertModelVersion(m.data, m.status);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  // Every reference the models point at must now resolve.
  for (const m of seed.models) for (const h of Object.values(m.data.refs).flat() as string[]) await assets.resolve(h);
  return { imported: seed.models.length };
}
