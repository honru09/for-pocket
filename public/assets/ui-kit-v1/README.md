# for. 界面素材包 v1 / v2 状态扩展

2026-10-13 生成。2026-10-14 状态：**七张状态插画已按实际场景接入产品；图集、框架按用途保留为设计参考**。发布状态以 Cloud Run 的 commit 为准。

范围：保留现有小黄云、奶油纸色、鼠尾草绿和圆端线性图标；不替换 Logo、首页互动云朵、确认按钮动画或天气图集。v2 只增加可选状态、操作和个性化元素，不改变业务状态机。

## 文件

- `index.html`：可独立打开的素材册；图标支持四种现有主题预览。
- `illustrations/`：7 张 1536 × 1024 PNG，内置 image_gen 生成，保留原始质量及来源信息。
- `icons/`：36 枚独立 SVG，24 × 24、1.6px 描边、圆角端点，无文字；包含状态、按钮和个性化三组。
- `pocket-ui-icons.svg`：同一组图标的 symbol 精灵图，用 currentColor 随主题着色。
- `frames/`：状态卡、插画容器、头像环 3 个可下载 SVG 框架。
- `rasters/`：9 张真透明 RGBA 拟物图集：主操作按钮、个性化头像徽章、状态卡框架、空态与同步状态，以及响应式数字键盘表面、两组原始 8 帧按压／回弹母版和两组清理注册版。前三张原有操作图集为 2172 × 724 横向 atlas；空态图集为 1536 × 1024 的 3×2 网格；键盘表面为 1536 × 1024 的 3×4 网格（单格 512×256，即 2:1；真实键帽对象约 1.88–2.46:1）；动作图集为 2172 × 724 的 4×2 帧网格（单格 543×362），v3 统一为 512px 内容宽度并清理分散透明噪点。v3 是确定性后处理结果，不是重新生成。
- `ui-components.css`：未接入的按钮、状态卡、状态 pill、分段控制、头像框样式；使用语义 token，可复制到正式组件后再按现有 CSS 约束调整。
- `preview-v2.html`：新增素材的独立预览，含按钮/卡片/头像框交互示意。
- `manifest.json`：用途、状态条件、禁止场景、建议展示尺寸及目标组件。
- `copy.zh-en-uk.json`：中文、英文、乌克兰语文案建议；不覆盖现有 i18n。乌克兰语上线前需母语复核。
- `prompts.json`：插画与拟物图集的完整生成提示词和生成方式；不含账本、凭据或用户个人信息。

## 场景对应

| 素材 | 建议位置 | 触发条件 | 不该出现的位置 |
| --- | --- | --- | --- |
| empty-ledger | App 小账本 empty-state | 真正零记录且无筛选 | 筛选无结果、错误、加载中 |
| import-review | AiImportPage 导入说明／待核对 | 解析结果仍未写入 | 已入账成功提示 |
| shared-circle | CirclesPage 空圈子／邀请说明 | 需要解释共享关系 | 替代真实成员或共享权限说明 |
| pending-retry | 失败恢复说明 | 服务端未确认写入 | 每笔成功弹窗、无条件“已安全保存” |

## v2 新增状态

| 素材 | 建议位置 | 触发条件 | 不该出现的位置 |
| --- | --- | --- | --- |
| offline-draft | 账号页本机记录模式说明 | 当前使用本浏览器账本 | 未确认写入“已安全保留”、“已同步”或“云端已备份”文案旁 |
| partial-import | 导入结果说明 | 部分候选需人工核对 | 已保存成功页、自动丢弃文件提示 |
| location-privacy | 位置权限说明 | 未启用且没有地点标签 | 已启用后的临时无地点、真实地图、已授权承诺 |

`pending-retry` 仅在账号页当前账本有失败写入时显示，并沿用原记录重试动作。账本读取失败仍用 `storage-read-failed` 图标，不混淆读取和写入状态。圈子插画只出现在空圈子，首页不请求这些插画。

状态图标新增：`storage-read-failed`、`import-no-result`、`file-warning`、`recap-empty`、`recurring-empty`、`recurring-due`、`link-expired`、`location-no-place`；操作图标新增 `button-*`；个性化新增 `avatar-*`。图标只能配合可读文字和真实状态使用。

拟物 PNG 图集新增：`neumorphic-button-atlas-v2.png`（保存／重试／新增／位置）、`neumorphic-avatar-badges-v2.png`（8 枚装饰徽章）、`neumorphic-state-card-frames-v2.png`（4 枚留白状态卡）、`neumorphic-empty-state-atlas-v2.png`（空账本／筛选无结果／导入无结果／文件需更换／连携过期／暂无位置）。四张均已验证为 RGBA 真透明背景；不要把图集里的暖黄环或暖黄点当作业务成功状态，也不要在图片里写入金额、地址、成员名或同步承诺。

数字键盘素材新增：`neumorphic-keypad-surface-atlas-v2.png`（3×4 横向空白键帽表面）、`neumorphic-keypad-motion-numeric-v2.png`（数字键 8 帧）和 `neumorphic-keypad-motion-utility-v2.png`（动态 C/. 与退格等功能键 8 帧）。三张均标记为 **visual reference only**：不是固定尺寸按钮，也不是可直接拉伸的 CSS background。当前首页真实键盘为 3 列，键帽宽度由容器和 gap 计算，数字及动态 `C/.`、退格图标必须继续由 HTML/SVG 渲染。

### 数字键盘响应式使用约定

