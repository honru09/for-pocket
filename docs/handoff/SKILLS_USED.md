# for. Pocket · Skills and implementation references

更新时间：2026-10-21。这里记录本项目在本轮及前序交互中实际使用或明确采用的 skill / 组件参考，方便下一个 agent 复用方法。技能正文属于 Codex 工作区的全局资源，不把系统文件复制进产品仓库；路径和用途保留在此。

## 已明确采用

| 名称 | 来源/路径 | 用途 |
| --- | --- | --- |
| TelegramUI | npm `@telegram-apps/telegram-ui` 2.1.13；官方仓库 <https://github.com/telegram-mini-apps-dev/TelegramUI> | AppRoot、Button、Input、Select、Cell、SegmentedControl、Snackbar、Placeholder、Tappable 与 Telegram 风格基础变量 |
| interaction-design | `C:\Users\wangxr\.codex\skills\interaction-design\SKILL.md` | 本轮键盘按压与备注提交：反馈优先、100–150ms 微反馈、transform/opacity 合成层、可中断交互 |
| responsive-design | `C:\Users\wangxr\.codex\skills\responsive-design\SKILL.md` | 320/390px 手机、短屏 Telegram WebView、安全区、弹性网格和不溢出布局 |
| frontend-design / ui-design | `C:\Users\wangxr\.codex\skills\frontend-design\SKILL.md`；`C:\Users\wangxr\.codex\skills\ui-design\SKILL.md` | 奶油纸色、生活手账质感、信息层级、移动端可读性和组件一致性 |
| design-system | `C:\Users\wangxr\.codex\skills\frontend-design-system\SKILL.md` | 统一字号、触控尺寸、主题 token、按钮/抽屉/设置页的间距规范 |
| motion-foundations | `C:\Users\wangxr\.codex\skills\motion-foundations\SKILL.md` | 云朵、确认、表情和键盘动作的时间曲线、GPU 合成与可访问性约束 |
| improve-animations / review-animations | `C:\Users\wangxr\.agents\skills\improve-animations\SKILL.md`；`C:\Users\wangxr\.agents\skills\review-animations\SKILL.md` | 前序云朵、路牌、Emoji 和按钮动作的高帧审查与缺帧修复 |
| imagegen / gpt-image / asset-gen | `C:\Users\wangxr\.codex\skills\imagegen\SKILL.md`；`C:\Users\wangxr\.codex\skills\gpt-image\SKILL.md`；`C:\Users\wangxr\.codex\skills\asset-gen\SKILL.md` | 云朵状态图、手账插画、按钮/空状态素材；生成结果进入 `public/assets/` 前需检查透明边界 |
| playwright-skill | `C:\Users\wangxr\.codex\skills\playwright-skill\SKILL.md` | 生产构建后的浏览器回归、320/390/600/768/1280 视口检查、交互与 pageerror 验证 |
| diagnosing-bugs | `C:\Users\wangxr\.codex\skills\diagnosing-bugs\SKILL.md` | 录入按钮无效、位置泄漏、Emoji 重试、七次点击状态等问题的复现—定位—回归闭环 |

## 产品中对应的实现入口

- TelegramUI 导入：`src/main.jsx`
- 全局 token 与键盘：`src/styles.css`
- 移动布局：`src/pocket-layout.css`、`src/refinements.css`、`src/ui-polish.css`
- 云朵状态：`src/PocketMascot.jsx`、`src/mascot.css`、`public/assets/mascot/manifest.json`
- 圈子表情：`src/CircleReactions.jsx`、`circle-reactions.mjs`、`reaction-notifications.mjs`
- 账本权限/同步：`domain.mjs`、`ledger-sync.mjs`、`store.mjs`
- Telegram 解析与路由：`bot.mjs`、`telegram-ai.mjs`、`telegram-intent.mjs`、`ai.mjs`
- 定时摘要：`digest.mjs`、`digest-copy.mjs`、`missing-entry-reminder.mjs`、`scripts/setup-reminders.sh`
- 位置：`location.mjs`、`src/location-client.mjs`、`src/LocationViews.jsx`、`public/timezone.mjs`
- 测试：`tests/` 下的 `*.test.mjs` 与 `*.browser.cjs`

## 技能使用约束

1. 不要为了视觉升级引入第二套 UI 框架；TelegramUI 是组件首选。
2. 动效只优先改 `transform` 与 `opacity`，避免布局抖动和长时间锁定输入。
3. 保持用户要求的简约可爱路线；不添加高光、扫描线、AI 星号或冗长解释。
4. 任何云端/Telegram 外部写操作都要先完成本地测试，并使用已有授权与安全头；凭据只在私有环境。
5. 所有新增素材要登记到 manifest，并做透明度、尺寸、加载 fallback 与浏览器回归。
