/** Runs once before the server starts: database migrations (on open), and the seed's models the server does not have yet. */
import { getDb } from "../lib/server/db";
import { importSeed, retireModels } from "../lib/server/seed";

async function main() {
  getDb();
  const r = await importSeed();
  const retired = retireModels();
  console.log(`[prestart] database ready; model seed: ${r.imported ? `${r.imported} imported` : r.skipped}${retired ? `; retired ${retired} model version(s)` : ""}`);
  for (const c of r.clashes) console.warn(`[prestart] seed model skipped: ${c}`);
}
main().catch((e) => {
  console.error("[prestart] failed:", e);
  process.exit(1);
});
