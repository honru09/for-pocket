# Technical and interface assessment

Date: 2026-10-13  
Baseline: `27a8d73b559ef1a5e1519c3fba4987c8a2546532`  
Scope: existing design assessment, technical audit screenshots and JSON measurements, and read-only source excerpts from the baseline commit. This is a synthesis of evidence already collected; no application code was changed or exercised for this report.

## Executive assessment

The app has a strong mobile-first entry flow, broad localization and theme coverage, and accessible names on most icon-only actions. The main user-facing risks are a save action that is only revealed once the draft is valid, loss of quick-entry drafts on navigation, low contrast in secondary information, and absent form-field focus indicators. The short mobile portrait layouts fit their measured viewports, while landscape and desktop evidence shows overflow/occlusion concerns.

No P0 was established by the design or technical artifacts reviewed. P1 issues are the hidden save completion affordance, unsaved quick-entry draft loss, and missing focus visibility on form controls. The documented P2/P3 findings and their baseline locations are below. Priorities describe user impact; they are not automated detector severity labels.

## Impeccable five-dimension audit

Scores are 0–4, where 4 is strongest. These are technical synthesis scores, distinct from the design assessment’s Nielsen 25/40 score.

| Dimension | Score | Evidence and rationale |
| --- | ---: | --- |
| Clarity | 2 | `App.jsx:743–757` passes an instruction label to a save control rendered only when the draft is valid (`PocketMascot.jsx`, `mascot-confirm` conditional). First-use screenshots `01-record-mobile.png` and `02-record-ready.png` show the action absent, then appearing as a checkmark. `AiImportPage.jsx:407–416` shows the login gate alongside source controls. |
| Usability | 2 | Mobile portrait has no measured document overflow at 320×568 or 390×844, but landscape measurement is 829×691 in an 844×390 viewport. Quick-entry component state is discarded when leaving its conditional view (`App.jsx:301–304,753`; `AiImportPage.jsx:161–173`). |
| Aesthetics | 3 | Consistent warm paper, sage palette, rounded controls, and mascot support the product’s low-pressure everyday-recording identity. The design assessment rates this as a strength, while desktop screenshot `record-en-1440.png` shows unused right-side space alongside clipped categories. |
| Accessibility | 2 | Main controls generally have accessible names and the custom keypad controls are large. However, `pocket-layout.css:33–34` removes focus rings from form controls, `account-styles.css:48,101` removes them from inputs/avatar controls, and muted text measurements fall below ordinary body-text contrast targets in tested matcha states. No full assistive-technology or WCAG conformance test was performed. |
| Delight | 3 | Cheese, small motion, haptics, and saved feedback give the interaction a distinctive, gentle tone. The design assessment identifies the risk that celebratory feedback implies completion before remote persistence is confirmed (`App.jsx:571–572`); reduced-motion behavior was not recorded in the supplied artifacts. |

## Findings by priority

Line references below are for the baseline commit and can be checked with `git show 27a8d73:<path>`; they may not match the current working tree.

| Priority | Baseline location | Impact | Recommendation |
| --- | --- | --- | --- |
| P1 | `src/App.jsx:743–757`; `src/PocketMascot.jsx` conditional `canConfirm` render around line 232 | Save is invisible until amount/category/consumer are valid, then appears as a checkmark on the mascot. First-time users may not find the completion action; on mobile it is above the keypad. | Keep the action in a stable, visible location with text such as “Save entry”; state the missing requirement while disabled. Preserve mascot feedback as secondary confirmation. |
| P1 | `src/App.jsx:301–304,753,770`; `src/AiImportPage.jsx:161–173,198–210` | Leaving Quick entry unmounts its component-local source text, files, and candidates. The design assessment reproduced text disappearing after a Ledger detour. | Retain text/candidates across internal navigation, or warn before leaving and offer return/ discard. Scope retained data to the active user/ledger; explain any attachment persistence. |
| P1 | `src/pocket-layout.css:33–34`; `src/account-styles.css:48–49,101`; `src/refinements.css:122–130` | Keyboard users can lose their place while moving through amount, currency, category, note, and profile controls. The screenshot `note-input-keyboard-focus.png` and design evidence show weak or absent field focus. | Restore a clear `:focus-visible`/`:focus-within` indicator on all inputs, selects, textareas, and avatar controls; preserve strong button focus styles. |
| P2 | `src/App.jsx:571–572,744`; `src/pocket-layout.css:24` | “Saved” feedback is issued before async write completion; record view hides the storage status, so local, pending, and confirmed states are not distinguishable there. This is a source-level risk; online failure was not simulated. | Show a persistent, readable state on the entry view for local-only, pending sync, confirmed, and failed/retry states. Trigger success feedback according to the state actually achieved. |
| P2 | `src/AiImportPage.jsx:407–416,434`; `src/styles.css:10`; `src/AccountViews.jsx:70–91`; `src/AiSummary.jsx:90–91` | Guest/import and unavailable account states expose source inputs next to disabled or non-progressing actions. Disabled buttons retain full opacity, which makes the blocked primary action look available. Production account setup was not tested. | Make capability states consistent and explain the next viable action before users enter costly content; make disabled styling and its reason apparent, and retain drafts if sign-in is a supported next step. |
| P2 | `src/App.jsx:753` | Secondary-page Back always routes to Settings except from Settings, even when Quick entry was opened from Record or Ledger. | Track the originating view and return there; define a safe fallback for direct links. |
| P2 | `src/styles.css:18–21`; `src/pocket-layout.css:188–206` | Wide layouts leave substantial unused space while categories remain in a horizontal clipped strip. Desktop 1280×720 evidence also shows bottom navigation occluding part of the initial keypad. | Use available desktop width to expose all common categories; ensure the content viewport clears fixed navigation and safe-area insets. |
| P3 | `src/AiImportPage.jsx:435` | Empty state renders a literal `0` beside Organize because the conditional expression returns numeric zero. | Convert the conditional to a Boolean or explicit `items.length > 0`. |
| P3 | `src/styles.css:1,84,98`; related theme declarations at lines 2–4 | Muted text is too faint for important dates, hints, and storage/help copy. Matcha `--muted` on paper measured 3.11:1; time and statistic examples measured 2.34:1 and 2.40:1. | Separate decorative muted colors from informational text tokens and check every theme/background pair; raise essential secondary copy contrast and size. |
| P3 | `src/styles.css:5,8` and animation-bearing component styles | Reduced-motion support could not be confirmed: no `prefers-reduced-motion` rule was found in inspected baseline styles, and the artifacts do not record a reduced-motion run. | Add a reduced-motion path for nonessential transitions, mascot motion, and celebratory effects; verify that state feedback remains understandable without motion. |

