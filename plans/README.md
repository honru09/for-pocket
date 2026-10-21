# Motion plans

| Plan | Severity | Status | Dependencies |
| --- | --- | --- | --- |
| [Secondary controls · 2026-10-22](2026-10-22-motion-refresh.md) | Medium | Implemented; static checks and 11 contract tests passed; visual verification pending | Existing styles/easing tokens; main task owns shared sheets and App gesture logic |

Apply the scoped secondary controls first, then run category, theme/setting and ledger gesture browser checks alongside the main task's shared surface changes. Do not add motion to the physical-keyboard input path or restore removed reduced-motion gating.
