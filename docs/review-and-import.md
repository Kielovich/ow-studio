# Review, import and safe creation (2026-11-13)

## Attempts and approval
- Every finished provider attempt is stored in `attempts` with its own raw and final file, cost and error. A retry never overwrites an earlier image.
- Approve or reject per attempt (`POST /api/images/[id]/review`). At most one approved attempt per image; an earlier attempt can be approved after a later one.
- A new paid attempt for a finished image requires rejecting it first. Failures, size checks and unknown outcomes can be retried directly. Nothing retries a paid call automatically.
- ZIP (`/api/productions/[id]/zip`) contains approved images only, each from its approved attempt. `?all=1` adds finished, not-approved images. `manifest.csv` lists file, attempt, attempts in total and review.
- Metrics per production: approved, approved on the first recorded attempt, attempts, spent, spent per approved image, and attempts with an unknown outcome (not counted in spent, may have been billed).
- Migration: images finished before this change get one backfilled attempt (not reviewed). Verified on a copy of the real database: 20 images → 20 attempts, idempotent on reopen.

## Looks: top, bottom, shoes, accessories, fit reference (2026-11-14, branch `feature/looks`)

A look is one set (a folder, or a look added by hand with a slot per image: top front/back, bottom front/back, and optionally shoes, up to three accessories and a fit reference). Only the garment packshots are needed; without shoes, accessories or fit reference the styling text is used, exactly as before. The products of a look are photographed wearing each other: each product still gets its own brand set, and in every image the other garment of the look is drawn from its own packshot instead of from the styling text.

- Only garments that are worn together combine: top with bottom or outerwear, bottom with top or outerwear, a dress only with outerwear. A folder of three dresses is not one look (`wornTogether` in `repo.ts`).
- Shoes are sent only where the feet are in the picture; accessories only in the styled shot; nothing of the look in the close-up.
- The fit reference may show a real person: its top 22% (the head of a standing figure) is cut away before it is sent, and the prompt says to ignore the person (`cropFitReference`). It counts as a person reference against the provider's limit of 5.
- New reference roles control only `styling` (other garment, shoes, accessories) or `fit`; the product's packshots stay first and remain the authority for the product. Accessories come last and are the first to be dropped at the limit of 11 references; the prompt only calls an image "attached" when it is really sent.
- A production without a look compiles exactly as before (the prompt snapshots are unchanged).
- Shoe, bag and fit files in a folder are recognised by name (`shoes`, `sko`, `bag`, `taske`, `fit`, `pasform`, ...) and can be re-typed in the import.
- Never a layer that covers the product: a top or a dress is shot without the look's jacket; bottoms wear the look's top but not its jacket (see the test below).
- Paid test (2026-11-15, Noa, fur jacket FUR-JACKET-01 + coated trousers COATED-TROUSERS-01, `prod_20261115_ba8be6`, 3 images, $0.48): the jacket's full-body shot wore the real trousers from their packshot, with the same jacket quality as the text-styled benchmark; the trousers' front shot wore the jacket correctly over the top, with the trousers unchanged at full resolution (button, fly, pockets, leg shape); **the trousers' back shot left the jacket out**. A retest with an explicit "every garment of the look is worn in the back view too" (`prod_20261115_4dca0b`, 1 image, $0.16) still left it out and pulled the head and full body into a lower-body crop, so that sentence was removed and bottoms no longer wear the look's jacket.
- Second paid test (2026-11-15, Noa, the owner's black tailored wide-leg trousers and ruched feather-cuff mini dress plus a 225 px lifestyle shoe photo, `prod_20261115_b3e5c5`, 3 images, $0.48): the shoes (black leather lace-up with lug soles) came out right in the trousers' front and back shots and in the dress shot, the same on every side; nothing of the shoe photo's jeans, legs or hand was copied (the label says to use only the shoes). Trousers (pressed crease, belt loops, back welt pockets) and dress (mock neck, ruching, feather cuffs) held at full resolution; no colour drift.
- Verified: a jacket shot with the look's trousers; shoes from an uploaded image. Not yet verified with paid images: a top and a bottom worn together, accessories and the fit reference; the manual look panel says so.

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
