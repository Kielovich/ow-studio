# Review, import and safe creation (2026-11-13)

## Attempts and approval
- Every finished provider attempt is stored in `attempts` with its own raw and final file, cost and error. A retry never overwrites an earlier image.
- Approve or reject per attempt (`POST /api/images/[id]/review`). At most one approved attempt per image; an earlier attempt can be approved after a later one.
- A new paid attempt for a finished image requires rejecting it first. Failures, size checks and unknown outcomes can be retried directly. Nothing retries a paid call automatically.
- ZIP (`/api/productions/[id]/zip`) contains approved images only, each from its approved attempt. `?all=1` adds finished, not-approved images. `manifest.csv` lists file, attempt, attempts in total and review.
- Metrics per production: approved, approved on the first recorded attempt, attempts, spent, spent per approved image, and attempts with an unknown outcome (not counted in spent, may have been billed).
- Migration: images finished before this change get one backfilled attempt (not reviewed). Verified on a copy of the real database: 20 images → 20 attempts, idempotent on reopen.

## Hand fix (tried, not in the app)

The provider's stock "model hand" survived every prompt change (`docs/realism-audit.md`). A local fix was built: the reviewer clicks on the hand, only a square around the point (24% of the short side) is sent to Nano Banana Pro with an edit prompt, and the answer is colour-matched and blended back so that no pixel outside the square changes (pixel-tested in `packages/core/test/handfix.test.ts`).

First real test (2026-11-14, Noa mesh dress front from `prod_20261114_52887c`, image-left hand, 1 call, $0.16): **no effect.** Nano Banana returned the crop almost unchanged, with the same posed hand: 0.9% of the square changed by more than 12 levels, mostly resampled edges. The garment stayed intact (0.7% of dark garment pixels changed, no visible change in mesh or seams) and no seam showed at the square's edge. The result is attempt 2 of that image.

A second prompt (v2, asks for a change of pose and locks wrist and sleeve) is in `post/handfix.ts` but was not tried. The owner chose to skip the test, so the button, the API route, the worker step and the `edits` table were taken out of the app (they are in git history, commit `ccc3909`). The core building block (`post/handfix.ts`, `GeminiProvider.edit`) stays, tested, for a later attempt.

## Unknown outcome
- `awaiting_approval` with `timeout_after_accept`, `uncertain_submission` or `unknown` is shown as **Unknown outcome**: the provider may have produced and billed the image without us receiving it. The action is "New attempt (may cost again)".
- Budget holds (nothing was sent) and billed failures are shown separately.

## Folder import
- Folder upload (`webkitdirectory`) and dropped folders keep relative paths. The folder nearest the file is the set; a folder named like a role ("Back") is read as the role instead.
- SKU: configurable pattern, default `[A-Z]{2,4}\d{2,6}(?:-\d{2,4})?`, from the file name, else from a folder. Camera names (IMG, DSC, PXL…) are never SKUs. Role words in English and Danish; one-letter roles only as the last word.
- Each guess shows its source: from name, from folder, set by hand. Changing the pattern re-reads names and keeps manual choices.
- Blocking until resolved: two files for one SKU and role, a file without SKU or role, a SKU without a front. Shoes, bags and other accessories are kept but not sent (styling stays text).
- The import session is saved on the server (`drafts`, `?draft=<id>`), autosaved, and survives a closed tab.

## Idempotent creation
- Run sends a `createKey` fixed before the request and saved with the import session. The same key returns the same production (unique index plus a check inside the write transaction). Verified: three concurrent requests → one production; a double click in the browser → one POST; replaying the key → HTTP 200 with the existing id.

## Category test (2026-11-13, `prod_20261113_2fedce`, Noa, 15 images, $2.40)
- 15/15 succeeded on the first attempt, session anchor and current compiler (1.1.0, tpl-2026.11.10) verified in the payload before the run.
- **Defect found and fixed (ours):** speckled backgrounds on the dress and jacket. The model rendered a smooth lilac-grey backdrop (about RGB 200,190,196); background normalisation tested neutrality against absolute chroma 12 and shadows per channel, so noisy backdrop pixels were kept as subject. Fix: chroma judged relative to the backdrop's own tint (refused above chroma 30), shadow depth from luminance, pure background set exactly to the target. Regression test added. Off-target pixels in the affected area: 3.1% and 13.2% before, 0.00% after. The 15 finals were re-normalised from the stored raw outputs (no new calls).
- Fidelity: fur jacket very high; mesh dress panel layout and hem side correct; trousers leg shape, fly and pockets correct, but the coated finish still reads glossier than the packshot, and the trousers close-up is dominated by the styling top.

## Trousers close-up retest (2026-11-13, `prod_20261113_18031d`, 1 image, $0.16, tpl-2026.11.13)
- Framing fixed: waistband, button, fly and front pockets fill the frame; the styling top is no longer the subject.
- Coated finish improved but not solved: the twill of the base denim and the topstitching are now readable, but the surface is still glossier and more neutral black than the matte, slightly warm packshot. Prompt wording alone appears to be at its limit; next lever is a fabric crop of the packshot sent as a texture reference.

## Fabric crop reference (2026-11-13, `prod_20261113_3da198`, 2 images, $0.32)
- New `garment_texture` reference: the largest square fully inside the garment on the front packshot (eroded mask, so gaps such as between the legs never enter), sent right after the garment packshots and controlling texture only.
- Result on the coated trousers: the denim twill under the coating is now clearly rendered, the front is slightly less glossy, but the surface is still glossier and cooler than the matte, slightly warm packshot. Prompt plus texture reference appear to be at the model's limit for this finish; treat it as a review item.
- Regression found and fixed: the bottoms close-up showed bare skin between the styling top and the waistband (crop wording plus "top ends at the waist"). The framing now requires the top to reach the waistband (tpl-2026.11.13b).
