import type { JobRecord, JobStore } from "@ow-studio/core";
import { getDb } from "./db";

/** Job states that mean "finished with an image": shown as done only once the image's files are stored. */
const FINISHED: ReadonlySet<JobRecord["state"]> = new Set(["succeeded", "needs_review"]);

/** JobStore on the images table: the job record and a mirrored state column, updated together. */
export class SqliteJobStore implements JobStore {
  async get(id: string): Promise<JobRecord> {
    const r: any = getDb().prepare("SELECT job FROM images WHERE id = ?").get(id);
    if (!r) throw new Error(`Job ${id} not found`);
    return JSON.parse(r.job);
  }
  /**
   * `holdFinish`: a finished job (succeeded, needs_review) is mirrored as "validating" until the pipeline has stored its
   * files and sets the final state itself. A worker that stops in between leaves an unfinished image that is picked up
   * again, never one that reads as done without its file.
   */
  async save(job: JobRecord, opts: { holdFinish?: boolean } = {}): Promise<void> {
    const state = opts.holdFinish && FINISHED.has(job.state) ? "validating" : job.state;
    getDb().prepare("UPDATE images SET job = ?, state = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(job), state, job.id);
  }
}

/** The store the pipeline runs jobs with: finished states are held back until the files are stored (see save). */
export function holdingStore(store: SqliteJobStore = new SqliteJobStore()): JobStore {
  return { get: (id) => store.get(id), save: (job) => store.save(job, { holdFinish: true }) };
}
