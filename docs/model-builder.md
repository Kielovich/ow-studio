# Model builder

A new model in the app, from choices: `/models/new` (Models page: "Build a model"; overview: tool 02).

## Flow

1. **Look:** heritage, skin tone, freckles, eyes, hair colour, texture, length and style, age (20 to 25), height and EU size. Choices only.
2. **Portraits:** 3 candidates from the same prompt ($0.48). Choose one, change the look, or make 3 new. Every round is kept.
3. **References** from the chosen portrait: three-quarter, profile, body front, body back and a 5-panel character sheet ($0.80). Any one can be made again ($0.16); earlier attempts are kept.
4. **Add to models:** a name (never sent to the image service), then a new model, version 1, active. She can be chosen in New production right away.

## Rules built in

- **Original fictional adults only.** Every choice maps to fixed prompt text (`packages/core/src/modelBuilder.ts`); nothing typed reaches a prompt, there is no image upload, and the prompts say she is not a real or identifiable person. Ages 20 to 25.
- **Money:** each paid step shows its price on the button. Builder images count against the monthly budget with production images, and a step that does not fit the budget is refused before anything is sent. A paid image is never retried automatically; an image interrupted mid-call is closed as possibly billed.
- **Same quality as the library:** the prompts are the ones that made the current models (`scripts/model-studio.ts`, realism refresh in `scripts/model-realism.ts`, `docs/realism-audit.md`): young high-street e-commerce model, clean-glam makeup finished as on a real set, real hair edges, real skin, soft directional light. Body references are stored headless, like the library's.

## Code

- `packages/core/src/modelBuilder.ts`: choices, prompts, the registered look. Tests: `packages/core/test/modelBuilder.test.ts`.
- `apps/web/lib/server/builder.ts`: drafts, queue, budget, worker step, registration. Tables `model_drafts` and `model_draft_images` (additive migration in `lib/server/db.ts`). Tests: `apps/web/test/builder.test.ts`.
- `apps/web/worker/index.ts`: makes builder images when no production image is waiting.
- `apps/web/app/api/model-builder/`: the API. `apps/web/components/model-builder.tsx`: the page.
- e2e: the whole flow with simulated images (`e2e/run.mjs`, stage "Model builder").

## Not covered yet

- No real (paid) model has been made through the app yet; the prompts are proven in the scripts, the flow with simulated images.
- A model added by mistake cannot be removed from the app yet (it can be archived in the database).
- Disk: a finished model takes roughly 10 to 20 MB (portraits, references, headless copies). See the storage note in `docs/deploy.md`.
