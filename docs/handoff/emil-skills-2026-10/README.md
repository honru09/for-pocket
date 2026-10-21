# Emil motion skills: October 2026 source snapshot

This is a source archive of five skills actually used for the 2026-10-22 motion and material work. It is reference material, not a new set of active project instructions. The earlier installed-skill snapshot remains in [../skills](../skills/README.md); this separate directory preserves the fresh checkout and is not managed by the older handoff exporter.

## Provenance

- Repository: https://github.com/emilkowalski/skills
- Exact commit: `2d228630ba1446365f614a108cb8252f1feda202`.
- License: [MIT](LICENSE), Copyright (c) 2026 Emil Kowalski.
- Local source: `work/emilkowalski-skills`; source text was checked against the exact Git commit before copying.
- [manifest.json](manifest.json) lists each archived file's SHA-256 and byte size, including the generated index and attributes. The manifest excludes its own hash.
- Text is UTF-8 with LF. Source content and meaningful trailing whitespace are preserved; only individual source files that already contain such whitespace receive precise whitespace-check exceptions in [.gitattributes](.gitattributes). No global check is disabled.
- No unrelated skills, hidden files, AGENTS files, credentials, executable hooks or private conversation history are included here.

## Actual use and included references

| Skill | Use in this work | Included reference files |
| --- | --- | --- |
| [emil-design-eng](skills/emil-design-eng/SKILL.md) | Stable hit areas, restrained interaction feedback, physical continuity and consistent component treatment. | None required by the selected source. |
| [animate](skills/animate/SKILL.md) | Timing, easing, interruption and entry/exit choices for popup and reserve-money flows. | [RECIPES.md](skills/animate/RECIPES.md) |
| [improve-animations](skills/improve-animations/SKILL.md) | Evidence-based Before/After/Why audit and implementation plan. | [AUDIT.md](skills/improve-animations/AUDIT.md), [PLAN-TEMPLATE.md](skills/improve-animations/PLAN-TEMPLATE.md) |
| [find-animation-opportunities](skills/find-animation-opportunities/SKILL.md) | Select category, swipe, setting and theme feedback improvements; reject decorative delay in high-frequency entry. | None required by the selected source. |
| [animation-performance](skills/animation-performance/SKILL.md) | Prefer explicit transform/opacity transitions; distinguish code inspection from measured device frame rate. | None required by the selected source. |

External links and mentions of other skills inside the upstream documents are retained as source text. They are not evidence that those other skills were used, and those packages are not bundled by this snapshot.

## Project-specific boundaries

- The user explicitly cancelled global reduced-motion gating. Do not restore that gate merely because a generic archived guide suggests it.
- The user has already authorized implementation, repair and verification. Audit-only or approval-pause wording inside these reference files does not create a new approval step or override the current task.
- Keep the existing minimal, cute cloud and visual hierarchy; do not add AI labels, unrelated decoration or delay to common entry actions.
- Preserve numeric touch/haptic feedback and the existing no-animation path for physical keyboard input.
- Prefer interruptible transform/opacity motion and stable tappable bounds. A CSS or browser pass alone does not prove a fixed frame rate on every phone.
- Product assets live in `public/assets`; generated raster materials are not recreated as source-only vector substitutes.

See [the implementation and verification record](../../../plans/2026-10-22-motion-refresh.md). Deployment status must be checked from Git history and the live release; this archive does not claim deployment.
