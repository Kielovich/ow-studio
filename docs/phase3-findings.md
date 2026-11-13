# Phase 3: provider findings

Real calls against the Gemini Interactions API, 2026-11-12. Same text-only prompt (identity portrait for M01 "Sable", no references).

| | Nano Banana 2.1 | Nano Banana Pro (default) |
|---|---|---|
| HTTP / latency | 200 / 17.6 s | 200 / 20.0 s |
| Output | 2048x2048 JPEG | 2048x2048 JPEG |
| Usage | 163 in, 1680 image out, 690 thought | 163 in, 1120 image out, 250 thought |
| Cost from documented prices | ~$0.056 | ~$0.134 plus thinking tokens |
| Background (target RGB 241) | ~RGB 210 | ~RGB 167 |
| "Hair tucked behind the ears" | ignored | ignored |

## Verified against the real API

- Endpoint, `x-goog-api-key` and `Api-Revision: 2026-05-20` work.
- Response: `steps[]` alternates `thought` and `model_output`; the image is `model_output.content[].{type:"image", mime_type:"image/jpeg", data}`. A text-only `model_output` can come before it. `extractImages` handles both.
- `usage` has `output_tokens_by_modality` and `total_thought_tokens`, so actual cost per image can be computed and stored.
- HTTP 402 means prepaid credits are depleted. It is rejected before generation.

## Consequences

1. **Exact background is not reachable by prompt.** Both models ignore RGB values and render mid-grey. Decision: generate on "plain light grey seamless studio background", then normalise the background in a deterministic post-process (segmentation mask, fill RGB 241, keep the contact shadow). Validation checks the post-processed file.
2. **Small styling details get dropped** (hair placement). These belong in the identity references and character sheet, not only the text.
3. **Next test needs references:** garment fidelity on mesh, lace, sequin, fur, faux leather and trousers with the 6 approved test garments.

## Garment test 1: Nano Banana Pro, 3 garments x 3 presets (2026-11-13)

Inputs: brand packshots (front and back) used for an internal test only. Outputs are kept local and not committed. Model M01 with portrait plus generated full-body front and back references. 9/9 succeeded, about $1.44 estimated, 2048x2048.

| Garment | Fidelity | Problems |
|---|---|---|
| Faux fur jacket | Very high: shawl collar, horizontal panels, curved open front, sleeve volume | None significant |
| Mesh panel dress | High: panel layout front and back, sheer waist band, asymmetric hem | Full body: the hem point looks mirrored compared with the front packshot (to verify) |
| Coated trousers | Medium-low | Leg too slim (packshot is relaxed straight), sheen too high (reads as leather), light contrast topstitching mostly lost |

Across all:
- Identity is consistent across 9 images.
- Background RGB 169-185 against target 241: confirms that background normalisation must be a post-process.
- The body-reference clothing leaks in. Trouser shots inherit the black tank top from the body reference because no top was specified.

Actions:
1. Post-process background to RGB 241 (deterministic mask).
2. Garment silhouette constraint ("leg width and fit exactly as packshot; do not slim") and a `coated` flag separate from `leather`.
3. A `top` styling field for bottoms products, so nothing is inherited from references.
4. A mirroring check for asymmetric garments: compare the hem low point side against the packshot.

## Background normalisation (2026-11-13)

`src/post/background.ts` is deterministic and takes about 2-3.5 s per 2048 px image in Node:
- quadratic model, then classification, then a grid model with diffusion fill, then classification again (fixes edges the quadratic misfits)
- composite `obs + alpha*(target-model)*shade`

All 12 test images have corners at RGB 233-243 (target 241), down from 165-210. The hair edge has no halo. Contact shadows smaller than about 1/24 of the frame are kept; large soft floor shading is flattened. `scripts/mask-debug.ts` writes the mask for review.

## Trousers v2: silhouette rule, `coated` flag, `top` styling

| | v1 | v2 |
|---|---|---|
| Contrast topstitching | mostly lost | clearly visible (waistband, fly, pockets, back pockets) |
| Sheen | leather-like | low coated sheen, close to the packshot |
| Top | tank leaked from the body reference | specified long-sleeve top, waistband fully visible |
| Leg width | too slim | wider, but still slimmer than the relaxed packshot |

New issue: v2 full body face drifts from Sable (rounder face). Identity references for full_body are body_front then identity_primary; consider putting identity_primary before body_front, or adding the facial detail sheet.

Remaining: leg width. Options: a measured hem-to-thigh ratio in garment metadata, or a dedicated silhouette reference (packshot outline).
