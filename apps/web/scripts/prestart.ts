/** Runs once before the server starts: database migrations (on open) and the model seed on an empty volume. */
import { getDb } from "../lib/server/db";
import { retireModels, seedIfEmpty } from "../lib/server/seed";

async function main() {
  getDb();
  const r = await seedIfEmpty();
  const retired = retireModels();
  console.log(`[prestart] database ready; model seed: ${r.imported ? `${r.imported} imported` : r.skipped}${retired ? `; retired ${retired} model version(s)` : ""}`);
}
main().catch((e) => {
  console.error("[prestart] failed:", e);
  process.exit(1);
});
