# UI Kit v1 — candidates-v3

This folder is the collected candidate shelf for the tactile paper / soft-clay visual direction of for.pocket.

## Production-ready candidates

The following files are transparent, text-free UI state artwork. They are safe to render as responsive `<img>` elements because the surrounding labels, amounts, dates, names, confidence values, and action states remain live DOM content:

- `illustrations/*-tactile-v1-web.png` — lightweight 768px (or 512px square) derivatives used by the app.
- `icons/*.svg` — six compact decorative icons used alongside existing accessible controls.

The app maps these assets through `src/PocketIllustration.jsx` and `src/CandidateIcon.jsx`. Do not use them as CSS backgrounds or as replacements for text, status, or hit areas.

## Review-only candidates

`illustrations/masters/` keeps the original high-resolution masters. `review/` contains keypad, mascot, accessory, and motion boards. These are reference material for responsive implementation and motion tuning, not runtime backgrounds or fixed-size sprites. The numeric keypad remains DOM/CSS-driven so keycaps resize with the current layout.

## State mapping

| Candidate | Runtime surface | Meaning kept in DOM |
| --- | --- | --- |
| category-suggestions | category suggestion strip | labels and counts |
| recurring-reminder | empty recurring editor | dates, amount, category, save state |
| receipt-review | receipt import with files selected | merchant, amount, date, confidence, review state |
| summary-review | open AI summary before a result | period, totals, generated text, errors |
| export-envelope | history export affordance | export action and result/error |

The full machine-readable inventory is in `manifest.json`; `index.html` is a local visual review sheet with no external dependencies.
