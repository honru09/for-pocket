# for. Pocket · Google Cloud 与本地交接

更新：2026-10-10。正式平台已切换 Google Cloud Run；Render 资料仅作历史归档，不再用于部署。

## 当前项目与线上

| 项目 | 状态 |
| --- | --- |
| 本地根目录 | D:\Projects\Tools\for-pocket |
| GitHub | https://github.com/honru09/for-pocket |
| 当前生产地址 | https://for-pocket-698348906987.asia-northeast1.run.app |
| Cloud Run 服务 / 区域 | for-pocket / asia-northeast1 |
| 线上版本 | API 实查 v0.5.0；Google 与 Telegram 配置均存在 |
| 本次改动 | 本地小方形确认按钮与布局调整，尚未发布云端 |

## 完整迁移

- 原项目 3,879 个文件（含 Git、.env、node_modules、构建、源码与文档）逐一校验文件长度和 SHA256 后迁到 D 盘。
- 原 work 目录的 35 个文件与验证目录、旧截图、zip、发布记录也已迁入新项目的 work/、outputs/。
- C 盘原项目文件全部移除；原 for-pocket 空目录被其他进程占用，目录空壳不含代码、配置或数据。
- 本地运行、打包、许可证与浏览器检查脚本的项目路径已改为 D 盘；全局 Node/Codex/技能安装仍在原位置。
- work/、outputs/、.env、data/、backups/ 被 Git 和 Docker 排除；历史资料不是当前运行依赖。

## 本地使用

需要 Node.js 22.12+，CI 使用 Node.js 24。

```powershell
cd D:\Projects\Tools\for-pocket
npm ci
npm run build
npm test
npm run start:prod
```

本地预览：http://127.0.0.1:8787/ 。npm start 会先构建，start:prod 使用已有构建。原浏览器本机记录保存在同一 origin 的 localStorage，迁移目录不会改变 origin；未自动刷新用户的草稿页面。

## 记账页调整

金额仍为主视觉。今日支出和小账本移到金额上方的轻量一行。备注与成员选择之后，最下面是一个 52×52px、16px 圆角的确认方格，只有勾选图标。

保留 TelegramUI、按压反馈、加载与禁用态、多语 aria-label/title、键盘 Enter 保存与减少动态效果设置。移动端去掉金额面板中重复的用途文字，保留分类选中态；分类触控与数字键仍有足够面积。同步状态在确认键同一行，不再占其下方。

## Cloud Run 发布配置

Dockerfile 提供构建与生产运行镜像。容器以 node 用户运行，HOST=0.0.0.0，PORT=8080；Cloud Run 会注入 PORT。

环境：BOT_TOKEN、PUBLIC_URL、GOOGLE_CLIENT_ID、DATA_DIR。真实凭据只设置在私有环境或 Secret Manager，不进入 GitHub、Docker build context 或交付包。Google 授权 JavaScript origin 使用生产域名；本地登录如需使用，再添加实际本机 origin。

健康与 config 接口包含 version、可选 APP_COMMIT、Cloud Run 注入的 K_REVISION。当前线上旧镜像未提供 commit/revision，不应把版本号相同视为代码已更新。

默认上线检查已切换 Google Cloud 地址：

```powershell
npm run verify:deployment -- --require-google --require-telegram
# 配置 APP_COMMIT 后再增加 --commit=RELEASE_SHA
```

本次只迁移本地项目和调整 UI，没有修改 Cloud Run 资源、流量、账单或 bot webhook。上线应确认源码触发器跟踪的分支，再推送或手动构建确切 commit。

## 数据与账号

当前仍为单进程原子 JSON 存储：DATA_DIR/_pocket-v2.json，旧文件迁移保留，浏览器预览与已登录服务器账本独立。Google 使用官方服务端 verifyIdToken；Telegram 使用 initData；连携需预览与明确确认。

**创建 /data 目录不能提供 Cloud Run 持久化。** 容器停止后未挂载外部存储的数据会消失；单实例配置只能减少副本分歧，不能解决持久化。截图中的旧修订版没有卷，当前修订版的实际持久方案尚未核实。后续发布前应确认外部存储及真实线上数据备份。[Google 容器文件系统说明](https://cloud.google.com/run/docs/container-contract#file_system)

```powershell
npm run backup
# 先停止应用，恢复到新空目录
npm run restore -- BACKUP_DIRECTORY EMPTY_DATA_DIRECTORY
```

备份、账号和会话资料只能放私有目录。本机备份不能代替云端备份。

## 验证与历史

- D 盘 npm run build 和 11/11 API/运维测试通过。
- 浏览器检查 320、390、600、768、1280px，验证确认按钮为方形、今日摘要位于金额上方、底部顺序正确、保存/重载/账本/键盘可用、无横向溢出与 pageerror。
- 当前线上 Google/Telegram 配置通过公开 API 检查；没有操作真实账号，也没有把 fixture 结果当作真实 OAuth 验收。
- 详细验证见 VERIFICATION.md；旧 Render 蓝图、审计工具和交接记录位于 docs/archive/，不再有活动 Render npm 命令。
