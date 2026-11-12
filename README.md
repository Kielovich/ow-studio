# OW Studio

Turns garment packshots into consistent on-model e-commerce images featuring original fictional adult models.

## Status: Phase 2 (compiler contracts)

`packages/core` is pure domain logic with no UI, database or real provider yet.

| Module | Purpose |
|---|---|
| `schemas.ts` | Zod contracts: Product, ModelVersion, ProductionSpec, ProviderProfile, CompiledRequest |
| `canonical.ts` | Canonical JSON and hashing. Order, whitespace and Unicode never change a hash |
| `presets.ts` | front_crop, three_quarter, back, full_body, detail: camera, crop, visibility, allowed yaw |
| `poses.ts` | Pose and expression library plus a deterministic planner (manual choices are locked) |
| `references.ts` | Reference precedence and selection per preset and provider limit |
| `templates.ts` | Versioned instruction blocks in fixed priority order |
| `compiler.ts` | `compileProduction(spec, profile)`: compiled requests, conflicts and `canRun` |
| `jobs.ts` | Job state machine, retry policy (no automatic paid retries), crash-safe resume |
| `providers/` | Adapter interface plus a scripted `MockProvider` (no network) |

## Guarantees covered by tests

- Identical input gives byte-identical compiled instructions and the same `compileHash`. Pixels are never promised to be identical.
- Product order, flag order and duplicates do not change any hash. A compiler, template or model-reference version bump changes it.
- The garment reference always comes first. Back and detail views and face-less crops never send face references. Pose references control pose only.
- A manual pose or expression is never overridden. If it conflicts, Run is blocked with an error.
- Billable or uncertain failures wait for approval. Only non-billable transport errors auto-retry, with capped backoff.
- After a worker crash, a job either resumes without a second paid submission or stops for approval.

## Commands

```bash
npm install
npm test
npm run typecheck
npm run example   # compiles a 3-SKU test production and prints one prompt
```

## Next

Phase 3: provider capability test (2 to 3 providers on the hard materials: mesh, lace, sequin, fur, faux leather), then one real generation flow.
