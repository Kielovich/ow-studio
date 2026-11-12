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
