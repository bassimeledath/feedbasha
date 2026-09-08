# Karen code review — 7 September 2026

> Historical review of the first implementation. The findings below have since been addressed in the second round. See [round-two verification](./karen-round-two-verification.md) for the current status, test evidence, screenshot handoff, and follow-up reviewer outcome.

Requested reviewer: GPT-6 Astra, high reasoning. Review covered the uncommitted Karen implementation in `/Users/bassime/Desktop/fullstack/karen`, including Session, Widget, capture/selection, speech providers, serialization, integration, and tests. The reviewer made no changes. This report incorporates the interaction fixes made in parallel; references below point into the resulting working tree.

## Assessment

The foundations fit the product: plain TypeScript, an isolated Shadow DOM widget, an STT provider interface, discriminated element/region annotations, separate metadata extraction, and a small Markdown serializer. There is no justification for a framework rewrite, general-purpose state-machine library, or more service layers.

The architecture is not yet consistently simple in its behavior. Session owns phases but Widget's `renderReview()` also changes phase implicitly. Voice startup, pause, finalization, cancellation, and reset have overlapping asynchronous lifetimes. Those are concrete correctness problems, not merely style preferences. Session and Widget also concentrate most responsibilities in two growing classes. Extract the voice lifecycle first; split composer/review presentation only when it improves readability rather than creating forwarding wrappers.

## Outstanding findings, ordered by severity

### P1 — Cancelled Whisper results can enter a different annotation

[src/stt/whisper.ts:239](/Users/bassime/Desktop/fullstack/karen/src/stt/whisper.ts:239), [stop:288](/Users/bassime/Desktop/fullstack/karen/src/stt/whisper.ts:288), [dispose:315](/Users/bassime/Desktop/fullstack/karen/src/stt/whisper.ts:315).

Inference closures read mutable `this.cb` when work finishes. Disposing clears the pending list but does not cancel inference. Reusing the configured provider for a new annotation replaces `this.cb`, so the old result invokes the new draft's callbacks and bypasses Session's old-token check. The reviewer reproduced old cancelled text arriving in the replacement callbacks with a deferred inference result.

Minimal fix: capture callback ownership and a generation per inference job; suppress disposed generations. Preserve flushing of the current generation during normal stop. Test cancel → new draft → old result completion.

### P1 — Pause during voice preparation can still start recording

[src/session/session.ts:156](/Users/bassime/Desktop/fullstack/karen/src/session/session.ts:156), [startup:358](/Users/bassime/Desktop/fullstack/karen/src/session/session.ts:358).

Pause only pauses the currently assigned provider. If availability/preparation is pending, startup can continue afterward without checking `paused`. The onReady callback hides the listening indicator while leaving actual recording active. Deferred-availability reproduction ended with session paused and provider recording, with no provider pause call.

Minimal fix: make pause invalidate/defer startup and guard every startup continuation. The provider must also release a microphone obtained after cancellation. Resume should explicitly start or resume the same draft.

### P1 — Review can discard the final spoken note

[src/session/session.ts:543](/Users/bassime/Desktop/fullstack/karen/src/session/session.ts:543).

Review checks whether the textarea is empty before flushing speech. Interim speech appears in the status line, so a spoken draft can still have an empty textarea. Review then cancels and invalidates callbacks before stop returns the final segment. The reviewer reproduced an empty annotation list even though stop emitted the final spoken text.

Minimal fix: finish the current voice operation before deciding whether its draft is empty. Add a regression covering interim-only speech followed by Review.

### P2 — An old Review operation can reopen the panel after Reset

[src/session/session.ts:543](/Users/bassime/Desktop/fullstack/karen/src/session/session.ts:543).

Review awaits commit/cancel and then enters Review without validating that it still owns the session. Reset during delayed provider shutdown returns to idle; the old continuation can reopen the panel. Reproduced with deferred stop. The new draft-operation busy guard prevents duplicate user commits, but is not a session-generation guard and does not solve this reset race.

Minimal fix: check session generation/transition ownership after awaiting. Keep Session solely responsible for phase changes; make rendering methods render only.

### P2 — Component type identity is being used as component instance identity

[src/capture/selection.ts:32](/Users/bassime/Desktop/fullstack/karen/src/capture/selection.ts:32), [src/capture/target.ts:99](/Users/bassime/Desktop/fullstack/karen/src/capture/target.ts:99).

The deduplication key is source file + line + component name. Distinct list items rendered from the same source line collapse even when selectors, text, and rectangles differ. That reduced context count is also used to decide whether to collapse a drag into an element. A region containing several instances can therefore snap to the first instance and skip its screenshot. The reviewer reproduced this with two LineItem contexts at different positions.

