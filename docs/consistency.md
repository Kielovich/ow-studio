# Production consistency: audit and design (2026-11-13)

Audit of the first real production made in the app (`prod_20261113_54a472`, mesh dress, 5 shots), done by inspecting the stored compiled requests and the generated images.

## Verified working

- Deterministic compilation. Each request is frozen with a `compileHash`, and a job refuses to run against a different request.
- Reference precedence. The garment packshot is always first. Back views never get a frontal face as primary identity. Body references are headless.
- Framing matches the brand measurements. Front, back and three-quarter matched the packshot's hem side.

## Verified defects and fixes

| # | Defect | Root cause | Fix |
|---|---|---|---|
| 1 | Styled shot drifted to a different-looking face | Every shot generated independently from one identity image; styled pose/expression pulled furthest | Session anchor (below) and an identity rule that allows only gaze, eyelids and mouth to change. The styled expression no longer asks for "self-assured" with parted lips |
| 2 | ~~Styled shot showed the asymmetric hem mirrored~~ **Correction:** not a defect. Full-resolution crops show the hem on the correct side in all 10 images of both runs; the earlier finding came from reading small thumbnails | The prompt *was* ambiguous ("same side as in the packshot" without saying which) | Kept as a safeguard: hem side measured from the front packshot (`measureHemAsymmetry`), cross-checked against the back, and stated per view. Back views get the front packshot as an orientation-only reference |
| 3 | Close-up had no person reference (skin, neck, proportions unanchored) | Detail preset sent the packshot only | Headless body reference added |
| 4 | Preview planned with seed `draft`, the run with the production id | Seed derived from the production id | `spec.seed` derived from the draft content; preview equals run (tested) |
| 5 | Archived model versions accepted by the API | Only the UI filtered them | Server-side check in `buildSpec` |
| 6 | Open-back warning fired even with a back shot in the brand set | Checked only the `back` preset | Also counts `back_full` |
| 7 | Back view sent the body reference before the character sheet | Role order | Identity and hair before body, as for full body |

## Session anchor

- Per SKU, the first front shot (`full_body`) is the anchor. The other shots get `dependsOn` and wait in the queue; the worker will not claim them until the anchor has succeeded.
- Before a dependent shot's first submission, the worker recompiles it from the production's frozen spec with the anchor's final image (`freezeAnchor`).
- The new `compileHash` is written to the row and the job, and the history records "session anchor frozen: <hash>". This happens once only: never after a submission or on a retry, and a later anchor retry does not change already-frozen shots.
- The anchor is sent as `session_anchor`, which controls only `session` (light, colour, hair, makeup, how the garment sits). It is placed after the garment and identity references and before body references; the label tells the model the face follows the identity portrait and garment details follow the packshots.
- It can be switched off per production. Existing productions are unaffected: the migration only adds a nullable `depends_on` column.
- Trade-offs: the five shots take roughly twice as long, at the same cost, and an error in the front shot can propagate. Only a validated front is used as the anchor.

## Controlled variation

- The pose and expression planner picks among options within 0.05 of the best score, using the production seed.
- Main shots (front, three-quarter, back) share one choice across all SKUs of a production, so the gallery stays uniform. The styled shot varies per SKU and prefers the accessory pose when one is styled.
- Only calm poses are eligible for main shots. New calm variants: `front_soft_knee`, `back_soft_knee`, and the `calm_camera` expression.

## Tests on actual payloads

- `packages/core/test/consistency.test.ts` covers reference lists, order and assets with and without the anchor; hash changes; byte-identical shared identity, garment and style blocks; the measured hem side per view; reference limits and no duplicate images; pose variation and sharing.
- `apps/web/test/anchor.test.ts` runs the pipeline against a temporary database: queue gating, freezing once into request and job, no re-freeze after submission, the anchor switched off, archived models rejected, and preview equal to run.
- `apps/web/scripts/inspect-payload.ts` prints the exact references and prompt for a draft, optionally with an anchor, without API calls.

## Validation run (2026-11-13, `prod_20261113_05114d`, 5 images, ~$0.80)

- **Order:** the front was generated first; the other four started only after it succeeded.
- **Freezing:** every dependent had exactly the front's final image frozen in. The history records "session anchor frozen: 2b462515bdec", and the job and row compileHash match.
- **Identity:** the styled face now matches the front and three-quarter (face shape, brows, makeup, skin). In the first run the styled face had drifted to a fuller, more glamorous look.
- **Garment:** the hem is on the correct side in all shots of both runs (checked on full-resolution crops), and the panel layout is closer to the packshot.
- **Not built:** an automatic on-model hem-side check. A prototype misread outputs because the black bag merged with the garment mask, so it was dropped instead of shipping an unreliable validator.
- **Dev environment:** runtime data moved from `.data/` to `~/.ow-studio/data`. Database writes inside the repo made Turbopack reload the page continuously while the worker ran. Production history was moved intact.

## Test production 2 (2026-11-13): fur jacket on Liv and Kaia

- Garment fidelity and identity held across all shots. Three-quarter, back and styled match the brand gallery's poses and expressions.
- **Defect (mine):** the front shots were compiled by a stale dev-server module (old framing, no character sheet), while the worker recompiled the dependents with the new code, so one production mixed two compiler versions.
  - Fix: `freezeAnchor` refuses to freeze when the anchor's compiler or template version differs from the current one; the shot fails with "Re-create the production". Tested.
  - Process rule: restart the dev server after core changes, and inspect the created payload before paid runs.
