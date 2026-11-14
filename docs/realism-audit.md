# Realism audit (2026-11-13)

Goal: images that read as real women photographed in a studio, not as AI models. Scope: the 38 production images of 2026-11-13 and the portrait and full-body references of the 7 active models (52 images). Every image was inspected through native-resolution crops of the face, hands, skin and garment edges. Crops were found automatically with a skin-colour mask; six faces were also checked at 1:1.

The scores are one rater's judgement (Claude), not a measurement. The raw scores are in `docs/audit/realism-scores.json`, and `node docs/audit/score-table.mjs` prints the full table. Scale: 0 = not present, 1 = noticeable on inspection, 2 = obvious at normal viewing size.

## Defect checklist and totals

| ID | Defect | Total (52 images) | Benchmark baseline (15) |
|---|---|---|---|
| D3 | Helmet hair: no flyaways or baby hairs, CG-clean hair edges | 54 | 18 |
| D5 | Identical posed hand gesture (thumb touching middle finger), identical manicure | 45 | 17 |
| D8 | Flat CG light: no fall-off or modelling across the body | 35 | 12 |
| D2 | Over-symmetric, square-on "passport" face | 32 | 10 |
| D7 | Airbrushed legs and arms: even tan, no knees, veins or skin variation | 31 | 8 |
| D12 | Stiff mannequin stance, no weight in the body | 30 | 8 |
| D1 | Waxy, airbrushed or oily skin | 23 | 3 |
| D4 | Same glossy lips and glam makeup on every model | 22 | 7 |
| D9 | Background or edge artefacts: halo, tint residue, painted floor streaks | 16 | 3 |
| D10 | Material reads wrong (coated denim as glossy leather) | 14 | 10 |
| D11 | Peach-fuzz halo along the face contour | 7 | 0 |
| D6 | Hand anatomy errors (extra, missing, fused or melted fingers) | **0** | 0 |
| | **Total** | **309** | **96** |

The benchmark is production `prod_20261113_2fedce`: Noa, coated trousers, mesh dress and fur jacket, 5 shots each.

## What is already good

- No anatomical hand errors in any image. Fingers, nails and wrists are correct.
- Garment fidelity is high: mesh panel layout, hem side, fur pile and leg shape. Realism changes must not cost this.
- Lucía's portrait (curls, slight head angle, matte lips) is the most real-looking reference. It shows what the others lack.
- The older Sable productions (`54a472`, `05114d`) have the most natural faces. Their portrait predates the "clean glam" restyle.

## Root causes

| Defect | Main cause | Evidence |
|---|---|---|
| D3 helmet hair | **Model references.** The model-studio styling asks for "sleek, no loose strands", "crisp hairline" and "smooth". The production prompt then says "her own hairstyle exactly as in the identity portrait", so every shot copies it. | Every model except Lucía; the back views show it most (Noa's bob, Liv's bun). |
| D4 glossy lips, same glam | **Model references.** The makeup brief says "nude-pink lips with a soft gloss"; several models add "high-shine glossy lips". | The same lip finish on six of seven portraits. |
| D1 waxy or oily skin, D11 fuzz halo | **Model references** (dewy highlight, an overdone peach-fuzz texture pass), plus a **provider limit**: in a full-body 2K frame the face is only about 200–250 px tall, so pores cannot show. | Liv (oily forehead, waxy) and the halos on Mei, Liv and Kaia. Faces at 1:1 in full-body shots are smooth however the prompt is worded. |
| D2 passport face | **Brand pose grammar** (straight-on front, direct calm gaze) plus perfectly symmetric reference portraits. Only partly fixable: the brand look is frontal. | Front and styled shots. |
| D5 identical hands | **Prompt.** The pose texts say "relaxed, softly curved fingers" or "loose fingers". Gemini turns this into its stock "model hand" every time. | The same gesture in all 38 production images. |
| D7 airbrushed legs and arms | **Prompt.** The skin language covers only the face; nothing describes body skin. | Every dress image with bare legs. |
| D8 flat light | **Prompt.** "Soft, high frontal key light with low contrast" gives shadowless, even light. Real e-commerce light is soft but still models the body. | All images. |
| D12 mannequin stance | **Prompt and brand grammar.** Calm, even-weight poses are chosen for main shots. | Front and back shots. |
| D9 artefacts | **Our post-processing** (tint residue next to a shoe shadow in `3da198`; speckles in older finals, fixed today) and **provider** floor streaks. | `3da198` full body; older productions. |
| D10 coated finish | **Provider limit.** Already worked on: two prompt rounds plus a fabric crop helped only partly (`docs/review-and-import.md`). | Trouser images. |

## Ranked plan

| # | Lever | Targets | Expected effect | Cost |
|---|---|---|---|---|
| 1 | **Realism block v2 in the compiler.** Natural, varied hands without the stock gesture; body skin (knees, faint veins, uneven tone); real hair edges (flyaways, baby hairs) while keeping the style; matte or satin lips with natural lines; soft light with gentle fall-off; a little weight in the body; plus matching exclusions. | D5, D7, D8, D12, part of D3 and D4 | Large on D5 and D7, medium on D8 and D12, small on D3 and D4 (the references dominate those) | Benchmark run: 15 images, $2.40 |
| 2 | **Reference refresh for the benchmark model (Noa v2).** Same face and bob, but natural hair edges, matte lips, less contour and glow, a hint of head angle on the three-quarter view. A new model version; v1 stays unchanged. | D1, D3, D4, D11, part of D2 | Large on D3 and D4 in every shot, because production copies the references | Portrait, angles, character sheet and body: about 6 images ($0.96), plus a benchmark run ($2.40) |
| 3 | **Post-processing.** Fix the tint residue near contact shadows. Optionally match a fine sensor grain on skin, never smoothing. | D9, a little D1 | Small but free | $0 |
| 4 | Roll the reference refresh out to the other six models, if round 2 wins. | D1–D4, D11 on all models | As in round 2 | About $6, outside the benchmark rounds; needs a separate decision |

