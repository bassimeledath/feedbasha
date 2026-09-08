# Karen round two — implementation and verification

Date: 7 September 2026. All changes are local in `/Users/bassime/Desktop/fullstack/karen`.

## Scope completed

| Requirement | Implementation and evidence |
|---|---|
| Simple voice ownership | `src/session/voice.ts` owns one draft's provider, preparation, finalization, cancellation, and idle stop. Session owns phase transitions; Widget rendering no longer changes phase. |
| No old speech in new notes | Provider-generation guards and captured callbacks reject cancelled Whisper results. Deferred-inference regression verifies suppression and ordered subsequent jobs. |
| Pause during preparation | Cancels preparation and invalidates callbacks; late microphone permission results release their tracks. Deferred availability and device tests pass. |
| Preserve final speech on Review | Review finalizes before testing draft emptiness; interim text is editable in the textarea. User corrections survive final transcription. Session tests cover both paths. |
| Reset wins over old work | Session generation guards prevent late Review/commit operations from reopening UI or changing a fresh draft. Actual Reset-during-finalization and destruction regressions pass. |
| Repeated component selection | Source labels do not determine physical target count. Ambiguous/multiple DOM targets remain a region. Browser drag across three repeated LineItems retained every instance and a crop. |
| Reorder cancellation | Original card order is restored when native dragging is cancelled; accepted drops update card badges and pins. Browser verified accepted reorder and Escape cancellation. |
| Region layout changes | Lasting page changes, viewport changes, and independently scrolling containers invalidate live region outlines. Retained drafts are included. Original screenshots remain available; stale Undo shows the crop without an incorrect outline. |
| Local image handoff | `feedbasha/vite` provides a development-only localhost PNG persistence endpoint. Copy saves original captures and includes absolute file paths. Custom hosts can supply `saveCapture`. |
| Retry and reuse | One upload for two consecutive copies in browser. Content-hashed filenames reuse the same file across uploads. Failed saves preserve notes and offer explicit text-only copying; unit and browser failure checks pass. |
| Existing interaction feedback | Text timer hidden; outside-click recovery, Enter/Shift+Enter/IME, pin previews/editing, review close/resume, top toast placement, and Escape/Backspace behavior retained and tested. |
| Font | Registered Instrument Sans with the document FontFace API; browser reported `Karen Instrument Sans` loaded. Bundled font license is included in the package. |
| Install/docs | README documents Vite setup, image capture/persistence, failure handling, local-agent scope, retention, and awaitable start/stop. `.karen/` is ignored. |

## Screenshot proof

The browser selected the three order-summary line items. Copy returned HTTP 200 and included:

```text
Screenshot: /Users/bassime/Desktop/fullstack/karen/examples/basic/.karen/captures/d97b9838b75c6fd897cd27cebeca7deaea1e8eb90e1800d68cb6220773b5f8d0.png
```

The file was opened from disk and visually inspected: it contains Wireless keyboard / $79.00, USB-C cable / $19.00, and Laptop stand / $50.00, matching the selected region. Image dimensions are 609 × 211 pixels at capture pixel ratio 2. Copied metadata includes the viewport, scroll position, selectors, text, and source locations. `git check-ignore` confirms this image is excluded from version control.

The crop is taken when the region is selected, not when Copy is pressed. Copy saves the existing Blob. This transfers a usable file reference to an agent sharing the local filesystem; it does not attach image pixels to cloud chat or grant another machine access.

## Validation

- `npm test`: 30 tests in 7 files pass.
- `npm run typecheck`: passes.
- `npm run build`: browser, Whisper, Vite integration, and declarations build.
- `npm run build --prefix examples/basic`: passes.
- `git diff --check`: passes.
- `npm pack --dry-run --json`: includes Vite entry/declarations and Instrument Sans license; no captures included.
- Browser: actual screenshot save/copy/file inspection, repeated-copy reuse, region selection, reselect then new selection, stale Undo, screenshot preview, region metadata, native reorder/cancel, save-failure text fallback, and loaded font.
- A stale region restored in a 360-pixel-tall viewport showed the original crop with no live highlight; the Add button remained visible (bottom ≈272 pixels). A ResizeObserver now re-clamps the composer after preview/status size changes.

## Reviewer result

GPT-6 Astra at high reasoning reviewed the implemented and tested changes. It reproduced two remaining issues: reselect left capture ownership busy, and retained region drafts could restore stale outlines. Both were fixed and retested. The suggested composer-height check was addressed with responsive clamping and a browser check. Its final follow-up reported no new findings or blockers and independently reran all 30 tests, typecheck, and whitespace validation successfully.

## Practical limits

Live microphone permission UX and real Whisper/model recognition quality have not been independently exercised; automated tests use controlled providers, deferred inference, and microphone results to verify lifecycle behavior. Human voice testing remains appropriate before release. Browser DOM rasterization is best-effort for video, canvas, cross-origin assets, and complex CSS. Local image persistence supports same-origin HTTP localhost development requests, up to 8 MB per PNG; other hosts use the documented adapter.
