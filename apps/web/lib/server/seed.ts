import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getDb } from "./db";
import { assets, insertModelVersion, listModels, setModelStatus } from "./repo";

/**
 * Model seed: the registered model versions and their reference images, committed to the (private) repository so a
 * server starts with the same models, and gets the ones added later on its next deploy. Only model references: no
 * packshots, productions or mood images.
 */
export const SEED_DIR = join(process.cwd(), "seed");

type SeedFile = { exportedAt: string; models: { status: string; data: any }[] };

/**
 * Models taken out of the library. Their versions are archived on every start (idempotent): they can no longer start a
 * production, and productions already made with them keep working. M05 Mei: removed by the owner on 2026-11-14.
 * M07 Liv, M08 Nadia, M09 Noa, M10 Kaia, M01 Sable, M06 Lucía: replaced on 2026-11-15 by new models of the same
 * types, made as real photographs (M13 Signe, M14 Yuna, M15 Elena, M16 Amara, M17 Mara, M18 Valeria); their
 * references could not be refreshed without the generator copying them.
 * M11 Freja, M12 Inés: removed by the owner on 2026-11-16.
 */
export const RETIRED_MODELS = ["M05", "M07", "M08", "M09", "M10", "M01", "M06", "M11", "M12"] as const;

export function retireModels(ids: readonly string[] = RETIRED_MODELS): number {
  if (!ids.length) return 0;
  const r = getDb().prepare(`UPDATE models SET status = 'archived' WHERE status = 'active' AND model_id IN (${ids.map(() => "?").join(",")})`).run(...ids);
  return Number(r.changes);
}

const refsOf = (data: any) => Object.values(data.refs).flat() as string[];

/**
 * Adds the seed's model versions that this server does not have yet (additive; run on every start). Nothing that is
 * already here is changed: an existing version is skipped, and a model id that this server uses for a different model
 * (for example one made with the model builder) is never overwritten. A new active version archives the server's older
 * active version of the same model (never a newer one); productions made with it keep working. Every asset is verified against its hash.
 */
export async function importSeed(dir = SEED_DIR): Promise<{ imported: number; skipped?: string; clashes: string[] }> {
  const file = join(dir, "models.json");
  if (!existsSync(file)) return { imported: 0, skipped: "no seed", clashes: [] };
  const seed = JSON.parse(readFileSync(file, "utf8")) as SeedFile;
  const here = listModels();
  const has = new Set(here.map((m) => `${m.modelId}@${m.version}`));
  const clashes: string[] = [];
  const missing = seed.models.filter((m) => {
    if (has.has(`${m.data.modelId}@${m.data.version}`)) return false;
    const other = here.find((x) => x.modelId === m.data.modelId && x.data.displayName !== m.data.displayName);
    if (other) { clashes.push(`${m.data.modelId} (${m.data.displayName}) is ${other.data.displayName} on this server`); return false; }
    return true;
  });
  if (!missing.length) return { imported: 0, skipped: "seed models already present", clashes };

  // Only the images the new versions need.
  const needed = new Set(missing.flatMap((m) => refsOf(m.data).map((h) => h.slice(7))));
  const dirAssets = join(dir, "assets");
  for (const name of existsSync(dirAssets) ? readdirSync(dirAssets) : []) {
    if (!needed.has(name.split(".")[0]!)) continue;
    const hash = await assets.putBytes(new Uint8Array(readFileSync(join(dirAssets, name))));
    if (!name.startsWith(hash.slice(7))) throw new Error(`Seed asset ${name} does not match its content hash`);
  }
  for (const m of missing) for (const h of refsOf(m.data)) await assets.resolve(h); // all present before anything is registered

  const db = getDb();
  db.exec("BEGIN");
  try {
    for (const m of missing) {
      let status = m.status;
      if (status === "active") {
        const active = listModels().filter((x) => x.modelId === m.data.modelId && x.status === "active");
        if (active.some((x) => x.version > m.data.version)) status = "archived"; // the server is already further along
        else for (const old of active) setModelStatus(old.modelId, old.version, "archived");
      }
      insertModelVersion(m.data, status);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return { imported: missing.length, clashes };
}
