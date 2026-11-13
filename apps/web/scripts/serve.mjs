/**
 * Production entry point: prepares the data volume, then runs the web server and the generation worker side by side.
 * If either process stops, the other is stopped too and the container exits, so the platform restarts both.
 * Run from apps/web:  node scripts/serve.mjs
 */
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const port = process.env.PORT ?? "3000";
// Resolved like an import, so it works with npm workspaces (hoisted to the repository root) and in the container.
const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");

const pre = spawnSync(process.execPath, ["--no-warnings", "--import", "tsx", "scripts/prestart.ts"], { stdio: "inherit" });
if (pre.status !== 0) process.exit(pre.status ?? 1);

const children = [
  spawn(process.execPath, ["--no-warnings", "--import", "tsx", "worker/index.ts"], { stdio: "inherit" }),
  spawn(process.execPath, [nextBin, "start", "-p", port, "-H", "0.0.0.0"], { stdio: "inherit" }),
];

let stopping = false;
const stop = (code) => {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (c.exitCode === null) c.kill("SIGTERM");
  setTimeout(() => process.exit(code), 8000).unref();
};
for (const c of children) c.on("error", (e) => { console.error("[serve] could not start:", e.message); stop(1); });
for (const c of children) c.on("exit", (code) => { console.error(`[serve] ${c.spawnargs.slice(-3).join(" ")} exited (${code})`); stop(code || 1); });
for (const s of ["SIGTERM", "SIGINT"]) process.on(s, () => stop(0));
process.on("exit", () => { for (const c of children) if (c.exitCode === null) c.kill("SIGKILL"); });
