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
- **The brand's look, photographed for real:** models who look like top models, with attitude and a cool look (owner, after the first paid test made plain faces), and realistic (owner, later the same day: "not realistic enough"). The portrait prompt asks for top-model bone structure and a cool, self-assured, slightly aloof look (not smiling, not sweet); the brand's clean glam as a real make-up artist does it (skin texture shows through, balm lips, no gloss); and an unretouched photograph: pores and peach fuzz, light with fall-off, natural colour, focus fall-off, grain, not CGI or a beauty filter. Beauty-retouch words (flawless, luminous, glow, satin, expensive-looking) are kept out and a test checks it. The references keep the same expression and finish. No studio equipment in frame. Body references are stored headless, like the library's.
- **From an owner's AI photograph:** `apps/web/scripts/model-from-image.ts` makes a new identity portrait of the same fictional woman with this finish, then the builder's reference set, then a new model (dry run by default). Never for photographs of real people.

## Code

- `packages/core/src/modelBuilder.ts`: choices, prompts, the registered look. Tests: `packages/core/test/modelBuilder.test.ts`.
- `apps/web/lib/server/builder.ts`: drafts, queue, budget, worker step, registration. Tables `model_drafts` and `model_draft_images` (additive migration in `lib/server/db.ts`). Tests: `apps/web/test/builder.test.ts`.
- `apps/web/worker/index.ts`: makes builder images when no production image is waiting.
- `apps/web/app/api/model-builder/`: the API. `apps/web/components/model-builder.tsx`: the page.
- e2e: the whole flow with simulated images (`e2e/run.mjs`, stage "Model builder").

## Paid test (2026-11-15, 17 images, $2.72)

One test model (Northern European, fair with freckles, green eyes, shoulder-length wavy auburn hair, 22, 176 cm, EU 36), made through the app on a local copy with the real provider:

1. **Round 1, 3 portraits ($0.48), first prompt:** plain, natural, girl-next-door faces; one drew the studio softbox into the frame. Rejected by the owner: the brand needs top models with attitude and a cool look. Fixes: equipment excluded; the look rewritten (top-model face, cool attitude, the brand's clean glam, beauty light).
2. **Round 2, 3 portraits ($0.48), top-model prompt:** one at the brand's level (visible glam, cool, campaign quality); two gaunt, older-looking and nearly bare, and the good one turned her head. Fixes: a young face that is never gaunt, clearly visible glam with blush, square to the camera (not yet tested with real images).
3. **Reference set from round 2 portrait 3, 5 images ($0.80):** consistent identity in every view (face, freckles, eyes, glam, hair). Weakest: the full-body panels of the character sheet look less model-like than the separate body reference.
4. **Added to the models** through the app as "Isla" (M11): headless body references, shown on the Models page and selectable in New production.
5. **Used in Ecom (5 images, $0.80):** one dress (CAMELIA) on Isla, the brand set. The compiled requests used her portrait, three-quarter, character sheet and headless body references, and her look text read naturally. Front, three-quarter, back and styled came out consistent with her portrait (face, freckles, hair, glam) and the dress right (ruching, mock neck, feather cuffs). The close-up was paid but its file was lost: the test stopped the worker seconds after the image was marked done, before its file was stored (a gap in the pipeline, not in the builder; see the open point below). Made again as a one-shot production (1 image, $0.16): ruching, mock neck and feather cuffs sharp.

## Freja and Inés (2026-11-15, 12 images, $1.92)

Two models made for OW as AI photographs (by the brand's owner), not good enough in quality: over-smoothed skin, flat light. Remade with `scripts/model-from-image.ts` and the realism finish above:

1. **Portraits (2 images, $0.32):** the same women (face, freckles, eyes, hairline, hair) as real, unretouched photographs: pores, peach fuzz, freckles of varied shape, light with fall-off. Owner: "much better". Weak points: both cropped tighter than asked (head close to the top edge); Inés has a slight shine on the forehead and a hint of a smile, as in her original; both read a year or two older than the originals.
2. **References (10 images, $1.60):** three-quarter, profile, body front and back, 5-panel character sheet each. Identity consistent in every view; hands and feet clean at full resolution. The profiles turn about 70 degrees, not a full 90.
3. **Registered** locally as Freja (M11) and Inés (M12), version 1, headless body references; exported to the seed. On deploy the additive seed import adds them to the live server without touching its other models (`apps/web/lib/server/seed.ts`, tests in `apps/web/test/seed.test.ts`).

The source photographs stay in the local asset store only; they are not in the seed and never become a model reference.

## New models of the library's types (2026-11-15)

The owner found the six library models not realistic enough. Refreshing them failed three times: from their sharp 2K portraits the generator edited instead of photographing anew (near copies, still glowing; $0.96), with a front and a three-quarter view it drew both in one picture ($0.16), and from the front portrait alone at 640 px it still copied ($0.16). Owner: make new models that resemble the others, so they are not exactly them.

1. **Words only** (`scripts/model-from-image.ts`, `like-*` keys): one builder spec per library type, the builder's portrait prompt with the realism finish, no image attached. 12 candidates, 2 per type ($1.92): real photographs at last. Faults: a caption ("MODEL AGENCY DIGITAL") written into one, a softbox edge, a window, a backdrop edge, stubble-like fuzz on a jaw, a wrong hairstyle. The prompt was fixed for all three kinds (tests pin it); two chosen candidates were fixed by a free crop.
2. **References** for the six chosen portraits (30 images, $4.80 approved): 20 made ($3.20) before the Gemini prepaid credits ran out (HTTP 402, not billed). Identity consistent in every view; hands and feet clean at full resolution.
3. **Registered** as Signe (M13, Liv's type), Yuna (M14, Nadia's), Elena (M15, Noa's) and Amara (M16, Kaia's). Liv, Nadia, Noa and Kaia are retired (`RETIRED_MODELS` in `apps/web/lib/server/seed.ts`): archived, not deleted, so productions made with them keep working.
4. **After the credits were topped up:** the last 10 references ($1.60, the rest of the approved batch); registered as Mara (M17, Sable's type) and Valeria (M18, Lucía's). Sable and Lucía are retired the same way.

## Not covered yet

- The prompt after round 2 (young, square to the camera) and the realism finish are not yet tested with real images.
- Fixed (2026-11-15): the pipeline gap found in the Ecom test. An image now reads as finished only after its file is stored; a result lost to a stopped worker shows as "Not saved · may have cost" with a new attempt (`docs/handover-codex-sites.md`, invariant 13). The lost close-up of the test was recovered that way.
- A model added by mistake cannot be removed from the app yet (it can be archived in the database).
- Disk: a finished model takes roughly 10 to 20 MB (portraits, references, headless copies). See the storage note in `docs/deploy.md`.
