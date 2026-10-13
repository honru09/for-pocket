# for. · 花给生活 — 深度平台审核综合交付报告

日期：2026-10-13  
基线：`27a8d73b559ef1a5e1519c3fba4987c8a2546532`  
范围：现有 Web/TMA 界面、账本与圈子领域逻辑、AI 导入、Telegram 同步、持久化/通知边界，以及可直接使用的 UI 素材包。

## 结论先行

平台没有确认的 P0，但还不应按“可无条件发布”验收。首要风险集中在四件事：

1. 被移除或退出圈子的成员仍可能收到旧 Telegram 账单卡的后续金额/备注更新（P1）。
2. 手工记账的保存动作直到草稿有效才出现，且主要表现为云朵旁的勾号；用户可能找不到完成动作（P1）。
3. 快速整理的文本、附件和候选结果在普通导航离开页面后丢失（P1）。
4. 全局样式移除了表单字段和部分头像入口的可见焦点，键盘用户容易迷失位置（P1）。

另有已复现的 P2：邀请预览暴露圈内成员地点、Telegram 解析忽略账户时区、AI 有损金额/分摊标准化未强制复核、网页通知早于持久化成功，以及访客/桌面布局/对比度/返回路径等界面问题。

本次没有偷偷修改业务源码来“消除”这些发现。素材已生成并通过结构与浏览器检查，但尚未接入任何产品页面，也未部署。

## 审核产物

- [设计审核](./design-assessment.md)：Nielsen 启发式 **25/40，Acceptable**；含截图证据、认知负荷、persona 路径与 P1/P2 建议。
- [技术与界面审核](./technical-assessment.md)：五维 **12/20**（Clarity 2、Usability 2、Aesthetics 3、Accessibility 2、Delight 3）。
- [后端、领域逻辑与安全审核](./logic-security-assessment.md)：**1 项 P1、4 项 P2 已复现**；含隔离复现脚本、持久化/Cloud Run 发布门槛与未验证边界。
- [UI 素材册](../../public/assets/ui-kit-v1/index.html)：可独立打开，不依赖业务服务或外部 API。

## 优先级清单

| 优先级 | 问题 | 证据/基线位置 | 建议验收 |
| --- | --- | --- | --- |
| P1 | 退出/移除成员仍接收 Telegram 旧账单卡更新 | `telegram-expense-sync.mjs:170,188` | 授权变化立即失效；编辑、删除、重试均不向离圈成员发送；正式回归覆盖并发更新 |
| P1 | 保存动作隐藏且缺少稳定文字入口 | `src/App.jsx:743–757`、`src/PocketMascot.jsx` | 始终有可发现的保存区域；无效时说明缺少条件；角色反馈只做二次确认 |
| P1 | AI 快速整理草稿离开页面即丢失 | `src/App.jsx:301–304,753,770`、`src/AiImportPage.jsx:161–173,198–210` | 内部导航往返保留草稿；切换用户/账本隔离；主动清除才丢弃 |
| P1 | 输入/选择/头像焦点不可见 | `src/pocket-layout.css:33–34`、`src/account-styles.css:48,101` | Tab 从首个字段到保存始终有清晰 `:focus-visible`；200% 放大和四种主题复验 |
| P2 | 邀请预览泄露圈内成员地点名称/地址 | `domain.mjs:52,224`、`circle-presence.mjs:16` | 未入圈仅展示最小共享说明；不返回成员 presence 或地址 |
| P2 | Telegram 使用进程默认时区 | `telegram-ai.mjs:816` | 传入并验证发送者/账本 IANA 时区；跨午夜、DST、半小时/四十五分钟时区回归 |
| P2 | AI 静默舍入 JPY 小数、丢弃未知分摊人且可自动入账 | `ai.mjs:87,200,215,223`、`telegram-ai.mjs:844` | 任何有损修正强制人工复核；未知参与者保留诊断，不得静默缩减 |
| P2 | 网页通知早于持久化成功 | `server.mjs:354`、`telegram-expense-sync.mjs:146` | 事务/通知 outbox 以持久化成功为门槛；失败语义可重试且幂等，不重复发卡 |
| P2 | 保存状态只在别页表达，且“Saved”可能早于异步写入 | `src/App.jsx:571–572,744`、`src/pocket-layout.css:24` | 记录页持续显示本机/待同步/已确认/失败重试四态，文案与事实一致 |
| P2 | 访客/不可用 AI 状态仍展示可编辑来源区，禁用按钮像可用 | `src/AiImportPage.jsx:407–416,434`、`src/styles.css:10` | 先说明能力与下一步；支持草拟则保留草稿；无可用登录方式不显示死路主行动 |
| P2 | Back 固定回设置，宽屏类别条裁切且底部导航遮挡 | `src/App.jsx:753`、`src/styles.css:18–21`、`src/pocket-layout.css:188–206` | 记录来源路由；桌面利用空白区域；为固定导航预留安全区 |
| P3 | 导入空态显示孤立数字 `0`、次级文字对比度偏低、缺少 reduced-motion 证据 | `src/AiImportPage.jsx:435`、`src/styles.css:1,84,98` | 使用布尔条件；信息性文字按实际主题核算；补 `prefers-reduced-motion` 验收 |

