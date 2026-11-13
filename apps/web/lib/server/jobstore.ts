import type { JobRecord, JobStore } from "@ow-studio/core";
import { getDb } from "./db";

/** JobStore on the images table: the job record and a mirrored state column, updated together. */
export class SqliteJobStore implements JobStore {
  async get(id: string): Promise<JobRecord> {
    const r: any = getDb().prepare("SELECT job FROM images WHERE id = ?").get(id);
    if (!r) throw new Error(`Job ${id} not found`);
    return JSON.parse(r.job);
  }
  async save(job: JobRecord): Promise<void> {
    getDb().prepare("UPDATE images SET job = ?, state = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(job), job.state, job.id);
  }
}
