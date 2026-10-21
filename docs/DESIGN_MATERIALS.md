# 页面、组件与分类材质 · 2026-10-22

本轮不是插画展示页：素材用于真实可操作的组件，金额、文字、图标按钮语义与输入框仍为 DOM。主页继续优先快速记账，云朵主形象不改；自由金只从设置进入。

## 12 件页面与组件素材的实际去向

| 素材 | 应用位置 | 动作或作用 |
| --- | --- | --- |
| `journal-surfaces-v2/journal-paper.webp` | 全部页面背景、设置分组、导入卡片、账目行、主题预览 | 共享轻纸纹，通过主题色遮层控制对比度；静态底层不持续重绘 |
| `journal-surfaces-v2/sheet-paper.webp` | 账本总额、主题选项卡 | 纸页叠层，金额和文字不随装饰移动 |
| `pocket-materials-v2/pocket-open.webp` | 自由金入口和抽屉主视觉 | 稳定锚点，前袋层遮住进入袋内的钞票与硬币 |
| `cash-note.webp` | 自由金收入行、入袋动作 | 图片 decode 后开始，单次滑入袋口 |
| `coin.webp` | 自由金入袋动作 | 跟随钞票落袋，轻微后续动作，不使用持续粒子 |
| `reserve-envelope.webp` | 自由金预留行/袋旁、设置账号入口 | 低噪声纸信封图形，设置行按下时随内部内容回应 |
| `ledger-book.webp` | 设置圈子入口、导入完成卡片 | 语义与账本对应，卡片整张进入，不使用逐字输出 |
| `receipt-stack.webp` | 快速整理入口、选择文件、导入待复核状态、自由金固定开销 | 小票轻落一次，与真实文件操作对应 |
| `calendar.webp` | 固定支出入口、自由金发薪日 | 无烘焙日期，实时日期由组件文字显示 |
| `paperclip.webp` | 文件预览、已附上的小票 | 落后小票 70ms 轻扣上，不用扫描光线 |
| `key-cap.webp` | 数字键盘内部按键帽 | 真实纸质底片随原有 100ms 按压 / 160ms 回弹移动，按钮命中框不变 |
| `pill-tab.webp` | 底部菜单选中滑块 | 与原 TelegramUI 选中滑块一起平滑移动 |

原图、提示词、来源及 SHA 位于两个素材目录的 `manifest.json` / `generation.json`。实际原图不是占位 SVG，生产构建只引用 WebP。旧自由金球体/气泡/闪光不再被组件导入，旧文件留作历史追溯。

## 组件契约

- `JournalMaterial.jsx` 统一为装饰 `img`，固定尺寸、空 alt、`aria-hidden`、`pointer-events:none`，不占用额外可点击层。不能把金额或文案烘焙进图片。
- `journal-materials.css` 负责材质、有限退出、纸质附件动作；`secondary-motion.css` 负责分类、设置行、主题及右滑动作反馈；其后的 `type-system.css` 统一文字层级和分类图尺寸。
- `Sheet` 普通关闭为 160ms，退出期间 inert；从当前绘制帧开始，关闭锁只允许一次回调。外部切页/切账本可立即卸载，清除计时器和动画。
- `NoteEntrySheet` 使用 `managedExit={false}`，继续独立 160ms 关闭，不能再叠加一个退出延迟，否则现金飞行会错位。
- 自由金日额度由 `fixed-capital.mjs` 确定计算；网络分析可选，不阻止保存。输入保留、保存重试、关闭/换账本时的过期响应隔离由 `free-money-plan.mjs` 的请求 gate 管理。
- 反复操作使用可中断过渡，触摸按压与硬件键盘分离。用户明确取消减少动态规则，不得因技能默认建议将其恢复。

## 验收与复现

按顺序运行浏览器脚本，不并发启动多个 Vite 测试：

```powershell
npm test
npm run build
node tests/material-system.browser.cjs
node tests/category-materials.browser.cjs
node tests/free-money.browser.cjs
node tests/keypad-layout.browser.cjs
node tests/keypad-interaction.browser.cjs
node tests/note-submit.browser.cjs
node tests/category-pills.browser.cjs
node tests/circle-reactions.browser.cjs
```

测试使用独立本地数据或明确的服务 fixture，不会把测试账目写入线上。`outputs/` 是本机验收输出、没有纳入 Git。最终结果见 [本轮计划](../plans/2026-10-22-motion-refresh.md)；真实手机的 60/120Hz 帧率不能由桌面无头浏览器功能通过推断。

## 36 件分类素材扩展

新目录 `public/assets/category-art-v1/` 包含全部 30 个消费分类及 6 个收入分类。每件独立生成，PNG 为保留原件，160px WebP 用于界面；三份分组 manifest 保留完整提示词、来源、透明背景检查和 SHA。

| 表面 | 接入方式 | 排版约束 |
| --- | --- | --- |
| 首页分类胶囊 | 28px 实图 + 原有标签 | 保持一行；最先可见的六项优先加载，其余懒加载 |
| 账目列表 | 36px 实图替代预设线条图 | 同一行保留金额、成员、时间与更多按钮 |
| 分类管理 | 32px 实图，编辑图标时可回到原自选图标 | 不修改存储结构及分类 ID |
| 修改账目 | 28px 实图置于分类选择器内部 | 标签与选择器保留语义；输入字号 16px |
| 导入预览 | 30px 实图辅助对应已解析分类 | 类别不明仍显示行号；文字及金额仍为真实 DOM |

`CategoryArt` 的匹配依赖预设 ID、原图标及原色同时满足；改过的图标或颜色不替换，历史账目的图片依赖其历史分类快照。网络加载失败会恢复原线条图标，按钮仍可点。

统一的尺寸、字体、间距、主题和操作约束见 [UI_SYSTEM](UI_SYSTEM.md)，本轮进度与最终验证见 [分类素材与排版计划](../plans/2026-10-22-category-materials.md)。
