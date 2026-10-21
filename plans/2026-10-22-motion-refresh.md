# Motion and journal-material refresh · 2026-10-22

- Base commit: `a9550d1`.
- Severity: medium; interruptibility, touch feedback and transition continuity.
- Ownership: the secondary-control work below was isolated in `src/secondary-motion.css`; the main task owns App logic, shared Sheet, FreeMoney and global material integration.
- Status: secondary controls and all 12 raster materials are integrated. The 36-combination material browser suite and final FreeMoney browser run have passed. Remaining release checks and publication remain with the main task; this document does not claim deployment.

## Scope and evidence

This began as a code audit followed by a limited implementation. The integration record below also covers the main task's subsequent work. It is not a claim about measured device frame rate.

Reference checkout: `work/emilkowalski-skills`, upstream commit `2d228630ba1446365f614a108cb8252f1feda202`. The secondary audit used `improve-animations/AUDIT.md`, `emil-design-eng` and `find-animation-opportunities`; the main task additionally used `animate` and `animation-performance`. All five exact source snapshots, their necessary references, MIT license and per-file hashes are in [the source archive](../docs/handoff/emil-skills-2026-10/README.md). The opportunity-finding skill supplies the audit; implementation follows the user's existing authorization. The user's decision to remove reduced-motion gating remains in force.

## Changes selected

| Before | After | Why |
| --- | --- | --- |
| Category pills inherit `category-bounce` (360ms) and `icon-bounce` (420ms) from `src/styles.css:19`; `src/pocket-layout.css:246` has an ungated hover lift. Repeated selections restart keyframes and touch can retain a hover pose. | Replace the two selected-state keyframes with retargetable transform transitions: 160ms pill press/release, 180ms icon selection, 100ms press; selected icon gently scales to 1.04. Keep hover lift only under fine-pointer hover. Keyboard focus stays still. | **State indication / feedback**, tens of times daily. Selection remains legible without repeated large bounces or sticky touch hover. Existing 42px pill geometry and haptics stay intact. |
| `src/refinements.css:50` hides the entire action rail immediately when `aria-hidden=true`, while the row surface still slides closed for 280ms (`:47`). This exposes an empty strip during closing. | Keep the rail's painted background until the 280ms surface transition completes, but disable interaction immediately. Icon/label opacity and a 6px transform settle in 160–180ms. | **Spatial consistency**, occasional. Closing an action row should reveal the same surface it opened from, without a blank flash. No destructive action is delayed. |
| Settings rows use the global `button:active` squash (`src/styles.css:9`), which scales the full hit target and row separator. `src/refinements.css:132` only adds a background change. | Keep button geometry fixed. Move only its content by 1px and scale to .985 during touch/mouse press, 100ms down / 160ms release. Keyboard focus has no motion. | **Feedback**, occasional. The press feels soft while the full-width row remains easy to hit and separators stay aligned. |
| Theme cards have a general button squash and the check icon changes opacity instantly (`src/refinements.css:431–436`). | Keep the card hit box fixed; press its preview to .97 with 100ms press / 160ms release. Check visibility uses 140ms opacity and scale .92→1. The theme-open chevron rotates 180° while expanded with a 180ms transition. | **Feedback / state indication**, occasional. The miniature and selector carry the state change without moving text or shrinking the tap target. No new page decoration. |

Use existing `--ease-out` (`cubic-bezier(.22,1,.36,1)`) and `--ease-drawer` (`cubic-bezier(.32,.72,0,1)`) tokens. No new animation library, no layout-property tween, no permanent compositor allocation, and no global reduced-motion rules. Styles are isolated in `src/secondary-motion.css`, imported after existing surface styles.

## App logic implemented by the main task

