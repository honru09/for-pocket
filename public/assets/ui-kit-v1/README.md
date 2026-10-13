# for. 界面素材包 v1 / v2 状态扩展

2026-10-13 生成。状态：**素材已生成并检查，未接入产品页面，未部署**。

范围：保留现有小黄云、奶油纸色、鼠尾草绿和圆端线性图标；不替换 Logo、首页互动云朵、确认按钮动画或天气图集。v2 只增加可选状态、操作和个性化元素，不改变业务状态机。

## 文件

- `index.html`：可独立打开的素材册；图标支持四种现有主题预览。
- `illustrations/`：7 张 1536 × 1024 PNG，内置 image_gen 生成，保留原始质量及来源信息。
- `icons/`：36 枚独立 SVG，24 × 24、1.6px 描边、圆角端点，无文字；包含状态、按钮和个性化三组。
- `pocket-ui-icons.svg`：同一组图标的 symbol 精灵图，用 currentColor 随主题着色。
- `frames/`：状态卡、插画容器、头像环 3 个可下载 SVG 框架。
- `ui-components.css`：未接入的按钮、状态卡、状态 pill、分段控制、头像框样式；使用语义 token，可复制到正式组件后再按现有 CSS 约束调整。
- `preview-v2.html`：新增素材的独立预览，含按钮/卡片/头像框交互示意。
- `manifest.json`：用途、状态条件、禁止场景、建议展示尺寸及目标组件。
- `copy.zh-en-uk.json`：中文、英文、乌克兰语文案建议；不覆盖现有 i18n。乌克兰语上线前需母语复核。
- `prompts.json`：4 个完整生成提示词和生成方式；不含账本、凭据或用户个人信息。

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
| offline-draft | 保存状态说明／恢复页 | 本机写入已验证、服务端未确认 | “已同步”“云端已备份”文案旁 |
| partial-import | 导入结果说明 | 部分候选需人工核对 | 已保存成功页、自动丢弃文件提示 |
| location-privacy | 位置权限说明 | 未授予、主动关闭或暂无地点 | 真实地图、成员地点详情、已授权承诺 |

状态图标新增：`storage-read-failed`、`import-no-result`、`file-warning`、`recap-empty`、`recurring-empty`、`recurring-due`、`link-expired`、`location-no-place`；操作图标新增 `button-*`；个性化新增 `avatar-*`。图标只能配合可读文字和真实状态使用。

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
- 插画是原始母版，不建议原尺寸直接进入每次打开的记账首屏。按实际显示尺寸生成投放版本，二级页懒加载；无需一次预载四张。
- v2 新增插画仍是原始母版；按实际显示尺寸生成投放版本，二级页懒加载；不要一次预载全部七张。
- 未对原图做无授权的重画、抠图或转换。没有把图片工具的默认目录当作项目资源路径。
- 不给这批素材增加循环漂浮、滚动视差或庆祝动效。小黄云已有互动，不需要第二套抢占注意力的动画。
- `ui-components.css` 的按钮只包含短促的 transform/opacity 反馈，并提供 reduced-motion 分支；不要把卡片、头像框或状态图标改成循环动画。
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
