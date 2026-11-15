# Model builder

A new model in the app, from choices: `/models/new` (Models page: "Build a model"; overview: tool 02).

## Flow

1. **Look:** grouped as Face (heritage, skin tone, eyes, freckles), Hair (colour, texture, length, style) and Body (age 20 to 25, height, EU size). Choices only, with colour swatches for skin, hair and eyes; "Surprise me" picks a random look.
2. **Portrait:** 3 candidates from the same prompt ($0.48). Tap one; "Use this portrait" also starts her reference set ($0.80). Not right: make 3 new or change the look. Every round is kept.
3. **Finish:** her reference set from the chosen portrait (three-quarter, profile, body front, body back, 5-panel character sheet); any one can be made again ($0.16), earlier attempts are kept. Then her name (never sent to the image service) and "Add to models": a new model, version 1, active, usable in New production right away.

While images are being made the page says how long it takes (about a minute an image) and that the model is saved: you can leave and come back under Models, Build a model.

## Rules built in

- **Original fictional adults only.** Every choice maps to fixed prompt text (`packages/core/src/modelBuilder.ts`); nothing typed reaches a prompt, there is no image upload, and the prompts say she is not a real or identifiable person. Ages 20 to 25.
- **Money:** each paid step shows its price on the button. Builder images count against the monthly budget with production images, and a step that does not fit the budget is refused before anything is sent. A paid image is never retried automatically; an image interrupted mid-call is closed as possibly billed.
- **The brand's look:** models who look like top models, with attitude and a cool look (owner's direction after the first paid test, which made plain, natural faces). The portrait prompt asks for top-model bone structure, a cool, self-assured and slightly aloof look (not smiling, not sweet), the brand's polished clean glam (contour, highlight, defined lashes, satin nude lips) and sculpting beauty light, on real skin texture with real hair edges. The references keep the same expression. No studio equipment in frame. Body references are stored headless, like the library's.

## Code

- `packages/core/src/modelBuilder.ts`: choices, prompts, the registered look. Tests: `packages/core/test/modelBuilder.test.ts`.
- `apps/web/lib/server/builder.ts`: drafts, queue, budget, worker step, registration. Tables `model_drafts` and `model_draft_images` (additive migration in `lib/server/db.ts`). Tests: `apps/web/test/builder.test.ts`.
- `apps/web/worker/index.ts`: makes builder images when no production image is waiting.
- `apps/web/app/api/model-builder/`: the API. `apps/web/components/model-builder.tsx`: the page.
- e2e: the whole flow with simulated images (`e2e/run.mjs`, stage "Model builder").

## Paid test (2026-11-15, 11 images, $1.76)

One test model (Northern European, fair with freckles, green eyes, shoulder-length wavy auburn hair, 22, 176 cm, EU 36), made through the app on a local copy with the real provider:

1. **Round 1, 3 portraits ($0.48), first prompt:** plain, natural, girl-next-door faces; one drew the studio softbox into the frame. Rejected by the owner: the brand needs top models with attitude and a cool look. Fixes: equipment excluded; the look rewritten (top-model face, cool attitude, the brand's clean glam, beauty light).
2. **Round 2, 3 portraits ($0.48), top-model prompt:** one at the brand's level (visible glam, cool, campaign quality); two gaunt, older-looking and nearly bare, and the good one turned her head. Fixes: a young face that is never gaunt, clearly visible glam with blush, square to the camera (not yet tested with real images).
3. **Reference set from round 2 portrait 3, 5 images ($0.80):** consistent identity in every view (face, freckles, eyes, glam, hair). Weakest: the full-body panels of the character sheet look less model-like than the separate body reference.
4. **Added to the models** through the app as "Isla" (M11): headless body references, shown on the Models page and selectable in New production. Not yet used in a production.

## Not covered yet

- The prompt after round 2 (young, visible glam, square to the camera) is not yet tested with real images.
- A builder model has not yet been used in a production.
- A model added by mistake cannot be removed from the app yet (it can be archived in the database).
- Disk: a finished model takes roughly 10 to 20 MB (portraits, references, headless copies). See the storage note in `docs/deploy.md`.
