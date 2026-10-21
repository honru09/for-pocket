# 当前接棒状态 · 2026-10-22

## 用户最新要求

最新一轮（Emil 动效与整套素材）：用户明确说素材不限于背景/按钮，还要覆盖完整弹窗、每个页面及组件；自由金从零重做。采用用户指定的 `emilkowalski/skills` 新版，精确归档见 [emil-skills-2026-10](emil-skills-2026-10/README.md)，当前实现/验收细项见 [动效计划](../../plans/2026-10-22-motion-refresh.md)。

- 12 件新实图：`pocket-materials-v2` 的 10 件（纸袋、钞票、硬币、信封、账本、小票、日历、回形针、按键、胶囊）＋ `journal-surfaces-v2` 的 2 种纸面。每件保留原 PNG、完整提示词和 SHA；运行时只用轻量 WebP。
- `JournalMaterial.jsx` + `journal-materials.css` 统一记账、账本、设置、个人、圈子、导入及弹窗的材质；功能文字保持真实 DOM，所有装饰不拦截点击。主页布局及云朵形象保持原决定。
- 自由金仅在设置中：`FreeMoney.jsx`、`free-money-plan.mjs`、`free-money-copy.mjs`、`free-money.css`；先算好本地金额即可保存，分析可选，失败保留输入，双击/过期响应/跨账本隔离。
- `Sheet` 支持 160ms 退出与焦点归还，提前关闭从当前动画帧继续；备注继续使用独立 160ms，保持飞钞票的时序。普通保存提示缩小并允许点击穿透，撤销/重试/错误提示继续正常交互。
- 分类选中最小滚动、触屏无粘滞悬停；右滑重新接手从当前绘制位置继续，关闭时保留背景；设置行和主题卡只压内部视觉，不缩小点击区域。
- 本轮开工基线 `a9550d1` 已部署为 `for-pocket-00061-h7q`。当前改动的最终 commit/测试/发布需核对本计划末尾及 `git log`，不要将基线 revision 当成新版本。

### 前一轮已实现要求（保留以便回溯）

先修复此前指出的问题，再提交 GitHub `main`。备注确认使用**实际生成的现金图标**；弹窗淡入淡出，点击后现金飞到首页云朵，再播放支出哭泣或收入收钱。用户又明确要求生成并使用弹窗背景、组件和图标素材：保持现有简约可爱形象，不能只停留在设计说明。之前要求将代码、计划、聊天和所用 skills 一并归档，保证下一位 agent 能接棒。

`8dd8adf` 是本轮开始前已推送的键盘/备注基础版本；当前源码与它的区别见 `git diff 8dd8adf`。提交后的真实 commit 用 `git log -1` 查询，避免文档自引用哈希或把健康接口的 0.5.0 当作发布证明。

## 修复与验证入口

