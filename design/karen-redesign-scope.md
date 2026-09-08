# Karen redesign scope

This began as the discovery and architecture document for the redesign. The target-first model, Constructive Karen identity, optional screenshot callback, per-target voice lifecycle, and restrained motion described here are now implemented in this worktree.

## Implementation status

- One target-bound `Annotation` model replaced interleaved speech/action events.
- Clicks resolve to elements; drags at six CSS pixels or more resolve to one logical component or a region.
- Text and voice share one metadata-free, editable composer.
- Voice starts only after target selection and stops after 60 seconds without speech while preserving a same-target Resume path.
- Region screenshots use the optional `captureRegion` callback; the browser demo supplies a best-effort `html2canvas` adapter.
- Review count, region thumbnails, region/component metadata, reselect, delete, reorder, and Markdown export all use annotations.
- The capture surface owns a stable crosshair while active and releases it while paused.
- Constructive Karen uses Instrument Sans, plum/cream/persimmon/lilac tokens, and the glasses-only launcher.
- Automated coverage now includes geometry, logical deduplication, serialization, target-first voice start, commit, and inactivity resume behavior.

## Recommendation in one paragraph

Move Karen from a continuous session transcript with interleaved pins to a **target-first annotation model**: the user first clicks an element or drags a region, then adds exactly one editable note by typing or speaking. Keep the implementation deliberately small: one annotation array, one optional draft, one session phase, and one pure click/drag resolver. For the first experiment, a drag resolving to exactly one logical component becomes an element; zero or multiple components remain a region. Region screenshots use one optional host callback because reliable, zero-config browser screenshots are not generally available.

## What existed before this implementation

The prior version had one large `Session` state machine and one imperative Shadow DOM `Widget`:

- `src/session/session.ts` owns phases, provider lifecycle, cursor changes, click interception, selection, text drafts, review, reselect, ordering, copy, and cleanup.
- `src/widget/widget.ts` creates every interface surface from HTML strings and mutates it imperatively.
- `src/types.ts` models a session as an ordered union of global `SpeechEvent` and element-level `ActionEvent` records.
- `src/serialize/markdown.ts` reconstructs meaning by serializing speech and references in chronological order.
- `src/capture/element.ts` resolves one DOM element into React and source metadata through `react-grab`.

This is coherent for “talk continuously and drop pins,” but it is the wrong foundation for “select a target, then annotate it.”

## The new mental model

Every committed review item should be a single annotation:

```ts
type AnnotationTarget = ElementTarget | RegionTarget

interface Annotation {
  id: number
  n: number
  createdAt: number
  input: 'text' | 'voice'
  target: AnnotationTarget
  note: string
}

interface ElementTarget {
  kind: 'element'
  element: ElementContext
}

interface RegionTarget {
  kind: 'region'
  rect: ViewportRect
  screenshot: RegionAsset | null
  elements: ElementContext[]
}
```

There should no longer be independent speech cards. A voice transcript is the editable `note` on the target that started it.

### Use one small state model

Do not add XState, an event bus, reducers, or a second orchestration layer. The session only needs:

```ts
interface SessionState {
  phase: 'idle' | 'active' | 'paused' | 'review'
  mode: 'text' | 'voice'
  annotations: Annotation[]
  draft: AnnotationDraft | null
}
```

`AnnotationDraft` can contain a small `status` field such as `editing`, `listening`, `voice-paused`, or `finalizing`. This keeps transient work attached to the only object it concerns instead of multiplying global phase combinations.

## Click and drag classification

### 1. Determine gesture intent

- On pointer down, capture the pointer and record the origin.
- Movement below 6 CSS pixels remains a click candidate.
- Movement at or above 6 CSS pixels starts a visible region rectangle.
- Clamp a region to the viewport for the first version; do not add drag-autoscroll yet.
- `Escape` cancels an in-progress selection.

The threshold exists only to prevent hand jitter from becoming a drag.

### 2. Resolve the selected target

Click:

- Use the existing normalized target logic.
- Resolve React/source metadata asynchronously as today.

Drag:

