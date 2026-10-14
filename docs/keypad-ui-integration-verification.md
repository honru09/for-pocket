# Local keypad and state-asset integration

Verified 2026-10-14 against baseline `eb97534` plus the local working changes. This follow-up was not committed, pushed or deployed during the local verification described below; the subsequent user request authorized publication together with the shortened daily digests.

## Fixed behavior

- Reproduced the original failure: hold `5`, drag outside, release → the amount incorrectly became `5`.
- `KeypadButton` now arbitrates a pointer sequence once at valid release. Moving out permanently cancels that sequence, even if the finger returns. The compatibility click does not enter a second digit.
- Capture failure, lost capture, cancellation, blur, hidden document, currency/view changes and unmount release the gesture. Secondary contacts do not commit or clear the primary contact.
- Rapid taps, Enter/Space, numeric shortcuts and assistive-technology-style clicks remain available. There is no timed global input lock. Haptics and the existing recording path are preserved.
- The outer button is a stable hit area with real DOM labels. Only the inner cap moves. Compact keys have a 44px minimum.
- Follow-up review reproduced a held pointer entering a trailing digit after an AT-style click or physical key. Non-pointer input now cancels the shared pointer session first, for both the same key and a different key. Its later release cannot add another digit.
- Successful explicit retry now clears `syncFailed` only after the new profile has been read and applied. Failed reads and subsequent failures still show an error; a successful local read no longer waits for a nonexistent local polling timer.

## State illustrations

`PocketIllustration` imports three existing opaque paper PNGs through Vite:

- `empty-ledger`: only after the ledger has loaded, with no entries and no category/currency filter. Loading, read failures and filtered results have separate states. TelegramUI's `Placeholder.action` keeps the action after the title and description.
- `import-review`: records have been parsed and await review; it does not imply they have been saved.
- `partial-import`: records have review flags, missing fields, low confidence or warnings. Existing warning text and edits remain visible.

The empty state uses 220px art (144px on short screens); import headers use 84px art. Both icons for filtered results and read failures use the existing `Icon` mapping. No other library art was added to the homepage. Image requests begin only when the corresponding state appears. Build output uses hashed URLs with `publicDir:false`.

Original 1536×1024 PNGs are retained: approximately 1.19–1.95 MB each. Delivery-size derivatives have not been made; lazy loading avoids homepage transfers but does not shrink these secondary-page downloads.

## Motion review

| Before | After | Why |
| --- | --- | --- |
| The pressed button transformed its own hit area | Fixed outer button; inner `.key-cap` transforms | A moving edge cannot redefine the active target |
| Button shadow was animated directly | Two static shadow layers crossfade with opacity | Shadow blur is not recomputed on every animation frame |
| Captured pointer produced an unchecked click | Valid pointer release commits once; its later click is suppressed | Dragging outside now cancels instead of adding a digit |
| Compact key minimum was 40px | 44px minimum with fluid grid sizing | Preserves a comfortable mobile touch target |

Pointer input uses 100ms press / 160ms release transitions and can retarget during rapid input. Physical keyboard input retains immediate static feedback on both press and release through per-key `data-input="keyboard"`; a later pointer press takes over normally. Hover movement is limited to a fine pointer. This review does not certify a physical-device frame rate.

## Explicit user motion preference

System reduced-motion gating remains disabled because of a direct user instruction, independently of the physical-keyboard feedback rule above.

Original user message, **2026-10-10T10:21:44.680Z**, in task `01a12068-b0ee-7db3-b081-20531fa637b8`:

> 取消（并兼容系统的减少动态效果设置。  ）  这个规则对全局的影响

An earlier user message at **2026-10-10T09:12:38.342Z** also requested removing that rule. The exact records were verified at lines 3251 and 2849 of `C:/Users/wangxr/.codex/sessions/2026/10/09/rollout-2026-10-09T20-24-54-01a12068-b0ee-7db3-b081-20531fa637b8.jsonl`. This direct instruction overrides the generic reduce-motion guidance in the handoff and motion skills; it is not an inferred preference.

## Verification

| Check | Result |
| --- | --- |
| `npm test` | 355 total: 354 passed, 1 skipped, 0 failures |
| `npm run build` | Passed; existing third-party `use client` bundler warnings remain |
| `node tests/keypad-interaction.browser.cjs` | 28 passed; includes CDP multi-touch, drag/cancel, blur/hidden, keyboard and AT-style clicks, and same/different-key input-source switching |
| `node tests/confirm-touch.browser.cjs` | 56 touch/control checks passed at 320×480, 320×568, 390×590 and 390×844 |
| `node tests/ui-state-assets.browser.cjs` | Ledger loading/error/filter/empty/retry states verified in **English**; import states verified in **Chinese, English and Ukrainian**. No homepage illustration requests, no horizontal overflow at 320px, short-screen navigation unobstructed |
| `node tests/keypad-layout.browser.cjs` | 88 combinations: 11 viewports × 4 themes × JPY/CNY, plus 5 Telegram usable-height simulations. Keypad rows, tools and bottom navigation checked for intersecting rectangles and actual hit targets; real entry tools opened. Physical-keyboard press/release have no running transform transition; pointer motion remains enabled under system reduce preference |
| `node scripts/verify-ui-kit.mjs` | Passed |
| `git diff --check` | Passed |

Responsive viewports: 320×400, 320×430, 320×460, 320×480, 320×568, 390×590, 390×844, 412×915, 768×1024, 1280×900 and 1440×1000. The compact keypad parent track reserves 182px for four 44px keys and three 2px gaps. At tested usable heights of 460px and above, the record screen fits one page. Below the physical minimum of 460px, the app pane provides safe internal vertical scrolling; after scrolling to the bottom, all keypad rows and entry tools remain reachable above the fixed navigation. Only duplicate spending statistics yield their row; date editing and quick entry remain accessible in the tool row.

Telegram size-channel simulations use the actual production App and viewport hook with a 320×844 browser layout viewport, while stubbing `viewportStableHeight` and `viewportChanged` at 480, 460, 430, 400 and back to 844px. At 480/460px the pane does not scroll; at 430/400px internal scrolling reaches every keypad/tool target without navigation overlap. Restoring 844px clears the short/tiny flags, resets the pane scroll position to zero and restores the normal statistics row. Short-screen selection follows usable height after insets, rather than a browser `max-height` media query. Results and screenshots are in `outputs/keypad-layout/`, including `results.json` and `telegram-stable-*.png`; these simulations are not a real Telegram WebView session.

Browser evidence:

- `D:/Projects/Tools/for-pocket/outputs/keypad-layout/`
- `C:/Users/wangxr/AppData/Local/Temp/for-pocket-confirm-zxwE30/`
- `C:/Users/wangxr/AppData/Local/Temp/for-pocket-state-assets-TEPsWw/`

Final review logs are under `work/creative-expansion/`: `review-1-npm-test.log`, `review-1-build-final.log`, `review-1-keypad-sequential.log`, `review-1-confirm-sequential.log`, `review-1-states-final.log` and `review-1-assets-verification.json`. An initial simultaneous Vite test run timed out before the keypad appeared in two suites. Those suites passed when rerun separately against unchanged source; run browser suites sequentially because their Vite servers share the dependency optimizer cache. No production change was made to mask the startup timeouts.

These are Chromium tests and local fixtures, not a physical iPhone, Android or Telegram WebView session. Real haptic feel, assistive technologies and device frame pacing still need device verification. No accounts, ledger data, bot configuration or dependencies were changed.
