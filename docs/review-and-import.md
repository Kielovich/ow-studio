# Review, import and safe creation (2026-11-13)

## Attempts and approval
- Every finished provider attempt is stored in `attempts` with its own raw and final file, cost and error. A retry never overwrites an earlier image.
- Approve or reject per attempt (`POST /api/images/[id]/review`). At most one approved attempt per image; an earlier attempt can be approved after a later one.
- A new paid attempt for a finished image requires rejecting it first. Failures, size checks and unknown outcomes can be retried directly. Nothing retries a paid call automatically.
- ZIP (`/api/productions/[id]/zip`) contains approved images only, each from its approved attempt. `?all=1` adds finished, not-approved images. `manifest.csv` lists file, attempt, attempts in total and review.
- Metrics per production: approved, approved on the first recorded attempt, attempts, spent, spent per approved image, and attempts with an unknown outcome (not counted in spent, may have been billed).
- Migration: images finished before this change get one backfilled attempt (not reviewed). Verified on a copy of the real database: 20 images → 20 attempts, idempotent on reopen.

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
