# Cloud artwork and motion — 2026-10-14

The selected character remains the warm yellow cloud in `public/assets/mascot-main.png`.

## Delivered

- Four transparent 4×2 PNG sheets in `public/assets/mascot/`: expressions, tap/rebound poses, cash storyboard, and the new cotton-pop sequence. The pop sheet ends with a genuinely empty frame.
- Expressions are visible primary artwork after each tap. Removed the obscured, low-opacity whole-cloud overlays that produced edge ghosts.
- A 100ms expression transition and continuous CSS/Web Animations keep movement independent of React rendering. This is interpolated motion around drawn key poses, not a claim that eight PNG poses contain 60 unique drawings.
- The seventh tap uses the 280ms pop sequence. The sign falls once; two taps or the original seven-second deadline restore the cloud with a 220ms rebound. New input interrupts restoration.
- Cash uses the generated banknote prop with continuous flight/catching motion. Expense tears animate separately; no duplicate banknote or static tear replaces them.
- The annoyed symbol has its own small motion without cutting a notch out of the cloud. Night has one hat; storm uses the surprised pose.
- Interaction assets decode ahead of use. Toy taps do not submit an expense, and animation timers/portals clear on unmount.
- Keypad pressed-state cleanup and keyboard focus remain usable; text inputs keep their caret without a new focus rectangle. No system reduced-motion override was reintroduced.

## Verification

- `npm test`: 355 total, 354 passed, 1 existing environment-dependent skip, 0 failed.
- `npm run build`: passed. Existing dependency `use client` bundler notices remain informational.
- `node scripts/verify-ui-kit.mjs`: passed; both manifests agree, files decode with real transparency, pop frames 0–6 contain artwork and frame 7 is empty.
- `node tests/mascot-motion.browser.cjs`: passed. Tests visibility, sequential full-opacity frames, moving tears, weather, rapid taps, restoration and cleanup.
- `node tests/confirm-touch.browser.cjs`: 56 checks across 320×480, 320×568, 390×590 and 390×844 passed; no viewport overflow or page errors.
- Browser screenshots inspected for the six tap expressions, banknote crop, annoyed-symbol clipping and mobile confirmation control.

Browser tests use isolated local fixtures and do not write production expenses. Actual refresh rate depends on the device and WebView; real-device frame timing has not been measured in this run.
