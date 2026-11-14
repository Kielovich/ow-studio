# Model look: what the brand gallery does (2026-11-13)

Sample: first gallery image of ~60 current products on owcollection.com, heads cropped (~55 usable).

## Makeup: polished clean glam

- Luminous, dewy skin with highlight on the cheekbones and bridge of the nose; warm bronze contour under the cheekbones.
- Defined, groomed brows (brushed up and light on blondes); soft brown liner; defined lashes.
- Nude-pink, rosy or glossy lips, sometimes a light blush.
- Expression: neutral and serious, lips closed, direct gaze. Never smiling.
- Frequent accessory: silver or gold hoops and drop earrings. These belong in production styling, not in identity portraits.

## Hair: five recurring styles

1. Slicked-back low bun with a centre part. By far the most common; it frees the neck and neckline.
2. Long, glossy, completely straight hair worn down with a centre part.
3. Blunt chin-length bob (brunette and platinum).
4. Short tousled blonde with a fringe.
5. Long sleek hair in brown or auburn tones.

## Applied to the model library

Each model keeps her face and gets clean-glam makeup plus her own signature hairstyle, baked into the identity portrait. Text alone barely changes the face (phase 3 finding). The platinum bob is deliberately not used (user instruction).

| Model | Signature hair |
|---|---|
| Sable | sleek low bun |
| Freja | light honey blonde, curtain fringe |
| Inès | long sleek straight |
| Amara | polished short coils |
| Mei | high sleek ponytail |
| Lucía | long defined curls |

User mood references (the 5 campaign images) were never sent to the generator. They informed attitude, body and finish in words only, because at least some show real people.

## Photographic skin (2026-11-13)

User feedback: the chosen faces looked too "AI". From practitioner guides (no official Google guidance exists), the following were applied:
- Describe skin positively and specifically: visible pores, fine peach fuzz, slight natural unevenness, sheen only on the high points.
- Avoid an even glow and heavy smoothing.
- Name the camera: full frame, 85 mm, f/5.6, natural micro-contrast, very subtle grain.
- When editing an approved face, keep identity and framing explicitly.

A texture pass was run on the 7 chosen faces (Sable, Mei, Lucía, Liv, Nadia, Noa, Kaia).
- Three needed a redo: Sable and Nadia were cropped tighter, so framing is now locked; Liv had too much redness. Sable also had pale patches from too-heavy peach fuzz.
- All rejected versions are kept in model-gen/state.json.

The same skin language now goes into the production prompts (template tpl-2026.11.7), the default makeup brief and the reference-set prompts. Each model also gets a 5-view character sheet (front, three-quarter, profile, back of head, full body), used as the `character_sheet` reference.

## Model library (registered 2026-11-13)

Active models: Sable v3, Mei, Lucía, Liv, Nadia, Noa and Kaia. Each has portrait, three-quarter, profile, headless body front/back and a 5-view character sheet, all 2K. Sable v1/v2 are archived; their productions keep them.

The production hair and makeup fields are now empty by default, meaning each model's own signature look from her portrait. A filled field is a production-wide override. Previously a default hair value forced one style onto every model.

Reference-prompt bug fixed: references used the base hair description instead of the styled hair, so Sable's angles and Liv's back body had loose hair. Those three images were rejected and regenerated.

## Realism refresh (2026-11-14)

All seven models have a new version made with `apps/web/scripts/model-realism.ts` (realism audit, lever 2). Same face, hairstyle and framing; changed:
- real hair edges (flyaways, baby hairs) instead of a solid helmet;
- satin or matte nude lips instead of gloss; contour softly blended; highlight only as a faint sheen;
- real skin (pores, slight unevenness), no oily or dewy shine;
- a five-panel character sheet (face close-up, full body front, back, two profiles) instead of five to seven small head views. Fewer, larger panels keep each view sharp after the model downsizes the reference.

| Model | New version | Notes |
|---|---|---|
| Noa | v3 (v2 = first refresh with a 7-panel sheet) | benchmark model |
| Liv | v2 | oily forehead and waxy look gone |
| Kaia | v2 | one 503 from the provider mid-batch; rerun |
| Sable | v4 | |
| Mei | v2 | first portrait changed her high ponytail into two front tails; rejected and redone with a correction |
| Nadia | v2 | |
| Lucía | v2 | portrait and angles kept (most realistic in the audit); only the character sheet renewed |

Older versions are archived, never changed; their productions keep them. The look texts of the new versions no longer contain "no loose strands" or "crisp hairline", which contradicted the realism text (the compiler also strips these phrases from older versions via `hairForPrompt`). Known weakness: in several sheets both profiles face the same way instead of left and right.
