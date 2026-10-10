# for. Pocket 部署与交接 · v0.5.0

更新：2026-10-10。旧计划中的 React 19、固定 Liia/Xingrun、先加好友再建四人圈等说明已废弃。以当前实现与用户最新要求为准。

## 发布状态与用户决定

**用户决定：保持 Render 免费实例，暂不部署。** 发布代码放在 `release/v0.5.0`，通过草稿 PR 审阅；不要合并到 `main`。Render 目前跟踪 `main` 并自动部署。

2026-10-10 通过 Render API 实际核对：

| 项目 | 当前线上状态 |
| --- | --- |
| 服务 | `srv-db4i2cij9qps73clbbo0` / for-pocket |
| 地址 | https://for-pocket.onrender.com |
| 仓库 / 分支 | honru09/for-pocket / main |
| 实例 | free，自动部署 yes |
| 数据目录 | `./data`，没有持久盘 |
| Telegram | BOT_TOKEN 已配置；菜单检查结果见 VERIFICATION.md |
| Google | GOOGLE_CLIENT_ID 未配置 |
| 应用版本 | 旧版；v0.5.0 尚未部署 |

免费服务的临时文件系统会在重启、部署时清空。API 密钥不能使临时盘持久化。不要先部署再补备份；目前没有取得现有线上账单的完整备份。[Render 持久盘说明](https://render.com/docs/disks)

## 已完成的产品实现

- 快速记账首页：大金额、用途、保存；账号与圈子放二级页。
- React 18.3.1、Vite 8.3.4、TelegramUI 2.1.13，延续纸色、小黄云和短促柔和动效。
- 默认 JPY，中、英、乌克兰语；支出和收入独立分类，分类可编辑。
- 使用真实用户；个人账本默认本人，共享账本显示成员。昵称、头像、颜色可编辑。
- 补记发生时间、修改旧账时间；历史归组与排序使用 occurredAt，保留 createdAt。
- 清除输入框硬边聚焦方框；默认头像与账本 SVG 箭头已修正。
- 官方 Google ID token 服务端验证、Telegram initData 校验、统一会话与退出撤销。
- Google / Telegram 连携预览与确认；原子合并账单、分类、身份、圈子。
- Life360 圈子关系：72 小时邀请码、预览接受、多圈、多管理员、退出交接、99 人上限。没有固定四人或先加好友限制。
- 圈内作者可修改时间、删除自己的账；管理员可管理圈内账。个人与各圈账本隔离，退出后立即失去权限。
- 原子 JSON 事务、旧版迁移、真实 PNG 图标、有效 manifest、按账本保留草稿、前台每 3 秒刷新。

详见 [升级说明](docs/UPGRADE-v0.5.md) 与 [验证记录](VERIFICATION.md)。本产品对齐 Life360 的圈子组织；未添加定位、驾驶监控或订阅系统。

## 本地启动与验证

Node.js 22.12+；CI 使用 Node.js 24。

```powershell
npm ci
npm run build
npm test
npm run start:prod
```

打开 http://127.0.0.1:8787/ 。`npm start` 会先构建；`start:prod` 使用已构建产物。运维测试校验真实构建资源，所以先构建再测试。

未登录的浏览器记录保存在当前设备。服务器登录后使用服务器账本；本机记录不会自动上传。Google 测试使用隔离 fixture，不能替代真实 OAuth 验收。

## 已补齐的发布工具

| 文件 / 命令 | 用途 |
| --- | --- |
| `.github/workflows/ci.yml` | Linux 和 Windows，Node 24，安装、构建、11 项测试；Actions 固定到 commit SHA |
| `render.yaml` | 可选付费单实例 + 1GB 持久盘蓝图；当前未应用 |
| `npm run render:inspect` | 只读核对仓库、分支、认证配置及 DATA_DIR 所在持久盘；不打印密钥 |
| `npm run backup` | JSON 副本、SHA256 清单；不修改源数据 |
| `npm run restore -- BACKUP_DIRECTORY EMPTY_DATA_DIRECTORY` | 校验所有备份文件后恢复；拒绝覆盖非空目录 |
| `npm run bot:configure` | 只读检查 bot、菜单及 webhook；不启动轮询 |
| `npm run bot:configure -- --apply` | 确认 bot 后设置“＋ 记一笔”菜单；不改 webhook、不发聊天消息 |
| `npm run verify:deployment -- URL --version=0.5.0 --commit=SHA` | 检查实际版本、commit、JS/CSS、manifest、PNG 尺寸 |

备份含用户资料、账单和会话，只存私有目录。`.env`、`.env.*`、`data/`、`backups/`、日志不进入 GitHub 或 zip；`.env.example` 是空配置模板。

## 将来正式部署的顺序

在用户重新授权部署、确认存储方案后再执行：

1. **先取得并验证当前线上数据备份。** 本机备份不能代替线上备份。免费 Render 没有 Shell/SSH，添加持久盘也会触发部署，不能指望升级后再读取旧容器数据。[Shell 支持范围](https://render.com/docs/ssh)
2. 用户可选择付费持久盘，或先实现外部持久数据库。`render.yaml` 是准备好的付费方案，未开通、未购买。当前代码只有单进程 JSON 存储，不支持直接配置 PostgreSQL。
3. 暂停自动部署，确保修改基础设施不会意外部署未保护的数据。备份恢复到持久目录后，设置 `DATA_DIR=/var/data`。
4. 只在私有配置中设置 `BOT_TOKEN`、`PUBLIC_URL`，Google 登录需要 Web Client ID；保留已有 bot token。
5. 运行 `render:inspect` 确认 DATA_DIR 实际在持久盘挂载路径下，单实例部署；不要将 API key 配置到前端。
6. GitHub 两个平台 CI 通过后，审阅 PR；在部署重新获得授权后合并 main 或手动发布确切 commit。
7. 用健康接口的 version/commit 验证实际产物，而非仅看 `{ok:true}`。
8. Telegram 中真实登录、记账、修改时间、重开检查；第二位用户验证圈子权限。完成真实 Google 登录与连携后才能标记 OAuth 验收通过。
9. 确认账单数量与备份一致，重启后仍保留；之后按需要配置自动部署。

```powershell
npm run verify:deployment -- https://for-pocket.onrender.com --version=0.5.0 --commit=RELEASE_SHA --require-telegram --require-google
```

没有 Google 配置时，不应声称其已上线可用；不要为了通过验收随意填入一个 Client ID。

## Telegram 入口

机器人 `@for_pocket_bot`；菜单目标为 https://for-pocket.onrender.com 。Web 服务器启动不自动设置菜单。`bot.mjs` 是单独的 `/start` 轮询进程，有 webhook 时会停止，避免覆盖现有服务。

`https://t.me/for_pocket_bot/app` 仅在 BotFather 已创建对应 short name 时有效；API 菜单检查不能证明该直达链接已配置。需 bot 所有人在 BotFather 核对。[Telegram 官方接口](https://core.telegram.org/bots/api#setchatmenubutton)

## Google 登录还需要的配置

创建 OAuth **Web application** Client ID；授权 JavaScript origins：

- `https://for-pocket.onrender.com`
- `http://127.0.0.1:8787`（本机 API/静态站点）
- `http://localhost:5173` 或实际使用的 Vite origin（如需开发登录）

设置 `GOOGLE_CLIENT_ID`，无需向本产品提供 Google client secret。[Google 官方设置说明](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid)

## 运维边界

- 存储只支持单 Node 进程；多实例必须先换共享数据库。
- v2 数据文件为 `_pocket-v2.json`，旧 JSON 保留；旧会话作废，需要重新登录。
- 恢复时先停止应用，使用新空目录。中途 I/O 失败时不要启动部分恢复目录，应重新恢复到另一空目录。
- 动效尊重减少动态效果设置；未测量或承诺所有设备达到 120fps。
- 本轮 Windows Computer Use 因不能可靠识别浏览器 URL 而停止；后续发布准备通过 CLI/API 完成，没有自动化登录 Google Cloud。
