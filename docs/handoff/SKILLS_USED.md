# for-pocket 技能与组件交接

导出于 2026-10-21T17:07:42.425Z。这次通过主任务的实际读取命令核对技能，正文和必要文本参考已放入仓库；不再仅依赖原电脑的绝对路径。

## 有读取证据的技能

| 技能 | 仓库内正文 | 读取记录日期（UTC） | 归档文件数 |
| --- | --- | --- | --- |
| animate | [SKILL.md](skills/animate/SKILL.md) | 2026-10-09 — 2026-10-14 | 2 |
| emil-design-eng | [SKILL.md](skills/emil-design-eng/SKILL.md) | 2026-10-21 — 2026-10-21 | 1 |
| improve-animations | [SKILL.md](skills/improve-animations/SKILL.md) | 2026-10-14 — 2026-10-21 | 3 |
| interface-design | [SKILL.md](skills/interface-design/SKILL.md) | 2026-10-10 — 2026-10-11 | 2 |
| pick-ui-library | [SKILL.md](skills/pick-ui-library/SKILL.md) | 2026-10-09 — 2026-10-13 | 1 |
| responsive-design | [SKILL.md](skills/responsive-design/SKILL.md) | 2026-10-14 — 2026-10-16 | 5 |
| review-animations | [SKILL.md](skills/review-animations/SKILL.md) | 2026-10-14 — 2026-10-14 | 2 |
| computer-use | [SKILL.md](skills/computer-use/SKILL.md) | 2026-10-09 — 2026-10-14 | 1 |
| imagegen | [SKILL.md](skills/imagegen/SKILL.md) | 2026-10-12 — 2026-10-21 | 10 |
| skill-installer | [SKILL.md](skills/skill-installer/SKILL.md) | 2026-10-21 — 2026-10-21 | 6 |
| code-review | [SKILL.md](skills/code-review/SKILL.md) | 2026-10-11 — 2026-10-11 | 2 |
| diagnosing-bugs | [SKILL.md](skills/diagnosing-bugs/SKILL.md) | 2026-10-10 — 2026-10-21 | 3 |
| ffmpeg-skill | [SKILL.md](skills/ffmpeg-skill/SKILL.md) | 2026-10-14 — 2026-10-14 | 90 |
| frontend-design-system | [SKILL.md](skills/frontend-design-system/SKILL.md) | 2026-10-12 — 2026-10-12 | 4 |
| frontend-design | [SKILL.md](skills/frontend-design/SKILL.md) | 2026-10-09 — 2026-10-14 | 1 |
| gpt-image | [SKILL.md](skills/gpt-image/SKILL.md) | 2026-10-13 — 2026-10-13 | 37 |
| impeccable | [SKILL.md](skills/impeccable/SKILL.md) | 2026-10-11 — 2026-10-13 | 156 |
| interaction-design | [SKILL.md](skills/interaction-design/SKILL.md) | 2026-10-10 — 2026-10-21 | 4 |
| interface-design (interface-design-codex) | [SKILL.md](skills/interface-design-codex/SKILL.md) | 2026-10-10 — 2026-10-10 | 2 |
| motion-foundations | [SKILL.md](skills/motion-foundations/SKILL.md) | 2026-10-13 — 2026-10-14 | 1 |
| playwright-skill | [SKILL.md](skills/playwright-skill/SKILL.md) | 2026-10-09 — 2026-10-21 | 6 |
| responsive-design (responsive-design-codex) | [SKILL.md](skills/responsive-design-codex/SKILL.md) | 2026-10-21 — 2026-10-21 | 5 |
| ui-design | [SKILL.md](skills/ui-design/SKILL.md) | 2026-10-10 — 2026-10-16 | 112 |
| writing-for-agents | [SKILL.md](skills/writing-for-agents/SKILL.md) | 2026-10-21 — 2026-10-21 | 3 |

证据与来源路径见 [skills/manifest.json](skills/manifest.json)。日期落在本轮的条目可用于定位本轮采用；较早的条目为历史采用。目录中的文件是导出时安装版本，未声称每份正文自最初读取以来完全没变。

## 已采用的组件参考

TelegramUI：`@telegram-apps/telegram-ui` 2.1.13，来源 <https://github.com/telegram-mini-apps-dev/TelegramUI>，运行依赖以 package.json/package-lock.json 为准；导入入口 src/main.jsx。这是用户明确选用的组件库，不存在本地 TelegramUI SKILL.md。

## 使用边界

- [归档范围与说明](skills/README.md)；这些历史 skill 指南按需参考，不能覆盖当前用户要求。
- 旧清单列过但本次没有可核对读取证据的 asset-gen 等仅视为候选，未将其冒充实际使用的技能。
- 动效继续保持简约可爱与 transform/opacity 合成层；用户已取消全局减少动态规则，归档技能中的相反通用建议不能恢复该规则。
- 产品素材仍在 public/assets；本目录存工作方法和依赖参考，不重复复制产品图片。

## 本轮使用的新版 Emil 技能

用户指定的 emilkowalski/skills 已按精确 Git commit 单独归档，见 [新版技能正文、MIT 许可和 SHA 清单](emil-skills-2026-10/README.md)。包含 animate、emil-design-eng、improve-animations、find-animation-opportunities、animation-performance 及必要参考；这是独立于上表已安装版本的快照。实际采用与取舍见 [本轮动效计划](../../plans/2026-10-22-motion-refresh.md)。