| 用户问题/复查发现 | 当前实现 | 验证入口 |
| --- | --- | --- |
| 手机数字键盘扁、空隙大 | 手机按键填满弹性网格；短屏保留44px底限；外部命中框静止、内部按压回弹 | `tests/keypad-layout.browser.cjs`、`keypad-interaction.browser.cjs` |
| 备注不能直接保存 | 复用同一乐观保存路径；立即保存与清金额；防连续提交；中文输入法选词Enter不误提交 | `tests/note-submit.browser.cjs` |
| 备注现金按钮及连贯动画 | 新透明PNG `public/assets/note-cash-bundle-v1.png`；180ms淡入/160ms淡出；520ms路径飞行；支出/收入各接既有云朵表情；离页取消旧动作；路牌状态恢复云朵 | `tests/note-submit.browser.cjs`；生成提示词见同名JSON |
| 弹窗缺少配套实图素材 | `public/assets/popup-kit-v1/` 保留3张生成PNG及提示词/校验manifest；`src/popup-materials.css` 接入纸面、92×68px现金按钮底片和26px云朵印章。运行时采用384px纸面、256×192按钮、96px云朵和192px现金WebP；保持四种主题色及点击命中区域 | `tests/popup-materials.browser.cjs`，320/390px×4主题共8组；`note-submit`、`circle-reactions` |
| 乌克兰语备注标题被断开 | `public/i18n.mjs` 增加三语简短 `noteTitle`，保留正文原有语义 | 弹窗浏览器回归和三语备注提交回归 |
| 软键盘挡住备注按钮 | dialog按可视视口高度及offsetTop居中，跟踪resize/scroll，Emoji面板保留独立头像锚点 | 同上，三语×3可视区域，真实App+软键盘尺寸模拟 |
| 跨设备切账本时备注指向错误草稿 | scope变化关闭备注抽屉，两本草稿分别保留 | `tests/note-scope.browser.cjs`，真实服务端+App轮询 |
| 导入页离页丢文字/解析记录 | sessionStorage按用户及账本隔离，保存编辑内容与稳定ID；成功/部分成功清理；文件需重选但解析项保留 | `tests/import-draft.test.mjs`、`import-draft.browser.cjs` |
| 旧审计L01：离圈后还收到新账目信息 | 发送/旧绑定编辑时重验圈成员与Telegram身份，失效绑定撤销，合并账号兼容 | `tests/telegram-chat-sync.test.mjs` |
| 旧审计L02：邀请预览泄露位置 | 未加入者仅看圈子基础信息；加入后才能看presence | `tests/circle-presence.test.mjs`、`ledger-isolation.test.mjs` |
| 旧审计L03：Bot忽略账本时区 | 文字/图片/语音/文件/摘要使用profile时区；重试锁定原消息时间及时区；定位数字同样锁定 | `tests/telegram-ai.test.mjs`、`telegram-location.test.mjs` |
| 旧审计L04：金额/分摊被静默修改 | 非零超额精度、未知/重复/已离圈分摊人强制复核；禁止自动入账；中英乌复核原因 | `tests/ai-lossy-normalization.test.mjs` |
| 旧审计L05：写盘失败却先发成功卡 | 消费外发先过持久化门槛；显式后台写模式先回客户端再持久化/通知；重试原ID不重复 | `tests/expense-notification-routes.test.mjs`、`telegram-chat-sync.test.mjs` |
| 自由金残留减少动态规则 | 按用户明确指令移除 `free-money.css` 中剩余门控 | `rg prefers-reduced-motion src` 应无残留 |
| Windows随机端口EACCES假失败 | 剩余测试fixture使用系统分配端口，与已有测试一致 | `npm test`、键盘/云朵浏览器脚本 |

## 此前主要需求的实现证据

- 个人账本隔离/本人跨圈同步：`ledger-sync.mjs`、`tests/ledger-isolation.test.mjs`、`tests/ledger-sync.test.mjs`。
- 小账本默认本人，头像叠加只在筛选抽屉；不在个人/设置/账本页冒出其他成员头像：`src/history-filter.mjs`、`src/App.jsx` 的 record-only portal、`ui-polish.css` 的scope限制。
- 取消加号、单行30分类与高频排序：`keypadKeys`、`category-drawer`、`tests/category-pills.*`。
- Emoji分组/累计计数/满屏/静默通知/阅后清理：`reaction-*.mjs` 与对应tests；右滑删除/复制/编辑：`SwipeExpenseRow`。
- 文字/文件/语音记账与自然闲聊：`telegram-ai.mjs`、`telegram-intent.mjs`、`ai.mjs` 及tests；有损解析必须复核。
- 自动位置/时区/天气/币种与三语：`location-client.mjs`、`usePocketViewport.js`、`public/timezone.mjs`、`src/weather.mjs` 及相关tests。
- 定时短摘要、22点无记录提示、静默且作者不重复收到消费提醒：`digest*`、`missing-entry-reminder.mjs`、`push-cleanup.mjs`、`telegram-expense-sync.mjs` 与tests。
- 云朵点击、流动吐气、轻生气、爆开路牌、天气配件/现金动画：`PocketMascot.jsx`、`mascot.css`、素材manifest及 `mascot-motion.browser.cjs`。

以上是代码与测试入口，不代表本轮逐项重新跑过真实用户的所有线上操作。