## Detector output and limits

The requested audit bundle contains five technical JSON measurement files and screenshots, but no detector report/log with regex rules, warning identifiers, or false-positive annotations. Therefore the “10 bounce warnings” and detector’s false positives cannot be independently identified or matched to code from the supplied evidence. No warning list is invented here. The source does include a `category-bounce` keyframe (`src/account-styles.css:46`) and spring/bouncy tokens (`src/styles.css:1`), but their presence alone does not establish that a detector warning is correct or false-positive. A detector export is needed to report its ten messages accurately.

## Responsive, localization, theme, and state evidence

| Viewport / case | Evidence | Assessment |
| --- | --- | --- |
| 320×568 portrait | `record-en-320-measurements.json`: document 320×568, scroll 320×568; `record-en-320.png`, `record-long-confirm-320.png`, `import-zh-320.png` | No document-level overflow in the measured record screen. The design review says keypad, category row, and extras remain usable; action discovery is still weak. |
| 390×844 portrait | `record-en-390-measurements.json`: document 390×844, scroll 390×844; `expense-editor-en-390.png`, `ledger-en-390.png`, `note-focus-en-390.png` | No document-level overflow. Review notes that the final save action sits above the keypad rather than in a stable lower thumb zone; several secondary/date controls are below 44px. |
| 844×390 landscape | `record-landscape-measurements.json`: document width 829 and height 691 for viewport 844×390; screenshot `record-en-844x390.png` and `landscape-bottom-occlusion.png` | Vertical scroll and a 15px width mismatch are measured. The separate occlusion capture documents content obscured at the bottom; the available JSON does not quantify which controls are covered. |
| 1440×900 desktop | `record-desktop-measurements.json`: document 1440×900; screenshot `record-en-1440.png` | No document overflow. Design evidence identifies wasted right-side area and clipped category options, plus bottom-navigation occlusion in a shorter desktop capture (`desktop-1280x720-bottom-occlusion.png`). |
| Locale coverage | `record-uk-320.png`, `record-zh-320.png`, `settings-uk-390.png`, `settings-zh-320.png`; JSON record captures report `en-US` | English, Ukrainian, and Chinese screenshot cases exist. Locale-specific screenshots were not accompanied by measurement JSON, so only visual coverage—not quantified wrapping—is evidenced. |
| Theme coverage | `theme-measurements.json` and `settings-matcha/cheese/peach/sea-390.png` | Four root token sets are captured. Contrast concern is not limited to one aesthetic: muted tokens vary by theme and should be checked against their actual surfaces. |

### Keyboard focus and motion

`note-input-keyboard-focus.png`, `note-focus-en-390.png`, and design screenshot `04-edit-amount-focused.png` document the keyboard-focus review. The design assessment reports no clear field boundary after Tab reaches the amount control. Buttons have a focused ring rule in `refinements.css:122–130`, but the broad form overrides in `pocket-layout.css:33–34` and account rules in `account-styles.css:48,101` cancel key parts of it. Reduced-motion preference behavior has no artifact evidence; the inspected baseline styles contain no `prefers-reduced-motion` media query.

### Occlusion and empty import state

The audit captures `desktop-1280x720-bottom-occlusion.png` and `landscape-bottom-occlusion.png` specifically document bottom obstruction. Design assessment additionally observes that fixed bottom navigation covers part of the initial keypad in the 1280×720 desktop view; it recommends reserving navigation/safe-area clearance. The empty import case is shown in `import-zh-320.png`: Organize is unavailable to the guest and an isolated `0` appears beside it. The latter is the P3 conditional-expression issue at `AiImportPage.jsx:435`, not a meaningful empty count.

## Animation findings

Animation supports interaction feedback through button press transforms (`src/styles.css:8–9`), spring tokens (`src/styles.css:1`), category bounce keyframes (`src/account-styles.css:46`), and mascot/celebration effects documented in `design-assessment.md`. These effects are part of the app’s character, and the available design review does not identify animation as a leading usability defect. The material gap is reduced-motion evidence: no preference-specific behavior was present in the inspected baseline stylesheet and no reduced-motion screenshot/run is included. Add a preference path for decorative motion while retaining non-motion state cues. The repeated “bounce” detector warnings, if any, remain unverified without the detector’s actual output.

## Empty, unavailable, and gated imports

The empty guest import capture has zero source files and zero parsed items; no empty source import was executed. The button is programmatically disabled (`AiImportPage.jsx:434`) when parsing cannot proceed, while its visual weight remains similar to an enabled primary action (`styles.css:10`). The “0” is a rendering artifact of the conditional at line 435. Guest mode, unavailable account setup, remote AI outcomes, and real file parsing are not inferred from this screenshot beyond the stated visible/configuration state.