## 领域与安全边界

- 基线全量测试当时为 **331 tests / 330 passed / 0 failed / 1 skipped**；跳过项是 mock-GCloud reminder 集成测试。
- 当前工作区在并发任务后重跑为 **345 tests / 344 passed / 0 failed / 1 skipped**。这证明当前测试集没有回归失败，但不能把它当成对所有并发改动的完整浏览器、真实 Telegram、Google 登录或生产存储验收。
- `work/audit-2026-10-13/` 下的隔离复现脚本故意断言当前缺陷不变量，因此非零退出是审计证据，不是修复失败报告。它们不接触真实凭据、生产账户或真实 Telegram 发送。
- Cloud Run `/data` 是否为持久卷、多实例是否共享事务存储、备份恢复和 RPO/RTO 尚未读取生产配置；这些是发布门槛，不应在本地审计中假定已满足。
- 未读取 `.env`、真实账单、凭据；未向生产发送消息；未把模型识别质量或真实平台送达率冒充为已验收事实。

## UI 素材包 v1

位置：[public/assets/ui-kit-v1](../../public/assets/ui-kit-v1/)。清单与用途见 [manifest.json](../../public/assets/ui-kit-v1/manifest.json) 和 [README.md](../../public/assets/ui-kit-v1/README.md)。

| 类别 | 内容 |
| --- | --- |
| 插画 | `empty-ledger`、`import-review`、`shared-circle`、`pending-retry`，各 1536×1024 PNG |
| 图标 | 16 枚 24×24 SVG，含保存状态、导入、文件类型、圈子邀请、分摊、位置和空筛选状态 |
| 精灵图 | `pocket-ui-icons.svg`，`currentColor` 跟随主题 |
| 文案 | 中文、英文、乌克兰语建议，未覆盖现有 i18n |
| 生成记录 | `prompts.json`，不含账本、凭据或个人信息 |
| 预览 | `index.html`，四主题切换、懒加载和移动宽度验证 |

素材语义严格区分“识别完成”“本机草稿”“等待服务器确认”“已确认写入”。插画不承载金额、权限、错误原因或成功承诺；不要用它们替代真实成员列表、共享范围说明或保存状态。

### 素材验证

已运行：

```powershell
node scripts/verify-ui-kit.mjs
npm run build
npm test -- --reporter dot
```

素材结构验证结果：**passed**（4 illustrations、16 icons、3 languages，PNG 尺寸和 SVG 结构正确）。素材册已检查桌面与 390×844 手机宽度、44px 按钮、四主题切换和懒加载行为。`npm run build` 通过；Vite 仅输出依赖包的 `use client` 保留提示。

素材目前**未集成、未部署**。由于 `vite.config.mjs` 使用 `publicDir: false`，正式接入时应从 `src/` 导入资源让 Vite 生成哈希文件，不要直接引用 `/assets/ui-kit-v1/...`。

## 推荐执行顺序

1. 先修复圈子退出后的 Telegram 授权失效，并补通知权限回归。
2. 同时核实生产持久化卷、单写者/数据库事务、备份恢复和告警；这是发布门槛。
3. 统一网页保存状态与通知 outbox，再处理 AI 金额/分摊的确定性复核约束和时区来源。
4. 修复保存入口、草稿保护、焦点/对比度、访客门、来源路由和桌面安全区。
5. 将 `work/audit-2026-10-13/` 证据转成正式回归；再在真实账号、真实 Telegram、真实 OAuth、真实部署存储上做端到端验收。
6. 最后按素材 README 的导入方式接入空态、导入核对、圈子说明和失败恢复；素材不是 P1 修复的替代品。

## 本报告边界

报告行号以基线提交为准，当前工作区已有其他任务对位置、反应、圈子等文件的修改，未被本轮综合报告重新审验。若这些文件继续变化，应重新运行对应审核、更新源码指纹，并重新执行浏览器与真实集成回归。