1. Normalize the rectangle.
2. Sample the region and enumerate meaningful targets.
3. Resolve and deduplicate candidates by logical React/source identity, not raw descendant DOM nodes.
4. If exactly one logical component remains, treat it exactly like a click on that component.
5. If zero or multiple logical components remain, keep it as a region and attach the involved component metadata.

This intentionally avoids percentage scoring for the first implementation. The only geometric threshold is the 6-pixel click-versus-drag threshold. Testing can tell us whether the one-component rule needs more nuance later.

### Edge cases to define and test

- Nested components whose DOM boxes overlap.
- One React component rendered through many DOM descendants.
- Portals, fixed and sticky elements, iframes, canvas, video, and cross-origin images.
- A region with no React metadata: keep it as a region with DOM fallbacks.
- A region selected inside a nested scroll container.
- Browser zoom and `devicePixelRatio` when cropping screenshots.
- Targets unmounted between selection and review.
- Pointer cancellation and a second pointer/touch.

## Screenshot architecture

This is the largest non-obvious constraint. A generic browser library cannot reliably screenshot arbitrary rendered page regions without tradeoffs. DOM rasterizers can miss video, canvas, cross-origin content, filters, fonts, and Shadow DOM. Screen Capture APIs introduce a permission picker and capture the screen rather than the page.

The simplest clean core is one optional config callback:

```ts
interface RegionAsset {
  blob: Blob
  /** Durable host path or URL, when the host can create one. */
  reference?: string
}

captureRegion?: (rect: ViewportRect) => Promise<RegionAsset | null>
```

Karen calls it only after a drag resolves to a region, stores the returned asset on that annotation, and creates an object URL from the blob for the review thumbnail. A host that can persist the image should do so inside this callback and return its path as `reference`, allowing the Markdown serializer to include it before Copy runs. Suggested host implementations:

- Electron: host IPC backed by `webContents.capturePage(rect)`.
- Browser demo: an optional DOM-rasterizer adapter, clearly documented as best effort.
- No callback: keep region metadata and show a non-blocking “screenshot unavailable” state rather than failing the annotation.

The captured asset should record CSS-pixel bounds, pixel dimensions, DPR, MIME type, and a preview URL/blob. Do not put base64 image data directly into the copied Markdown.

### Simplest export path

Do not add a new export framework initially. Keep the current behavior:

- `Copy feedback` copies compact Markdown.
- The serializer includes `RegionAsset.reference` when the capture callback produced one.
- The existing `onCopy(markdown, session)` callback still receives the raw session, including screenshot blobs.
- A host such as Electron/Kino can capture, save, and return a durable path from `captureRegion`, so the copied Markdown already contains the right reference.
- A plain browser integration that does not implement `onCopy` still gets the text and region metadata, but not a durable screenshot attachment.

This is the smallest engineering path and keeps platform-specific file handling out of Karen. Its main implication is that generic browser installs do **not** get a one-step screenshot-to-agent workflow. If that becomes a priority, add one explicit `Download bundle` action later; do not complicate the first capture model with clipboard-image negotiation or an export plugin system.

Image capture also bypasses the current text-only `redact` hook, so screenshot privacy still needs explicit documentation.

## Voice after target selection

Recommended behavior:

1. The user chooses Voice mode. Karen is ready to select but is not listening.
2. The user clicks or drags a target.
3. The anchored composer opens and starts the provider.
4. Interim and final transcription appears in the same textarea used by Text mode.
5. The user can edit the transcript.
6. Every detected audio-activity event resets a 60-second inactivity deadline.
7. After 60 seconds with no speech, Karen stops and flushes the provider but keeps the draft, transcript, and target open in `voice-paused` state.
8. A prominent `Resume` action starts listening again on that exact same draft and target.
9. `Add` stops and flushes the provider, waits for the last final segment, and commits one annotation.
10. `Cancel` stops the provider and discards the draft.
11. Provider failure leaves the same composer open as a normal text field.

The inactivity timeout pauses listening; it does not commit the annotation. `Add` remains the only commit action.

### Implications