## 仍需真实环境验收的范围

1. 实机 iPhone/Android/Telegram 的帧率、触觉、系统软键盘过渡；桌面模拟不等同于实机。
2. Google OAuth真实登录、真实用户语音识别质量、Telegram实际送达/定时触发：当前测试主要是本地fixture，本轮不向用户发送测试通知。
3. Cloud Run当前存储挂载、单实例策略、云端备份/恢复以及Scheduler/Tasks实际配置：历史部署文档有陈旧内容；未重新检查的部分不能宣称完成。
4. 上线结果必须通过revision/commit或资源哈希核实。当前改动需全部回归成功后再提交，不要仅看到GitHub测试成功就写“已上线”。
5. 聊天归档只能包含本机可获得的可见消息；附件路径不代表图片/视频本体已归档。历史压缩缺失或已删除附件应明确标注，不能凭摘要虚构原文。

## 接续步骤

1. 先检查 `git status --short` 和 `git log -4 --oneline`，保留其他任务改动。
2. 新环境先运行 `npm ci`，再运行 `npx playwright install chromium`（Linux首次安装用 `npx playwright install --with-deps chromium`）；Playwright作为开发依赖固定为本轮实际验证的1.62.1。之后单元测试：`npm test`；构建：`npm run build`。
3. 浏览器测试逐个执行，避免共享Vite缓存竞争：note-submit → note-scope → import-draft → keypad-layout → keypad-interaction → confirm-touch → ui-state-assets → circle-reactions → mascot-motion → location。
4. 检查归档脱敏和 `git diff --check`，核对素材PNG、运行时WebP及manifest都进入版本控制；聊天/技能全文和范围说明见 `transcript/README.md`、`skills/README.md`。
5. 修复通过后推送main，最后运行 `npm run verify:deployment -- --require-google --require-telegram` 并核对实际revision。

## 当前验证记录

### 2026-10-22 素材与自由金新版本

- 已完成12件实图接入和自由金重做；完整构建通过，Node全量472项：471通过、1跳过、0失败。
- 新材质36组（3语×3宽度×4主题）、4种退出路径；自由金三语保存/失败/重试/跨账本；最终按键底片真实绘制、滑动中途重接、弹窗提前关闭与焦点归还均通过。
- 88种键盘布局、28项输入交互、56项确认、125项圈子/Emoji、8组原弹窗素材，以及备注飞钞票、分类、UI状态、导入草稿回归全部通过。
- 在回归中实际修复了乌克兰语导入页窄屏溢出、保存提示遮挡、空账本入场时按钮碰到底部菜单、按键素材被旧样式覆盖、自由金提示语言滞留。完整记录见 [本轮计划末尾](../../plans/2026-10-22-motion-refresh.md)。
- 以下条目为之前版本的历史验收；本次发布状态须另查当前commit、CI和线上资源哈希。

### 前一版本

- note-submit：三语、9种可视视口、输入法、连续提交、收支动画、路牌恢复和切页取消通过。
- note-scope：真实服务端跨设备切账本回归通过。
- import-draft：导航/刷新/账号账本隔离/稳定ID/文件重选/失败重试/迟到成功通过。
- 完整构建通过；包含最终通知并发回归后Node全量466项：465通过、1跳过、0失败。
- 手机键盘88种布局、28项输入交互、56项触控确认、125项圈子/紧凑账本检查通过；UI状态/三语/空态、云朵动作、位置浏览器脚本全部通过。
- 弹窗素材接入后：`popup-materials.browser.cjs` 的320/390px×4主题共8组通过，备注/主题截图及触控无素材遮挡；`note-submit` 与125项 `circle-reactions` 再次通过；Node全量再次465通过、1跳过、0失败。素材接入后的最终构建通过，产物中4张新增WebP合计23,844字节；已目视复查320px中文备注/主题与390px乌克兰语备注/Emoji弹窗截图，未见新增遮挡。以上为本交接版本提交前验证记录；实际提交及上线状态按 git log 和线上资源哈希核对。