| Before | After | Why and evidence |
| --- | --- | --- |
| Selected-category scroll used `offsetLeft` against a parent whose coordinate origin could differ from the drawer. | `Categories` compares the drawer and selected pill's `getBoundingClientRect()` values, then scrolls only the necessary delta with a 4px inset. Physical-keyboard selection uses immediate scrolling. | Keeps the chosen category visible without unnecessary travel. Implemented in `src/App.jsx`; final interaction regression belongs to the main task. |
| Re-grabbing a swipe row mid-close could start from React's destination offset instead of the painted location. | `SwipeExpenseRow` reads the current transform via `DOMMatrixReadOnly(...).m41` at pointer-down and starts the new gesture from that position. | Interrupting the motion no longer snaps back to its old endpoint. The existing 72px opening threshold and 216px clamp are retained; velocity tracking and rubber-band resistance are not claimed. |

## Shared surfaces, popups and material integration

| Before | After | Why and evidence |
| --- | --- | --- |
| Page/card treatments and popup surfaces used several unrelated flat presentations. | `src/journal-materials.css` applies the same quiet paper family to the page, entry area, keypad, category pills, bottom navigation, ledger summary, settings, profile, circles, recurring expenses and import surfaces. The four existing theme palettes still provide the color. | A consistent paper journal treatment without adding decorative content. Runtime surfaces are generated WebP assets, not replacement SVG drawings. |
| Generic Sheet close unmounted the dialog immediately. | `Sheet` reads its current painted transform/opacity, runs a 160ms WAAPI exit from that frame, sets `data-exiting=true`, makes its contents inert and invokes `onClose` once. Closing by button, Escape and backdrop shares the same path. Focus restores on unmount. | Makes an early close continuous with entry and prevents repeated close actions. `NoteEntrySheet` opts out with `managedExit=false` so its own 160ms exit is not doubled. |
| Settings/import icons and attachment details did not share the new material family. | `JournalMaterial` supplies small bitmap objects for account, circles, import and recurring rows; receipts and paperclips identify file upload/preview/results. Location keeps its existing icon. | The materials clarify existing controls without changing their hit targets or adding text. Decorative images use empty alt text and do not intercept pointers. |
| A routine saved Snackbar could cover a newly opened import button even after navigation completed. | Routine non-error notices with only the dismiss action become compact and pass pointer events through, except for the close control. Undo, retry and error notices retain their interactive presentation. | The first material regression exposed an actual blocked tap. The fix is scoped in `src/journal-materials.css`; the complete 36-combination browser matrix has now passed. |

### Raster inventory and integration status

All **12 materials** are integrated: eight objects, two paper surfaces and two control surfaces. They were generated with the image tool; PNG originals are retained and the app uses smaller WebP derivatives.

| Group | Files | Current use/status |
| --- | --- | --- |
| Eight objects | `public/assets/pocket-materials-v2/`: `pocket-open`, `cash-note`, `coin`, `reserve-envelope`, `ledger-book`, `receipt-stack`, `calendar`, `paperclip` | Object library available through `src/JournalMaterial.jsx`; settings/import and FreeMoney integrations are owned by the main task. Per-asset prompts, processing and hashes are in `manifest.json`. |
| Two surfaces | `public/assets/journal-surfaces-v2/`: `journal-paper`, `sheet-paper` | Page/card paper plus ledger-summary and theme-card backing. Theme previews use `journal-paper`; theme cards use `sheet-paper`. Generation details and runtime hashes are in `generation.json`. |
| Two control surfaces | `public/assets/pocket-materials-v2/`: `key-cap`, `pill-tab` | Both PNG/WebP pairs are present. `src/journal-materials.css` uses them for the keypad cap and bottom-navigation selection surface; touch targets and text remain live HTML. |

The cloud character, existing themes, location policy and expense-entry rules are preserved. The new controls join the same matte paper family without adding another menu or label.

### FreeMoney verification boundary

The main task reported a successful final `node tests/free-money.browser.cjs` run with the full global CSS and notice fix. That script covers deterministic setup, validation, optional analysis failure, double-submit protection, save retry, pause, stale responses, ledger isolation and responsive layout in all three languages. It is functional/browser evidence, not a device frame-rate measurement.

## Deliberately rejected