- The current global `SpeechEvent` type and chronological speech-to-pin inference disappear.
- `STTProvider` callbacks need to write to the current draft instead of the session event array.
- The provider should be created after target selection for a clear privacy model. Whisper's model pipeline is already memoized, so later notes avoid the model download even if the mic stream is reacquired.
- Starting a provider per annotation adds some latency. Keeping the media stream alive would be faster but can leave the browser/Electron mic indicator active while Karen claims not to be listening.
- Late final segments must append without overwriting user edits. `Add` must enter a short `finalizing` state.
- Add one optional `onActivity` callback to the STT provider contract. Resetting the minute only on completed transcript segments would incorrectly stop a long continuous utterance, especially with Whisper configurations that do not emit interim text.
- Store the last-activity timestamp as well as a timer so background-tab timer throttling cannot leave the microphone active indefinitely.
- Pressing Review with a non-empty open draft should finalize and commit it; an empty draft can be discarded.

## Review-panel implications

The review panel becomes simpler and more useful:

- One card per annotation; no standalone speech cards.
- Element cards show component/source metadata plus the editable note.
- Region cards show a screenshot thumbnail, an editable note, and a collapsed list of involved components.
- Hovering an element card can keep the existing live spotlight behavior.
- Hovering a region card should prefer the saved screenshot. Reconstructing a viewport rectangle after root or nested scrolling is not always reliable.
- Reselect must accept either a click or a drag and may change an annotation from element to region or vice versa.
- Delete must revoke preview object URLs and release region assets.
- Reorder remains a simple annotation-array reorder.
- Copy/export should wait for pending transcript finalization and screenshot capture, or clearly mark a degraded item.
- The Review badge should count **committed annotations**, not raw speech segments or an uncommitted draft.

Suggested serialized shape:

```md
## 1. PaymentPanel — voice

"The spacing between these fields should be tighter."

Source: src/App.tsx:24
```

For a region, include the screenshot attachment name plus a concise component list.

## Small UI requests

These are straightforward after the architecture is agreed:

- Review count: add a badge to the Review control and a `setReviewCount(count)` widget method. Increment only after commit; decrement after delete.
- Resume label: change `↻ Resume recording` to `Resume`.
- Composer metadata: remove the visible header from the anchored composer, but continue resolving and storing metadata for review/export.
- Cursor: use a full-viewport capture surface with one crosshair cursor while active. The current body-level cursor loses to child `cursor` declarations, which is why it changes over controls and fields. Disable the capture surface while paused so the host app regains its normal cursors and interactions.

The capture surface is also the cleanest foundation for pointer drag selection. Its hit testing can use `elementsFromPoint()` while filtering the surface and Karen's Shadow DOM.

## Installation and first-use audit

### Current developer experience

Web installation is understandable but not polished:

1. Install from an unversioned GitHub slug.
2. Import `feedbasha` even though the displayed product is Karen.
3. Gate `init()` behind a development flag.
4. Hope Web Speech is available, otherwise silently accept click-only behavior.

Electron adds a large optional peer dependency, microphone permission handling, CSP changes, macOS usage text, and a first-run model download.

Assessment:

- Web: **6/10** for a developer already comfortable with React/Vite.
- Electron/offline voice: **3/10** because setup spans renderer code, dependencies, CSP, OS permissions, and model behavior.

### Highest-leverage improvements

1. Resolve the brand/package identity: either keep `feedbasha` as the technical package name intentionally, or migrate imports to `karen`. The current split is confusing.
2. Use tagged GitHub releases at minimum; an unpinned `main` dependency is not reproducible.
3. Add copy-paste quickstarts for Vite, Next.js, and Electron.
4. Add a capability/status surface: browser support, microphone permission, provider chosen, and screenshot-adapter availability.
5. Consider a small `npx ... init` installer later, but only after the public config and screenshot adapter settle.
6. Add tests. The package currently has typecheck and build scripts but no test script.

## Personality without clutter

Personality can enter through nine surfaces:

1. The launcher mark.
2. Typeface.
3. A restrained four-color token palette.
4. Five or six recurring pieces of microcopy.
5. Empty, success, and recovery states.
6. The review count and pin language.
7. Export headings.
8. Two high-value motion moments.
9. Rare onboarding copy.

The minimal memorable set is smaller: one ownable icon, one type family, one palette, consistent copy on the launcher/listening/copy/error surfaces, and two restrained motion moments. Avoid random quips, jokes on every control, sounds by default, or animation that competes with the host application.

