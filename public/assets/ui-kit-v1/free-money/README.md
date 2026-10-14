# Free-money tactile candidate assets v1

这组素材是根据“未设置自由金 → 两步手账向导 → AI 诊断 → 首页金币勋章”的交互灵感生成的候选包。它们目前只进入候选归档，不改变业务数据契约，也没有覆盖 Bot 正在处理的 mascot 文件。

## 视觉方向

- 奶油纸、浅金、鼠尾草绿、杏橙，延续现有 Q 式云朵和拟物手账质感。
- 图片只负责材质、物件和情绪；金额、货币、日期、步骤、AI 文案、按钮语义和状态全部由 DOM/UI 提供。
- 四张 PNG 都保留 alpha。`illustrations/masters/` 是原始 master，`illustrations/*-web.png` 是仅用于预览和移动端候选审查的等比缩小版。

## 素材与落地边界

| 素材 | 建议使用位置 | 推荐显示尺寸 | 真实 UI 负责的内容 |
| --- | --- | --- | --- |
| `free-money-orb-tactile-v1` | 未配置时首页右下角悬浮入口 | orb 72–96px | 气泡文案、按钮、关闭气泡、无障碍标签、隐藏条件 |
| `free-money-wizard-tactile-v1` | 两步式 `Pocket Sheet` 的纸张底板 | 宽度 ≤ 520px | 两步标题、输入框、金额、校验、CTA、关闭/返回 |
| `free-money-coin-badge-tactile-v1` | 已配置首页的 45° 金币徽章 | 48–96px | 今日安心花、金额滚动、明细按钮、激活状态 |
| `free-money-diagnosis-tactile-v1` | AI 诊断卡的中性空白壳 | 宽度 ≤ 420px | 加载/成功/错误状态、AI 结果、重试、最终额度 |

另有两个不含语义的矢量装饰：`interaction/free-money-confetti-sparkle-v1.svg` 用于开启后的短暂撒花，`interaction/free-money-sheet-handle-v1.svg` 用于抽屉顶部拖动提示。它们不能替代真实按钮、焦点环或状态图标。

## 交互实现建议

1. `FreeMoneyOrb`：图片放在真实 `button` 内，按钮最小命中区 44px；气泡是相邻的 DOM 文本。未配置时显示，`fixedCapital.enabled` 后卸载。
2. `FreeMoneyWizardSheet`：图片只做纸张层，真实表单覆盖三块空槽。抽屉升起、遮罩、焦点回收和键盘适配由 CSS/React 实现。
3. `FreeMoneyDiagnosisCard`：云朵呼吸和卡片入场由 CSS 控制；请求尚未返回时只能表达“处理中”，不能用图片暗示 AI 已完成。
4. `FreeMoneyCoinBadge`：图片作为 `<img>` 或 `background-image` 之外的独立层使用，金额由 DOM 叠加；记账成功后用 transform/数值插值完成轻微弹跳和滚动。
5. 撒花庆祝优先使用 CSS/SVG 粒子，避免再生成含语义的 raster 帧。

## 明确不要做

- 不要把四张图当作完整弹窗或可点击控件，也不要把它们裁成数字键帽。
- 不要给素材补上“已开启”“分析完成”“每日可花 ¥…”等文案后再当作通用资产。
- 不要把 master 当 CSS 背景拉伸到全屏；纸张和卡片应作为独立 `<img>` 并保留内边距。
- 不要在自由金尚未确认时显示金币徽章，也不要因为图片加载成功就改变 `fixedCapital` 状态。

## 文件

- [预览页](./index.html)
- [manifest](./manifest.json)
- master：`./illustrations/masters/`
- web derivative：`./illustrations/`

生成方式：built-in `image_gen`，四次独立生成；web derivative 仅做 RGBA 等比缩小。当前状态为 candidate，尚未接入生产代码。
