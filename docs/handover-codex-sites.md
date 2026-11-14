# Handover: deploy OW Studio on ChatGPT Sites

You are taking over a working, tested application and moving it to ChatGPT Sites. The goal is the **same behaviour on a new runtime**, not a redesign. Read this file completely before changing code.

## 1. What the app does

Internal tool for a fashion e-commerce team. A user imports garment packshots (folders of images), picks a registered fictional model, and the app generates a consistent on-model image set per garment (front, three-quarter, back, styled, close-up) with Google's Nano Banana Pro (`gemini-3-pro-image`). Every generated image is reviewed (approve or reject per attempt) and approved images are exported as 2000 x 2000 px JPEGs.

## 2. Code map

| Path | What |
|---|---|
| `packages/core/src/` | Pure domain logic, no I/O except image processing: prompt compiler (`compiler.ts`, `templates.ts`, `references.ts`, `presets.ts`, `poses.ts`, `garmentConstraints.ts`), job state machine (`jobs.ts`), provider adapter (`providers/gemini.ts`), measurements from packshots (`silhouette.ts`: colour, hem side, leg shape, fabric crop), post-processing (`post/background.ts`, `post/export.ts`). `post/handfix.ts` and `GeminiProvider.edit` are a tested building block that the app does not use (see `docs/review-and-import.md`, Hand fix). **Port unchanged.** |
| `apps/web/lib/server/db.ts` | SQLite (Node's built-in `node:sqlite`), schema and additive migrations |
| `apps/web/lib/server/repo.ts` | All data access: models, productions, images, attempts, review, drafts, ZIP entries, budget |
| `apps/web/lib/server/pipeline.ts` | One worker step for one image (freeze session anchor, run job, store output as a new attempt) |
| `apps/web/worker/index.ts` | Long-running worker: claims queued images with leases, runs `processImage`, daily DB backup |
| `apps/web/lib/server/seed.ts`, `apps/web/seed/` | 7 registered models and their 42 reference images, imported on an empty database |
| `apps/web/lib/auth.ts`, `apps/web/proxy.ts` | Shared-password login, signed session cookie, guard on paid and writing routes |
| `apps/web/app/` | Next.js 16 App Router (Cache Components on), HeroUI v3 UI, API route handlers |
| `apps/web/lib/import.ts`, `lib/outcome.ts` | Folder import parsing; status and metrics (pure, shared with the client) |
| `apps/web/lib/client.ts` | Client JSON fetch: 401 returns to the login, 404 and network errors get their own UI states |
| `apps/web/lib/server/simulated.ts` | Simulated provider (the real Gemini adapter with a local fake fetch). Worker uses it with `OW_PROVIDER=simulated`: no network, no cost |
| `apps/web/e2e/run.mjs` | End-to-end test in Chromium against a production build with isolated data and the simulated worker |
| `docs/realism-audit.md`, `docs/audit/` | Realism defect checklist, scores and the benchmark A/B tooling |
| `docs/` | Decisions and test findings. `docs/review-and-import.md` and `docs/consistency.md` explain the current behaviour |

Next.js 16 differs from older versions: read `node_modules/next/dist/docs/` before changing framework code (`proxy.ts` replaces middleware, `RouteContext`, `connection()` for request-time route handlers).

## 3. Invariants that must survive the move

These are product rules, each covered by tests. If the new runtime makes one impossible, stop and report instead of weakening it.

1. **No paid call without a human decision.** Only non-billable errors (`network_before_accept`, `rate_limited`, `server_error_unbilled`) retry automatically. Anything that may have been billed goes to `awaiting_approval`. A new attempt for a finished image requires rejecting it first. (`packages/core/src/jobs.ts`, `repo.retryImage`)
2. **Unknown outcome is its own state.** A request that was sent but never answered (`timeout_after_accept`, `uncertain_submission`, `unknown`) is shown as "Unknown outcome, may have cost", never as a plain failure. (`lib/outcome.ts`)
3. **Idempotent creation.** The client sends a `createKey`; the same key always returns the same production, including under concurrent requests. (`repo.createProduction`, unique index on `productions.create_key`)
4. **Every attempt is kept.** A retry never overwrites an earlier image; review is per attempt; at most one approved attempt per image. (`attempts` table, `repo.recordAttempt`, `repo.setReview`)
5. **Frozen requests.** A job only ever runs the exact compiled request it was created with (`compileHash`). The session anchor (the SKU's approved front shot) is frozen into dependent shots once, before their first submission, and never on a retry. Mixed compiler versions inside one production are refused. (`repo.freezeAnchor`)
6. **Dependent shots wait for the anchor.** With the session anchor on, the other shots of a SKU are not submitted until its front shot has succeeded.
7. **The API key never reaches the browser** and is never committed. It is read from the environment on the server only.
8. **Budget cap.** No submission when the estimated cost exceeds the monthly budget left (`OW_BUDGET_USD`, default 25).
9. **Output.** Provider output is requested at the 2K tier (2048 x 2048 for 1:1). The background is normalised to RGB 241 (`post/background.ts`); exports are exactly 2000 x 2000 px sRGB JPEG, quality 95, 4:4:4 (`post/export.ts`), in the ZIP and in single downloads. The ZIP holds approved images only by default, plus `manifest.csv`.
10. **Access control.** Every page and API needs a session; in production without `OW_PASSWORD` and `OW_SESSION_SECRET` the app refuses everything (503) rather than running open.
11. **Content.** Models are original fictional adults. Brand packshots used in tests are internal test material: do not publish them, do not put them in public assets, do not copy the brand's logo onto anything public.
12. **Realism language stays in the compiler** (`REAL_HAIR`, `REAL_HANDS`, `REAL_BODY`, the body-skin and lighting text in `templates.ts`, and the exclusions). It is covered by tests. Lesson from the benchmark: never ask the light to "show the garment's folds"; it added gathers to a smooth dress.
13. **A paid output is never lost.** The provider output is stored before post-processing; if background normalisation or the colour check fails, the raw output becomes the final.
14. **Automatic checks only flag what they can be trusted on.** The colour-drift check compares the image cluster nearest the packshot colour; it never blocks, it labels the image "Check colour" for review.

## 4. What probably has to change for Sites

Check each against the Sites runtime documentation before you start, and write down what you found.

| Current | Requirement | If Sites cannot do it as is |
|---|---|---|
| SQLite file via `node:sqlite` | Transactions, a unique index, conditional updates for job leases | Use the persistent store Sites provides. Keep `repo.ts` as the only data-access layer and keep its function signatures, so the tests still apply. |
| Content-addressed image files on disk (`LocalAssetStore`, `sha256:<hex>` ids) | Persistent binary storage, about 5–10 MB per generated image | Use Sites' file/blob storage behind the same `put`/`putBytes`/`resolve` interface. Keep the hash as the id. |
| Long-running worker process | Claim queued images, run each for 20–60 s per provider call, keep going when no browser is open | Use Sites' background/scheduled jobs. Keep the lease logic: a crashed step must be picked up again, never run twice in parallel. |
| `sharp` (native image library) | Background normalisation, fabric crop, measurements, 2000 px export | If unavailable, report it: these steps are part of the output quality. Do not drop them silently. |
| Environment secrets | `GEMINI_API_KEY`, `OW_PASSWORD`, `OW_SESSION_SECRET`, optional `OW_BUDGET_USD` | Use Sites' secret storage. Never hard-code or log them. |
| Request duration | Gemini calls take 20–60 s; ZIP export processes up to tens of images | If request time limits are shorter, the generation must stay in background jobs, not in a request. |

Known runtime note from OpenAI's documentation: Sites does not support data residency at launch. Tell the owner if that matters for where packshots are stored.

## 5. Do not

- Make paid generation calls while porting. Use the simulated provider in the tests (the real `GeminiProvider` with a fake `fetch`, see `apps/web/test/catalog.test.ts`).
- Change prompts, templates, reference order or the compiler version to "simplify". The current output quality was reached through measured iterations (see `docs/`).
- Remove or loosen a test to make the port pass.
- Commit keys, the local data directory, or brand packshots.

## 6. Acceptance

Run from the repository root:

```bash
npm test --workspaces --if-present
npm run typecheck -w web
```

Today: 113 tests in `packages/core` and 24 in `apps/web` (folder import, idempotent creation, attempts, ZIP, metrics, unknown outcome, session anchor, access control, colour check, realism language). All must pass on the new data layer.

End to end (run it before and after the port; it starts its own isolated server and simulated worker, no paid calls). Node 22.13 or newer (`node:sqlite`). Install the browser once:

```bash
npx playwright install --with-deps chromium
npm run e2e -w web
```

It checks 36 things in a real browser: login and logout, folder import with conflicts, the import session after a reload, idempotent Run, simulated generation, approve/reject/new attempt/compare, the approved ZIP and 2000 px downloads, every page at 1440 and 390 px without horizontal scroll or console errors, keyboard focus, the not-found state, the health check and the daily backup. On Sites, run the same flows against the deployed site with `OW_PROVIDER=simulated` on a staging copy if the runtime allows it; otherwise by hand. Then check by hand on the deployed site, without paid calls:

1. Unauthenticated: pages redirect to the login, APIs answer 401.
2. After login: the 7 models are listed (seeded).
3. New production: import a folder; SKU and angle are recognised with their source; two files for one angle block Run.
4. Run is idempotent (double click gives one production) and the images wait in the queue.
5. Only then, with the owner's approval, one real production of one garment (5 images, about $0.80): the front generates first, the others follow, approve and reject work, the ZIP holds approved images at 2000 x 2000.

## 7. Data

A fresh deployment needs only the seed (`apps/web/seed/`, imported automatically on an empty database). Productions made on the old setup are not migrated.

## 8. State at handover (2026-11-13)

- Realism work is done for now (`docs/realism-audit.md`, results section): compiler template `tpl-2026.11.14e`, and all seven models refreshed to new versions with five-panel character sheets (`docs/model-look.md`). The seed (`apps/web/seed/`) holds these new versions.
- Known open items: the stock "model hand" in relaxed poses (provider default), and the trousers three-quarter shot framing the head since `tpl-2026.11.14c`. Both are caught in review. A local "fix a hand" edit was built and tried once on a real image; it left the hand unchanged and was taken out of the app before handover (`docs/review-and-import.md`, Hand fix).
- Known open item: one end-to-end run had an image stuck in "submitting" until its lease expired; not reproduced in five runs since, cause not identified. The worker now releases the lease on any crash and logs the stack. Watch for `crashed:` in the worker log.
- Railway is the tested fallback host (`Dockerfile`, `docs/deploy.md`).

## 9. Report back

When done, report: what you changed per row of section 4, which invariants you verified and how, test results, the site URL, and anything you could not port.