The identity board presents three coherent options. The recommended direction is **Constructive Karen**: sharp, helpful, and slightly amused; Instrument Sans; dark plum, warm cream, persimmon, and muted lilac. It makes the joke legible without making the tool hostile.

## Motion opportunity audit

The current widget already animates the pin, mode switch, composer entrance, review drawer, modal, toast, and copy success. It does not need motion everywhere.

| # | Location | Today | Purpose | Frequency | Suggested motion |
|---|---|---|---|---|---|
| 1 | New region classifier | A dragged rectangle would abruptly become an element highlight | Explanation / spatial consistency | Occasional | Use FLIP: preserve the drawn rectangle, animate `transform` to the resolved element bounds over `180ms cubic-bezier(.23,1,.32,1)`, then swap to the element highlight. Do not animate width/height. |
| 2 | Anchored composer close/retarget | Entrance animates, dismissal disappears immediately | Preventing a jarring change | Tens/day | Replace the one-way keyframe with interruptible `opacity` and `transform: scale(.96)` transitions over `160ms cubic-bezier(.23,1,.32,1)`, with origin at the selected target. |
| 3 | Review count badge | New requested count would change as static text | Feedback | Tens/day | On count change only, scale `.88 → 1` and fade `.7 → 1` over `140ms cubic-bezier(.23,1,.32,1)`. No idle pulse. |
| 4 | Region thumbnail | Async screenshot will appear after the card | Preventing a jarring change | Occasional | Enter from `opacity: 0; transform: scale(.96)` over `160ms cubic-bezier(.23,1,.32,1)` once capture resolves. |

Reduced motion should retain a quick opacity transition while removing scale. Hover-specific motion should remain gated to fine pointers.

### Rejected motion candidates

- Idle launcher bobbing or pulsing — **rejected on frequency and function**. It sits over another product all day and would become distracting.
- Animated cursor trail or constantly eased hover box — **rejected because it decorates a functional targeting tool** and introduces perceived lag.
- Character-by-character transcript animation — **rejected because moving text harms reading and editing**.
- Perpetually pulsing Review badge — **rejected because notification state should be legible without demanding attention**.
- Decorative hover lift on every review card — **rejected at tens-per-day frequency with no useful state explanation**.

Verdict: Karen needs less motion than a normal app because it overlays someone else's interface. The highest-leverage moment is the dragged-region-to-component resolution: motion can explain what Karen decided instead of merely decorating the result.

## Applicable Emil Kowalski skills

- `prototype`: best next for isolated click/drag/region-classification variants before production code.
- `find-animation-opportunities`: appropriate now; used for the restrained audit above.
- `improve-animations`: useful after the interaction model is selected to produce implementation-ready motion plans.
- `animate`: useful when implementing each approved motion moment.
- `review-animations`: useful after implementation to audit the diff.
- `emil-design-eng`: useful for the final polish pass across typography, surfaces, and interaction details.

`animation-vocabulary` is not needed here because the desired effects are already named. `animate-expo` is not relevant to this web package.

## Recommended delivery sequence

1. Confirm the screenshot callback compromise and the 60-second idle behavior.
2. Write pure model and gesture tests before touching the widget.
3. Introduce the new annotation schema and serializer behind a versioned boundary.
4. Add the capture surface and click/drag resolver with no voice or screenshot yet.
5. Rebuild Text mode on the unified annotation composer.
6. Add per-target Voice mode using the same composer.
7. Add the screenshot adapter and region review cards.
8. Add review badge, cursor lock, simplified Resume label, and hidden composer metadata.
9. Apply the chosen brand tokens and final SVG mark.
10. Implement only the approved motion rows, then run accessibility, reduced-motion, typecheck, build, and interaction tests.

## Proposed MVP decisions

1. Screenshot: optional `captureRegion` plus the existing `onCopy` callback; no new export subsystem.
2. Voice: 60 seconds without actual speech pauses the provider and preserves the same target/draft behind a `Resume` action. Only `Add` commits.
3. Drag classification: exactly one logical component becomes an element; zero or multiple components become a region. Revisit after hands-on testing.