- **桌面**：核心按键高度约 54–60px，圆角约 15–17px。
- **移动端**：按键高度至少 44px；在较高可用视口中由网格剩余空间自然扩展到约 84–95px，圆角约 13px。
- **紧凑高度**：当前生产 CSS 仍保持至少 44px，圆角约 12–13px；40px 仅是历史实验台下限。
- 三种尺寸只改变真实 CSS 容器、`grid-template-columns: repeat(3, minmax(0, 1fr))`、gap、圆角和阴影强度；不要按 atlas 的像素格固定按钮宽高，也不要把 atlas 直接作为 CSS background。
- surface atlas 的单格是 2:1 的网格容器，真实键帽对象约 1.88–2.46:1；这些比例只用于视觉比例验收，不是生产尺寸契约。若用于设计评审，裁切单格后以 `<img>`／遮罩参考，再由真实键帽 DOM 绘制可伸缩表面，内容层叠加实时数字和无障碍名称。
- 8 帧顺序固定为 `rest → hover → touch → press-deep → hold → release → rebound → settle`。实际产品优先用 CSS `transform`、`box-shadow` 和 opacity 做连续插值；帧图仅用于视觉验收、故事板或需要逐帧导出的场景。
- 当前交互按用户要求保留完整云朵与按钮动效；物理键盘的即时反馈与输入源隔离是独立交互规则，不与系统动效偏好混写。

空账本与筛选无结果应分开：后者使用 `empty-filter` 小图标及清除筛选动作。邀请预览不能用插画遮盖共享范围，尤其需先解决本次审核指出的成员位置及退出后消息更新问题。

## 正式接入方式

`vite.config.mjs` 当前为 `publicDir: false`，生产 `server.mjs` 也只放行 `dist/assets` 下带文件名的资源。**不要**直接引用 `/assets/ui-kit-v1/...`，它不会自然成为线上可访问路径。

在 `src/` 中导入，让 Vite 输出哈希资源：

```jsx
import emptyLedgerUrl from '../public/assets/ui-kit-v1/illustrations/empty-ledger.png';
import iconSpriteUrl from '../public/assets/ui-kit-v1/pocket-ui-icons.svg';

// 下方已有真实标题及说明时，插画是装饰，alt 为空。
<img src={emptyLedgerUrl} alt="" width="1536" height="1024"
  loading="lazy" decoding="async"
  style={{ width: 'min(240px, 100%)', height: 'auto' }} />

// 实际文字由现有三语 t() 提供；示例不是新的业务状态机。
<span>
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
    <use href={`${iconSpriteUrl}#sync-pending`} />
  </svg>
  保存尚未确认
</span>
```

独立 SVG 默认墨绿色；需要跟随主题时用 symbol 或将 path 纳入现有 `Icon` 映射。不要用 CSS filter 给状态重新染色；不要让图标脱离文字独自表达结果。

## 图像与性能约束

- PNG 为不透明暖奶油底，不是透明抠图。模型生成的底色带细微纸纹，并非每个像素都是 #f8f7f1。
- 上述 `rasters/` PNG 图集是例外：它们是真透明 RGBA，可叠在现有奶油背景上；保留软阴影但不要再套一层强阴影。
- 插画是原始母版，不建议原尺寸直接进入每次打开的记账首屏。按实际显示尺寸生成投放版本，二级页懒加载；无需一次预载四张。
- v2 新增插画仍是原始母版；按实际显示尺寸生成投放版本，二级页懒加载；不要一次预载全部七张。
- 未对原图做无授权的重画、抠图或转换。没有把图片工具的默认目录当作项目资源路径。
- 不给这批素材增加循环漂浮、滚动视差或庆祝动效。小黄云已有互动，不需要第二套抢占注意力的动画。
- `ui-components.css` 的按钮只包含短促的 transform/opacity 反馈；不要把卡片、头像框或状态图标改成循环动画。
- 尺寸、金额、权限、记账结果和错误原因都保留为 HTML 文本，不烘焙到图片。
- “已保留在本机”只在 localStorage 写入并验证成功后使用。网络请求失败不必然等于未入账；使用原 ID 重试以维持幂等。
- 转账／报销往来图标保持中性，不能画成收入增长；维持现有日常收支统计排除逻辑。

## 验证与预览

从项目根目录运行：

```powershell
node scripts/verify-ui-kit.mjs
node scripts/preview-ui-kit.mjs
```

预览地址为 http://127.0.0.1:8926 ，打开 `/index.html` 查看 v1，打开 `/preview-v2.html` 查看新增状态、按钮、框架和头像元素。服务只读取这一素材目录，不启动 Telegram、AI 或业务服务。Ctrl+C 停止。也可直接打开这些 HTML，它们不依赖外部字体、库或 API。

配色、边距、按钮焦点和图标主题按当前产品方向设计；新增内容受 Impeccable 的 Operate 原则约束：服务任务，不占据金额和键盘的空间。

## 2026-10-14 本地接入记录

- 空账本：`LedgerEmptyState` 在读取成功、无账目且没有分类/币种筛选时使用 `empty-ledger`；加载、读取失败、筛选空结果各有自己的状态。宽度 220px，短屏 144px。
- 导入结果：`AiImportPage` 只在有待核对记录时显示 `import-review`；有缺漏/低可信度/警告则用 `partial-import`，均为顶部 84px 小插画。未保存前不会表达已入账。
- `empty-filter` 与 `storage-read-failed` 的路径并入现有 `Icon`，保留 currentColor；没有第二套图标 API。
- 三图通过源代码 import 生成带哈希 URL，按出现状态懒加载；首页不会下载这些插画。本轮沿用原始 PNG（每张约 1.19–1.95 MB），尚未制作压缩投放派生图。
- 其余插画、装饰框与键帽 atlas 留在素材库。键帽 atlas 为视觉参考；实际可变宽高按钮使用 DOM 字面与连续 CSS 按压，不以固定图片拉伸。
