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
