/**
 * End-to-end test of the main flows in a real browser, against an isolated environment:
 * empty data directory, seeded models, login enabled, worker with the SIMULATED provider (no network, no cost).
 *
 *   npm run e2e -w web            (from the repository root; builds the app, uses the pre-installed Playwright Chromium)
 *   E2E_SHOTS=dir npm run e2e -w web   also writes screenshots of every page at 1440 and 390 px
 *
 * Fails on any assertion, page error or console error.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";

const require = createRequire(import.meta.url);
const { chromium, devices } = require("playwright");
const PORT = Number(process.env.E2E_PORT ?? 3400);
const BASE = `http://localhost:${PORT}`;
const PASSWORD = "e2e-password-123";
const SHOTS = process.env.E2E_SHOTS;
const data = mkdtempSync(join(tmpdir(), "ow-e2e-data-"));
const fixtures = mkdtempSync(join(tmpdir(), "ow-e2e-fixtures-"));
const env = { ...process.env, OW_DATA_DIR: data, OW_PASSWORD: PASSWORD, OW_SESSION_SECRET: "e".repeat(48), OW_PROVIDER: "simulated", GEMINI_API_KEY: "" };
const procs = [];
let lastPage = null;
const failures = [];
let step = "";

function check(cond, msg) {
  if (!cond) { failures.push(`${step}: ${msg}`); console.error(`  ✗ ${msg}`); } else console.log(`  ✓ ${msg}`);
}
async function stage(name, fn) { step = name; console.log(`\n${name}`); await fn(); }

async function makeFixtures() {
  const shot = async (shade, w = 900) => sharp({ create: { width: w, height: w, channels: 3, background: { r: 241, g: 241, b: 241 } } })
    .composite([{ input: { create: { width: Math.round(w / 3), height: Math.round(w * 0.7), channels: 3, background: { r: shade, g: shade, b: shade } } }, top: Math.round(w * 0.15), left: Math.round(w / 3) }]).jpeg().toBuffer();
  const files = {
    "Look-07/AB123-045_top-front.jpg": 30, "Look-07/AB123-045_top-back.jpg": 35, "Look-07/SH456-010-shoes.jpg": 20,
    "Look-08/CD789-001_front.jpg": 60, "Look-08/CD789-001_front (1).jpg": 70, "Look-08/CD789-001_back.jpg": 65, "Look-08/IMG_2231.jpg": 80,
  };
  for (const [p, shade] of Object.entries(files)) {
    mkdirSync(join(fixtures, "catalog", p, ".."), { recursive: true });
    await sharp(await shot(shade)).toFile(join(fixtures, "catalog", p));
  }
}

async function up() {
  const pre = spawnSync(process.execPath, ["--no-warnings", "--import", "tsx", "scripts/prestart.ts"], { env, stdio: "inherit" });
  if (pre.status !== 0) throw new Error("prestart failed");
  const nextBin = require.resolve("next/dist/bin/next");
  // Production build and server: what goes live, and no late hydration from first-time dev compiles.
  if (process.env.E2E_SKIP_BUILD !== "1") {
    const b = spawnSync(process.execPath, [nextBin, "build"], { env: { ...env, NODE_ENV: "production" }, stdio: ["ignore", "ignore", "inherit"] });
    if (b.status !== 0) throw new Error("next build failed");
  }
  procs.push(spawn(process.execPath, [nextBin, "start", "-p", String(PORT)], { env: { ...env, NODE_ENV: "production" }, stdio: ["ignore", "ignore", "inherit"] }));
  procs.push(spawn(process.execPath, ["--no-warnings", "--import", "tsx", "worker/index.ts"], { env, stdio: ["ignore", "ignore", "inherit"] }));
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("server did not start");
}

function watch(page, label) {
  page.on("pageerror", (e) => failures.push(`${label}: page error ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    // Expected: 401 before sign-in, and the one 404 of the deliberate missing-production check.
    if (/status of 401/.test(m.text()) || (/status of 404/.test(m.text()) && /prod_missing_/.test(m.location()?.url ?? ""))) return;
    failures.push(`${label}: console ${m.text()} (${m.location()?.url ?? ""})`);
  });
}
/** The first dev compile hydrates late: keep typing until the Sign in button reacts. */
async function typeUntilEnabled(page, text) {
  for (let i = 0; i < 60; i++) {
    await page.getByLabel("Password").fill(text);
    if (await page.getByRole("button", { name: "Sign in" }).isEnabled()) return;
    await page.waitForTimeout(1000);
  }
  throw new Error("login form never became interactive");
}
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true }); };