Minimal fix: decide physical selection using distinct target instances, separately from deduplicating source labels for display. Prefer an explicit region whenever instance identity is uncertain. Do not add an elaborate component ontology to solve this.

### P2 — Cancelled review reordering can leave visual/model order different

[src/widget/widget.ts:606](/Users/bassime/Desktop/fullstack/karen/src/widget/widget.ts:606).

Dragover rearranges card DOM; only drop commits model order. Dropping outside the list or cancelling the drag can leave the DOM rearranged without updating annotations. Successful-drop badge renumbering was fixed in this interaction pass, but cancelled drag order remains outstanding.

Minimal fix: preserve the original order and restore it on cancellation; commit exactly once on accepted drop.

### P2 — Arbitrary regions have snapshot coordinates, not persistent layout anchors

[src/session/session.ts:620](/Users/bassime/Desktop/fullstack/karen/src/session/session.ts:620).

The interaction pass now records viewport/scroll context, tracks pins during Review, adjusts region pins for document scrolling, and hides region pins at different viewport dimensions. Independently scrolling containers and layout changes at the same viewport size can still move content without moving its region annotation correctly. The screenshot remains a snapshot, not a DOM anchor.

Minimal next step: invalidate the live region outline on unsupported layout/container changes, and use the saved crop for inspection. Avoid pretending that a historical rectangle follows arbitrary layout transformations.

## Export and UX implications

CSS coordinates alone cannot reconstruct the exact visual region in another browser or coding-agent process. Source locations identify implementation sites but not necessarily instances. Page URL, viewport size, scroll offset, selectors, and element text improve textual context; a cropped screenshot supplies the actual visual evidence.

The demo's screenshot adapter returns a local Blob without a durable reference. Copy feedback therefore does not transfer the screenshot. This pass makes that limitation explicit in copied Markdown and the copy status instead of implying all context was delivered. The smallest complete handoff would be one feedback bundle containing Markdown and numbered image files, or a host callback that saves each image and returns a path accessible to the agent. That export workflow has not been implemented in this pass.

For accidental outside clicks, one recoverable draft is sufficient: dismiss and retain the latest nonempty draft; provide Undo and restore on selecting the same live DOM element. No persistence across reloads or ambiguous matching across remounted components. Keep native textarea undo intact. Restoring a voice draft should never restart recording silently.

## Addressed during this interaction pass

- Text mode hides the elapsed-session timer.
- Outside page clicks dismiss the composer; Undo or selecting the same element restores the latest nonempty draft. Cancel/Escape discards it.
- Enter saves; Shift+Enter inserts a newline; IME composition does not trigger saving.
- Pins are keyboard-focusable. Hover/focus previews target and note; clicking during active capture edits the existing annotation.
- Closing Review resumes capture.
- Toasts prefer the top and avoid Karen's visible panels when space permits; replacing a toast cancels its old timer.
- Active Backspace deletion no longer changes the Widget to Review while Session stays active.
- Escape cancels an in-progress region drag or composer without accidentally opening Review.
- Successful reorder updates card badges as well as pins.
- Region exports include capture viewport, page, scroll, selector/text context, and explicit image-attachment status.

## Validation and limits

The baseline nine tests and typecheck passed despite the bugs above. Deferred-provider/inference diagnostics exposed the lifecycle failures. These reproductions used test doubles, not live microphone/model sessions.

The interaction pass adds regression coverage for dismissal/recovery, Enter/Shift+Enter/IME, pin preview/edit without duplication, Review close/resume, Escape/Backspace phase consistency, and explicit screenshot/viewport export context. All 14 tests, TypeScript, the library build, the demo production build, and `git diff --check` pass. Browser checks exercise element and region annotations, their previews/editing, recovery via Undo and the same element, pin-to-review editor focus, copy status, and Review/resume. A missing demo favicon is the only browser console error observed. These checks do not establish that the outstanding voice lifecycle bugs are fixed.

Whisper can also issue overlapping inference jobs: its busy flag gates interim work but not every final request. Completion-order transcript changes are a code-supported risk, not verified against a real model here. A small ordered queue within the voice controller is preferable to spreading more flags through Session and providers.

Stylistic cleanup is secondary: remove the Widget's unused preview URL collection, avoid compressed multi-action statements, and keep CSS readable enough to inspect cascade/placement rules. Prioritize lifecycle and instance-selection regressions before cosmetic refactoring.