- Number keypad: high-frequency input already has separate touch and hardware-keyboard paths. No added delay, bounce or broad button rules.
- Ledger amounts, total, list ordering: information should remain stable and readable; no decorative movement.
- Cloud, cash flight, shared sheets and FreeMoney: excluded from the secondary-control agent's edits; main-task changes and evidence are recorded separately above.
- New page-wide entrances or staggered settings rows: would add delay to common navigation without clarifying state.

## Verification checkpoint

- Browser execution is reserved for the main task. Final checks include rapid category reselection; horizontal scrolling then tapping; row open→close→reopen; settings row pointer cancel; theme select with mouse/touch/keyboard; disabled controls; 320px and 390px widths in three languages.
- Main-task build passed. Latest reported `npm test`: 472 tests, **471 passed, 1 skipped, 0 failed**.
- `tests/material-system.browser.cjs` passed all 36 combinations (Chinese/English/Ukrainian × 320/390/430px × four themes), checking settings/history/import/profile layout, loaded WebP materials, real button hit targets, no original PNG requests and shared/note Sheet exit timing.
- The final FreeMoney browser run passed with the updated fixture/global styles. Remaining existing browser regressions and release-state verification are owned by the main task.
- Existing regression entry points: `tests/category-pills.browser.cjs`, `tests/popup-materials.browser.cjs`, `tests/circle-reactions.browser.cjs`, `tests/keypad-interaction.browser.cjs`.
- No product behavior test is fabricated from CSS source strings. A build validates stylesheet syntax/imports; final browser results belong in the parent task's verification record.

## Implementation checks

- `src/secondary-motion.css`: 31 scoped rules, no keyframes, no layout-property animation and no new dependency. Existing numeric keypad, shared Sheet and cloud selectors are not targeted.
- PostCSS parse passed; `git diff --check` passed for the owned files.
- `node --test tests/category-pills.test.mjs tests/history-filter.test.mjs`: 11 passed, 0 failed. These validate the unchanged category/ledger contracts, not visual frame rate.
- Main-task browser verification should inspect rapid reversal at slow playback and actual touch cancellation before marking the visual work fully verified. Physical-device frame-rate evidence remains distinct from these functional checks.

Do not infer a deployment from this plan. The current main task owns final integration, browser testing and publication.

## Final local acceptance · 2026-10-22

- Final build passed; Node suite: **471 passed, 1 skipped, 0 failed** (472 total).
- New material matrix: 36 language/width/theme combinations, 4 exit paths, 180 screenshots. FreeMoney final integration passed in all three languages.
- Existing regression suites passed sequentially: keypad layout (88), keypad interaction (28), confirm touch (56), note submit, category pills, UI states, circles/reactions (125), popup materials (8), import draft persistence.
- `material-details.browser.cjs` verifies real key-cap/pill WebP painting and decoding at 390×844 and 320×568, mid-close swipe reversal from 17.8245px to 41.8245px (painted frame + 24px), and early dialog close without opacity/transform jump plus focus restoration after 160ms.
- Actual issues fixed during integration: Ukrainian upload/login overflow at 320px; save toast intercepting taps; short-screen empty-ledger entrance overlapping bottom tabs; higher-priority legacy CSS hiding the generated keypad material; FreeMoney saved status retaining the previous language.
- Incoming emoji regression waits for the new 160ms dialog exit, then verifies the **same animated node** survives outside the removed dialog without replay. Product reaction/counting logic is unchanged.
- Twelve runtime WebP materials total **156,190 bytes**. PNG originals, full prompts and SHA manifests are committed for future work. Source PNGs are not downloaded by the runtime.
- The handoff exporter preserves a link to the exact upstream Emil archive. Available user/assistant dialogue is redacted and archived separately from tools, private credentials and internal context. Export cutoff/counts are in `docs/handoff/transcript/export-manifest.json`.

This acceptance record is written before the release commit. Use the commit containing this section, CI results and live JS/CSS/material hashes to establish publication; do not equate `/health` version `0.5.0` with a particular commit. Real-device frame rate/haptics remain outside desktop-browser evidence.