async function main() {
  await makeFixtures();
  await up();
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  lastPage = page;
  watch(page, "desktop");

  await stage("Login", async () => {
    await page.goto(`${BASE}/`);
    check(page.url().includes("/login"), "unauthenticated visit redirects to /login");
    check((await page.request.get(`${BASE}/api/overview`)).status() === 401, "API answers 401 without a session");
    await shot(page, "desk-login");
    await typeUntilEnabled(page, "wrong-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByText("Wrong password").waitFor();
    check(true, "wrong password is refused with a message");
    await typeUntilEnabled(page, PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(`${BASE}/`);
    await page.getByText("Studio overview").waitFor();
    await page.getByText("No productions yet").waitFor();
    check(true, "signed in; empty overview shows its empty state");
    await shot(page, "desk-overview-empty");
  });

  let draftUrl = "";
  await stage("Folder import with conflicts", async () => {
    await page.goto(`${BASE}/productions/new`);
    await page.getByRole("button", { name: "Choose folder" }).waitFor();
    await page.waitForTimeout(2000); // hydration after the first dev compile
    await page.locator("input[type=file][webkitdirectory]").setInputFiles(join(fixtures, "catalog"));
    // Uploads arrive in chunks: wait for each expected result instead of checking a half-finished upload.
    const appears = async (loc) => { try { await loc.first().waitFor({ timeout: 30000 }); return true; } catch { return false; } };
    await page.getByText("Needs a decision").waitFor({ timeout: 30000 });
    check(await appears(page.getByText("2 files for front")), "two fronts for one SKU are detected");
    check(await appears(page.getByText("Blocks run")), "conflicts block the run");
    check(await appears(page.getByText("Look-07", { exact: true })) && await appears(page.getByText("Look-08", { exact: true })), "folders become sets");
    check(await appears(page.getByText(/Accessory SH456-010/)), "shoe file is kept aside as an accessory");
    await page.getByText(/uploading/).waitFor({ state: "detached", timeout: 30000 }).catch(() => {});
    await shot(page, "desk-import-conflicts");
    await page.getByRole("button", { name: "Use this" }).first().click();
    const box = page.locator("div.border-ink");
    await box.getByRole("button", { name: "Ignore" }).click(); // IMG_2231
    await page.waitForTimeout(1200);
    await page.getByText(/Run production · 10 images/).waitFor({ timeout: 30000 });
    check(await page.locator("div.border-ink").count() === 0, "after resolving, nothing blocks; 10 images planned");
    await page.waitForTimeout(1500); // autosave
    draftUrl = page.url();
    check(/draft=draft_/.test(draftUrl), "the import session has its own URL");
  });

  await stage("Import session survives a reload", async () => {
    await page.goto(draftUrl);
    await page.getByText(/Run production · 10 images/).waitFor({ timeout: 30000 });
    check(await page.locator("div.border-ink").count() === 0, "resolved decisions are restored");
    await shot(page, "desk-import-ready");
  });

  let prodUrl = "";
  await stage("Run is idempotent", async () => {
    await page.getByRole("button", { name: /Run production/ }).dblclick();
    await page.waitForURL(/\/productions\/prod_/, { timeout: 30000 });
    prodUrl = page.url();
    const list = await (await page.request.get(`${BASE}/api/productions`)).json();
    check(list.productions.length === 1, "a double click creates exactly one production");
  });

  await stage("Generation (simulated) and review", async () => {
    const id = prodUrl.split("/").pop();
    // The simulated pipeline still runs real background normalisation on 2048 px images: allow up to 8 minutes.
    let states = [];
    for (let i = 0; i < 480; i++) {
      const p = await (await page.request.get(`${BASE}/api/productions/${id}`)).json();
      states = p.images.map((x) => x.state);
      if (states.every((x) => x === "succeeded")) break;
      await page.waitForTimeout(1000);
    }
    check(states.every((x) => x === "succeeded"), `all images succeeded (${states.join(",")})`);
    await page.goto(prodUrl);
    await page.getByText(/0 of 10 approved · 10 finished · 10 to review/).waitFor({ timeout: 30000 });
    check(true, "all 10 images finished; all waiting for review");
    await shot(page, "desk-production-review");
    await page.getByRole("button", { name: "Approve", exact: true }).first().click();
    await page.getByText(/1 of 10 approved/).waitFor();
    check(true, "approve updates the count");
    // Reject a different image than the approved one (approved tiles keep a Reject button).
    await page.getByRole("button", { name: "Reject", exact: true }).nth(1).click();
    await page.getByRole("button", { name: "New attempt (paid)" }).first().waitFor();
    await page.getByRole("button", { name: "New attempt (paid)" }).first().click();
    await page.getByText("2 attempts").first().waitFor({ timeout: 240000 });
    check(true, "a rejected image gets a new attempt; both attempts are kept");
    await page.getByText("2 attempts").first().click();
    await page.getByRole("button", { name: "Compare" }).click();
    await page.getByText("Attempt 1").first().waitFor();
    check(await page.getByText("Attempt 2").first().isVisible(), "lightbox compares attempts side by side");
    await page.waitForTimeout(800); // let the open animation finish before the screenshot
    await shot(page, "desk-lightbox-compare");
    await page.keyboard.press("Escape");

    // Hand fix: pick a point, confirm with a double click, exactly one paid edit, result as a new attempt beside the old.
    await page.locator("section button.block").nth(2).click();
    await page.getByRole("button", { name: /^Fix a hand in #1/ }).click();
    const target = page.getByRole("button", { name: "Click on the hand to fix" });
    const tb = await target.boundingBox();
    await target.click({ position: { x: tb.width * 0.6, y: tb.height * 0.55 } });
    check(await page.getByTestId("fix-box").waitFor({ timeout: 10000 }).then(() => true, () => false), "hand fix marks the square that will be sent");
    await page.getByRole("button", { name: /^Fix this hand · paid/ }).dblclick();
    await page.getByText("· hand fix").first().waitFor({ timeout: 120000 });
    const fixed = await (await page.request.get(`${BASE}/api/productions/${prodUrl.split("/").pop()}`)).json();
    const edits = fixed.images.flatMap((i) => i.edits ?? []);
    check(edits.length === 1 && edits[0].state === "succeeded" && edits[0].resultAttempt === 2, `a double click makes one hand fix, stored as attempt 2 (${JSON.stringify(edits.map((e) => e.state))})`);
    check(await page.getByText("Attempt 1").first().isVisible(), "the fixed attempt opens beside the original");
    await page.waitForTimeout(800);
    await shot(page, "desk-lightbox-handfix");
    await page.keyboard.press("Escape");
  });

  await stage("Downloads", async () => {
    const id = prodUrl.split("/").pop();
    const zip = await page.request.get(`${BASE}/api/productions/${id}/zip`);
    check(zip.status() === 200 && zip.headers()["content-type"] === "application/zip", "approved ZIP downloads");
    const all = await page.request.get(`${BASE}/api/productions/${id}/zip?all=1`);
    check(all.status() === 200 && (await all.body()).length > (await zip.body()).length, "ZIP with all finished images is larger");
    const p = await (await page.request.get(`${BASE}/api/productions/${id}`)).json();
    const one = await page.request.get(`${BASE}/api/images/${p.images[0].id}/download`);
    const meta = await sharp(await one.body()).metadata();
    check(one.status() === 200 && meta.width === 2000 && meta.height === 2000 && meta.format === "jpeg", "single download is a 2000 x 2000 JPEG");
  });

  await stage("Other pages, keyboard and missing production", async () => {
    for (const [path, text] of [["/productions", "Productions"], ["/models", "Models"], ["/settings", "2000 x 2000"], ["/", "Studio overview"]]) {
      await page.goto(`${BASE}${path}`);
      await page.getByText(text).first().waitFor();
      check(await noOverflow(page), `${path} has no horizontal scroll at 1440 px`);
      await shot(page, `desk${path.replace(/\//g, "-") || "-home"}`);
    }
    await page.keyboard.press("Tab");
    const ring = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
    check(ring !== "none", "keyboard focus is visible");
    await page.goto(`${BASE}/productions/prod_missing_000000`);
    await page.getByText("Not found").waitFor({ timeout: 15000 });
    check(true, "a missing production shows a clear not-found state");
  });

  await stage("Mobile (iPhone 13, 390 px)", async () => {
    const m = await browser.newContext({ ...devices["iPhone 13"], storageState: await ctx.storageState() });
    const mp = await m.newPage();
    watch(mp, "mobile");
    for (const path of ["/", "/productions", prodUrl.replace(BASE, ""), "/productions/new", "/models", "/settings"]) {
      await mp.goto(`${BASE}${path}`);
      await mp.waitForTimeout(2500);
      check(await noOverflow(mp), `${path} has no horizontal scroll at 390 px`);
      await shot(mp, `mob${path.replace(/\//g, "-").slice(0, 40) || "-home"}`);
    }
    check(await mp.getByRole("button", { name: "Log out" }).isVisible(), "log out is reachable on mobile");
    await m.close();
  });

  await stage("Health check and backup", async () => {
    const h = await fetch(`${BASE}/api/health`);
    check(h.ok && (await h.json()).ok === true, "health check answers without a session");
    const backups = readdirSync(join(data, "backups"));
    check(backups.some((f) => /^studio-\d{4}-\d{2}-\d{2}\.db$/.test(f)), "the worker wrote today's database backup");
  });

  await stage("Logout", async () => {
    await page.goto(`${BASE}/`);
    await page.getByRole("button", { name: "Log out" }).click();
    await page.waitForURL(/\/login/);
    await page.goto(`${BASE}/settings`);
    check(page.url().includes("/login"), "after logout pages need a new sign-in");
  });

  await browser.close();
}

main()
  .catch(async (e) => {
    failures.push(`${step}: ${e.message.split("\n")[0]}`);
    if (lastPage) await lastPage.screenshot({ path: join(SHOTS ?? tmpdir(), "e2e-failure.png") }).catch(() => {});
  })
  .finally(() => {
    for (const p of procs) p.kill("SIGTERM");
    rmSync(data, { recursive: true, force: true });
    rmSync(fixtures, { recursive: true, force: true });
    if (failures.length) { console.error(`\nE2E FAILED (${failures.length}):\n- ${failures.join("\n- ")}`); process.exit(1); }
    console.log("\nE2E passed");
    process.exit(0);
  });