Not proposed: 4K output (face resolution in full-body shots is the real ceiling for skin detail, but "always 2K" is a project rule) and changing the brand's frontal pose grammar.

## What I do not know

- Whether Gemini follows "flyaways and baby hairs" while the references show sleek hair. If the references win, lever 1 does little for D3, and lever 2 is the real fix.
- Whether natural hand wording produces varied hands, or a different stock gesture.
- How far "gentle fall-off" can go before it fights the brand's bright, even gallery light.
- The scores come from a single rater. Your blind A/B judgement is the acceptance test, not these numbers.

## Best-practice check (2026-11-14)

Google's own pages could not be read from this environment (`blog.google` and `developers.googleblog.com` are outside the network allowlist), so this check rests on search results. Most of them are community and vendor guides, not official guidance.

| Practice | Source strength | Our prompt |
|---|---|---|
| Photographic language: shot, lens, light, texture | Google (developer blog, Imagen guide, as quoted in search results) | Followed: camera, focal length, light set-up and skin texture are named per shot |
| No quality intensifiers ("8k", "hyper-detailed", "ultra-realistic") and no "flawless"/"perfect" | Community, consistent across sources | Followed: none in the compiled prompt |
| Side or soft directional key instead of flat front light | Community | Followed since tpl-2026.11.14, with an explicit rule that no equipment appears in frame |
| Small deliberate imperfections (asymmetry, stray hair, slight discoloration) | Community | Followed (skin, body skin, real-hair text; Noa v2 references) |
| Specify hand positions concretely | Community | Partly: the relaxed-arm poses only say "arms hanging naturally"; the hand detail sits in the style block |
| Describe what you want instead of listing what to avoid | Attributed to Google by one site; not verified | **Not followed for hands:** the prompt describes the stock "model hand" (thumb touching the middle finger) twice, in the hand text and in the exclusions. Naming a pose precisely may make it more likely. Hypothesis only, untested |

Proposed after round 3 (not yet tested, so not in the compiler): drop the description of the stock gesture from the hand text and the exclusions, and put a concrete, positive hand description into the relaxed-arm pose texts.

Sources: [Google: 7 tips for Nano Banana Pro](https://blog.google/products/gemini/prompting-tips-nano-banana-pro/), [Google Developers: prompting Gemini 2.5 Flash Image](https://developers.googleblog.com/en/how-to-prompt-gemini-2-5-flash-image-generation-for-the-best-results/), [Imagen prompt guide](https://ai.google.dev/gemini-api/docs/imagen-prompt-guide), [Oakgen: fix plastic skin](https://oakgen.ai/blog/fix-plastic-skin-ai-portraits), [Upsampler: make AI images look real](https://upsampler.com/blog/make-ai-images-look-real), [Cloudinary: make AI images look real](https://cloudinary.com/guides/image-generation/how-to-make-ai-images-look-real), [Beauty editorial close-ups](https://imagegpt-web.pages.dev/learn/guides/beauty-editorial-closeups) (the Google pages were known only from search snippets).

## Results (2026-11-13 to 2026-11-14)

Benchmark: Noa, coated trousers, mesh dress, fur jacket, 5 shots each. Scores are one non-blind rater (Claude); the owner did not give a blind verdict and approved merging v3.

| Run | Change | Score (15 images) | Same 14 images | Notes |
|---|---|---|---|---|
| Baseline `2fedce` | | 96 | 90 | |
| Round 1 `26fac2` | realism block v2 | 80 | | gathers added to the mesh dress ("show its folds"), fixed |
| Round 2 `ce6081` | Noa v2 references | 64 | | softbox drawn in frame; head in the trousers back view; both fixed |
| Round 3 `1d0745` | tpl 14c | (one failed image) | 53 | one stochastic failure: different woman and dress |
| v3 `52887c` | tpl 14d, 5-panel sheet | 56 | 54 | no failures, no garment errors; merged |

Conclusion: prompt and reference work removed about 40% of the defect points, mostly hair, lips, legs, light artefacts. It plateaued at round 3: v3 is equal to round 3 on the same images. What remains is mostly provider behaviour:
- the stock "model hand" in relaxed poses, unchanged by any wording;
- square-on symmetric front faces, partly the brand's frontal grammar;
- the coated finish reading glossier than the packshot.

Open issue: since tpl-2026.11.14c the trousers three-quarter shot frames the head (one image per run; cause not identified). Caught in review.

Next levers: a local "fix hands" edit (re-generate only a crop of the hand with Nano Banana and composite it back) is built, see `docs/review-and-import.md`, Hand fix; not yet tried on a real image. Not built: a blind owner review of real productions to replace the single-rater score.

Spend for the realism work: $14.08 of the $17 budget for generated images (benchmark runs, Noa and the six other models' references), plus one 503 response that may have been billed ($0.16): at most $14.24. Three 402 responses (credits depleted) were not billed.
