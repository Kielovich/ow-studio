# OW Studio

Turns garment packshots into consistent on-model e-commerce images with original fictional adult models, styled after the brand's gallery.

## Run it

```bash
npm install
npm run seed -w web        # registers the model library (Sable v1/v2) from the phase 3 assets
npm run dev                # web app on http://localhost:3000
npm run worker             # generation worker, in a second terminal
```

The worker reads `GEMINI_API_KEY` from the environment or from `~/.ow-studio/secrets.env` (never committed). Data (SQLite database and content-addressed assets) lives in `~/.ow-studio/data` (override with `OW_DATA_DIR`), outside the repo so the dev server does not reload on database writes. The monthly budget is set with `OW_BUDGET_USD` (default 25).

## Structure

| Path | What |
|---|---|
| `packages/core` | Domain logic: compiler, presets (brand gallery set), pose planner, references, job runner, Gemini adapter, background normalisation, silhouette measurement. 68 tests. |
| `apps/web` | Next.js 16 + HeroUI v3 app in the brand's look: Studio, New production, Productions, Models, Settings. API route handlers and a separate worker process. |
| `docs/` | Decisions and phase 3 findings (real-API results). |

## Flow

1. **New production.** Drop packshots named `SKU_front` / `SKU_back` / `SKU_detail`. The SKU and angle are recognised; anything else is assigned by hand. Add construction flags and choose the model, shots and styling.
2. **Review.** The production is compiled live: conflicts, image count, estimated cost and remaining budget. Blocking problems disable Run.
3. **Generation.** The worker claims images with a lease and calls Nano Banana Pro. It auto-retries only non-billable errors; paid retries need explicit approval. The background is normalised to RGB 241.
4. **Results.** The production page shows live status, a lightbox (final vs raw output, references sent, history, compiled prompt), retry approval, ZIP download and delete.
