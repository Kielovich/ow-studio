# Decisions

| Date | Decision | Why |
|---|---|---|
| 2026-11-12 | TypeScript modular monolith (Next.js app + worker + `packages/core`) | One codebase; pure compiler testable without I/O |
| 2026-11-12 | Default provider: Gemini Nano Banana Pro (`gemini-3-pro-image`) | User choice; best identity and garment results in the phase 3 test |
| 2026-11-13 | Exact background via deterministic post-process, not the prompt | Both Gemini models ignore RGB values in prompts |
| 2026-11-13 | UI built with HeroUI React components (https://heroui.com/en/docs/react/components) | User decision. Version and setup to be verified against the docs when the UI phase starts |
| 2026-11-13 | First app: Next.js 16 (App Router, cache components) + HeroUI v3, SQLite via `node:sqlite`, separate worker process | No extra infrastructure for a single-user tool; the job store interface lets Postgres replace SQLite later |
| 2026-11-13 | App look follows the brand site (tokens from owcollection.com: #111 ink, #f5f5f5/#e8e8e8 surfaces, Playfair Display + Figtree, uppercase tracked buttons) and uses the brand logo | User request. Internal tool for/pitched to the brand; the repo is private and the logo must not be published without the brand's consent |
