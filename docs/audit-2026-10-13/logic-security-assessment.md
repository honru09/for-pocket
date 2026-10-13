# 后端、领域逻辑与安全审计

日期：2026-10-13。审计基准 HEAD：`27a8d73b559ef1a5e1519c3fba4987c8a2546532`。

本次为当前实现审计，不是相对某个提交的 diff review。仅新增报告和隔离复现脚本；未修复应用、未部署、未发送真实 Telegram 消息、未读取 `.env` / 凭据 / 生产账本。审计期间其他任务正在修改前端及位置相关源码，已保留其修改；下列后端发现以文末指纹对应的源码为准，最初全量测试结果不代表后续并发修改已验收。

结论：发现 **1 项 P1、4 项 P2 已复现问题**；没有确认 P0。另有必须核实的 Cloud Run 持久化/多实例风险，以及 P3 依赖与说明文档维护项。真实 Google 登录、Telegram 平台送达、Vertex 识别质量及线上存储未验收。

## 已验证发现

| ID | 优先级 | 现象 | 证据等级 |
| --- | --- | --- | --- |
| L01 | P1 | 被移除成员仍收到 Telegram 旧账单卡的新金额/备注 | 实际本地 HTTP + 模拟 Telegram，稳定复现 |
| L02 | P2 | 未加入圈子的邀请预览泄露成员新鲜地点标签与地址 | 实际本地 HTTP，稳定复现 |
| L03 | P2 | Telegram 记账使用进程默认时区，忽略已同步的账户/账本时区 | 实际解析器/handler + 固定模型输出，稳定复现 |
| L04 | P2 | AI 有损标准化没有强制复核：金额舍入、未知分摊人消失 | 实际解析器；金额案例通过实际自动入账路径 |
| L05 | P2 | 网页账单通知早于持久化；写盘失败仍已发送“已记账”卡 | 实际 HTTP + 隔离磁盘故障注入，稳定复现 |

### L01 — 被移除成员仍接收账单后续修改（P1）

定位：[telegram-expense-sync.mjs:170](D:/Projects/Tools/for-pocket/telegram-expense-sync.mjs:170)、[telegram-expense-sync.mjs:188](D:/Projects/Tools/for-pocket/telegram-expense-sync.mjs:188)。HTTP 调用点：[server.mjs:358](D:/Projects/Tools/for-pocket/server.mjs:358)。移除成员逻辑：[domain.mjs:247](D:/Projects/Tools/for-pocket/domain.mjs:247)。

触发：A、B 同圈 → A 保存账单，B 收到 companion card → 管理员通过 `POST /api/circles/remove` 移除 B → A 通过 `PATCH /api/expenses/:id` 修改金额或备注。

实际结果：B 的 `/api/profile` 不再包含 A 的该账单，`POST /api/circles/switch` 返回 403，说明网页授权撤销有效；但修改请求返回 200 后，通知模块仍对历史 `expenseMessages` 绑定执行 `editMessageText`，向 B 推送刚修改的私人信息。复现输出包含：

```text
webStatus: 403, webRecordVisible: false, editStatus: 200
chat_id: 202
text: Fixture 101 spent ¥999 JPY · 胃 · New private note after removal
```

根因：`sync()` 遍历历史消息绑定，没有重新验证绑定用户当前是否仍为源圈成员，也没有验证该私聊仍对应当前身份。不是旧网页缓存，也不是圈子移除失败；本地 HTTP 用例明确验证了这两个对照条件。

影响：原成员无需绕过认证，即可被动获得离圈后产生的新金额/备注。这不是“无法撤回其以前已经看过的历史信息”，而是新的信息继续被发送。

建议：每次 edit/notify 前重新解析当前圈成员及 Telegram 身份绑定；失效绑定不发送新内容。移除/离圈时清理或失效化绑定；若需要删除旧卡，应将“不泄露新信息的清理”与“同步新内容”分开。发送前也应处理成员变更与异步发送之间的竞态。

验收：保留 HTTP 回归；覆盖自行离圈、管理员移除、账号合并后身份变化、发送排队期间离圈。所有被撤销成员不得收到后续新内容，仍在圈内的成员正常更新。

### L02 — 邀请预览包含成员当前地点（P2）

定位：[domain.mjs:52](D:/Projects/Tools/for-pocket/domain.mjs:52)、[domain.mjs:224](D:/Projects/Tools/for-pocket/domain.mjs:224)、[circle-presence.mjs:16](D:/Projects/Tools/for-pocket/circle-presence.mjs:16)。

触发：圈内成员有最近一小时内的 presence；第三个已登录用户持有效邀请码，调用 `POST /api/circles/preview`，尚未确认加入。

实际结果：HTTP 200、`alreadyMember:false`，同时返回成员的 `location.name`、`address`、`countryCode`。示例为 `Fixture appointment / Fixture street 42`。此路径不返回经纬度，因此不能把它描述为 GPS 坐标泄漏；但场所名和完整地址仍可暴露所在地。

根因：预览复用完整成员视图 `viewCircle()`；该视图加入地点信息时只检查地点主人仍在圈内，没有检查请求者已经加入。

影响范围：需要有效邀请码和有效账户，不是匿名任意读取。邀请码可被转发，且默认有效 72 小时，地点不应成为“决定是否加入”预览的附带内容。

建议：独立的邀请预览 DTO 仅暴露圈名、人数、加入所需的最低限度成员信息；presence 仅对已确认成员返回。若产品明确要求预览地点，必须有独立明确告知与同意，不能由普通邀请码隐含授权。

### L03 — Telegram 记账忽略账户时区（P2）

定位：[telegram-ai.mjs:816](D:/Projects/Tools/for-pocket/telegram-ai.mjs:816)，默认值 [telegram-ai.mjs:32](D:/Projects/Tools/for-pocket/telegram-ai.mjs:32)、[telegram-ai.mjs:354](D:/Projects/Tools/for-pocket/telegram-ai.mjs:354)。账户同步入口：[domain.mjs:181](D:/Projects/Tools/for-pocket/domain.mjs:181)。

触发：网页已同步 `Europe/Kyiv`（当前 Node/ICU 标准化为 `Europe/Kiev`），进程默认 `Asia/Tokyo`；用户在 Telegram 发送 `Lunch 100 JPY today at noon`。

实际结果：传入解析器的 `settings.timezone` 是 Kyiv，而 `input.timezone` 仍是 Tokyo；最终草稿写为 `2026-10-13T03:00:00.000Z / Asia/Tokyo`。该日 Kyiv 中午对应 09:00Z，相差六小时。跨日期边界时，“今天/昨天”也可能归错天。

根因：解析请求直接使用 handler 的单一 `timezone` 参数；同文件聊天分支在 [telegram-ai.mjs:1025](D:/Projects/Tools/for-pocket/telegram-ai.mjs:1025) 已使用 profile 时区，两个入口行为不一致。

建议：明确“发送者个人时区”和“共享账本统计时区”的产品规则，然后把已验证的发送者/当前上下文时区传入解析请求；进程默认值仅作兜底。不要从语言或单一国家推断跨时区用户的钟表时间。

验收：东京、Kyiv、美国时区、半小时/四十五分钟时区、DST 切换、跨午夜延迟 webhook；同一用户网页与 Telegram 的时间解释一致。

### L04 — AI 有损标准化没有强制复核（P2）

定位：[ai.mjs:87](D:/Projects/Tools/for-pocket/ai.mjs:87)、[ai.mjs:200](D:/Projects/Tools/for-pocket/ai.mjs:200)、[ai.mjs:215](D:/Projects/Tools/for-pocket/ai.mjs:215)、[ai.mjs:223](D:/Projects/Tools/for-pocket/ai.mjs:223)。自动确认门槛：[telegram-ai.mjs:844](D:/Projects/Tools/for-pocket/telegram-ai.mjs:844)。

两个用例是同一类问题：服务端改变了金额或分配含义，却没有把“发生有损修正”纳入 `needsReview`。

1. 金额：固定模型返回 `amount:100.5,currency:JPY,confidence:0.99,needsReview:false`，用户文本明确包含 `Lunch 100.5 JPY today at noon`。实际解析器将金额 `Math.round` 成 101；实际 Telegram handler 在自动模式下返回 `auto:true,kind:confirmed`，账本保存 `amountMinor:101`，未经过确认卡。不是单纯展示四舍五入，而是保存的金额发生变化。当前手工输入验证及地点数字路径均有更严格精度保护。
2. 分摊：圈内仅有 Owner、Partner，固定模型返回 `splitParticipants:['u_101','Unknown friend']`。实际解析器丢弃未知人后返回 `splitMode:'equal',splitParticipants:['u_101'],needsReview:false`。分摊对象减少，却没有明确要求用户重新选择。

上述只证明边界处理缺陷及自动保存风险，不声称真实 Vertex 每次都会生成这些结果，也不评价模型总体识别准确率。

建议：从十进制表示验证对应币种允许的精度；非零超额小数应拒绝或保留原值并强制复核，不能静默舍入。未知/被丢弃/重复的显式分摊成员应保留诊断信息并强制复核。提示词不能替代这类确定性的服务端约束。

验收：JPY/KRW 小数、USD/CNY 三位小数、合法 0.01/大额边界、有效/未知/已离圈分摊人；所有有损修正禁止 `/auto` 自动确认。

### L05 — 网页通知早于持久化成功（P2）

定位：[server.mjs:354](D:/Projects/Tools/for-pocket/server.mjs:354)、[server.mjs:167](D:/Projects/Tools/for-pocket/server.mjs:167)、[telegram-expense-sync.mjs:146](D:/Projects/Tools/for-pocket/telegram-expense-sync.mjs:146)。内存提交：[store.mjs:202](D:/Projects/Tools/for-pocket/store.mjs:202)。

触发：`asyncPersist:false`，圈成员已经绑定 Telegram；在独立临时目录里把快照目标换成空目录，使原子 rename 确定失败，再请求 `POST /api/expenses`。

实际结果：HTTP 返回 500 `errorSave`；最后一个完整磁盘快照账单数为 0；模拟 Telegram 已收到两次保存账单 `sendMessage`。命令输出：

```text
httpStatus: 500, error: errorSave, diskEntries: 0, notifications: 2
```

根因：领域内存提交之后先 `await expenseSync.notify()`，最后 `send()` 才执行成功响应前的 `store.flush()`。Telegram 输入路径已有 `beforeDeliver` 写盘门槛，但网页 companion sync 没有。store 写盘失败后还保留 dirty 内存状态，因此 HTTP 失败不等同于“操作已经回滚”；恢复后 flush 可能提交它，进程退出前未成功 flush 则可能丢失它。

影响：网络界面提示失败、圈成员却看到已保存消息；磁盘故障与进程终止组合下，聊天记录与账本事实不一致。此项需要写盘失败或突发中止，不应误报为正常请求必然丢数据。

建议：持久化领域事务/通知 outbox 后再发送外部消息；失败返回中明确可重试的不确定提交语义，继续复用原 ID。后续重试不应重复发卡。避免简单回滚整个当前内存快照，覆盖其他并发成功操作。

## 运维风险与维护项（未当作已发生事故）

### P1 条件风险：Cloud Run 存储与多实例

已确定的实现事实：Docker 设置 `DATA_DIR=/data`，仅创建目录；store 缓存在单进程内，queue 仅序列化本进程操作。见 [Dockerfile:21](D:/Projects/Tools/for-pocket/Dockerfile:21)、[Dockerfile:35](D:/Projects/Tools/for-pocket/Dockerfile:35)、[store.mjs:13](D:/Projects/Tools/for-pocket/store.mjs:13)、[store.mjs:194](D:/Projects/Tools/for-pocket/store.mjs:194)。

如果生产 `/data` 仍位于容器文件系统，实例终止会丢失文件；如果多实例各持自己的 JSON，会出现分叉；即使挂载同一共享目录，多进程也没有数据库事务/锁，仍可能互相覆盖。单实例限制只缩小并发问题，不提供持久化。Cloud Run 官方明确说明容器文件系统为内存文件系统且实例停止后不保留数据：[容器运行契约](https://docs.cloud.google.com/run/docs/container-contract#file_system)。

**未读取云项目配置，未验证当前生产卷、实例上限、revision 流量、账本备份。** 因而结论是发布前必须核实，不是宣称线上已丢失数据。交接文件也明确标注当前持久方案未核实。

发布门槛：取得当前 revision 的脱敏卷/存储及实例配置；完成一次真实备份校验、全新实例恢复演练；确认单写入者或迁移至具备事务的外部数据库；同步验证故障告警。不要为了审计直接重启生产服务测试数据是否还在。

### P3：依赖安全元数据需要维护，不等同于五个可远程利用漏洞

执行 `npm audit --json --ignore-scripts`：5 个 moderate 包节点，0 high、0 critical；对应两条 advisory 链：

| 链 | 当前版本 | 本次可达性检查 |
| --- | --- | --- |
| Vertex → gaxios → uuid | gaxios 6.7.1 / uuid 9.0.1 | 检查到 gaxios 调 `uuid.v4()`，advisory 所述边界问题针对 v3/v5/v6 的外部 buffer；未证实应用中可触发该路径 |
| mammoth → argparse → sprintf-js | mammoth 1.13.0 / argparse 1.0.10 / sprintf-js 1.0.3 | 应用使用 `mammoth.extractRawText`；未发现导入链将用户内容用作 argparse/sprintf 格式串 |

参考：[uuid advisory](https://github.com/advisories/GHSA-w5hq-g745-h8pq)、[sprintf-js advisory](https://github.com/advisories/GHSA-hp3w-g68c-fv3c)。应安排兼容性升级与锁文件回归，保留可达性判断记录。`npm audit` 对 mammoth 给出的 fix 涉及降至 0.3.29 的重大变更，不能自动照单执行。本次没有运行 `npm audit fix`，也未更改依赖。

### P3：数据共享说明和当前行为不一致

[README.md:18](D:/Projects/Tools/for-pocket/README.md:18) 声称个人/各圈子独立，但 [ledger-sync.mjs:109](D:/Projects/Tools/for-pocket/ledger-sync.mjs:109) 将一个人的记录投影到其个人账本及其加入的每个圈子；现有测试明确把这视为设计行为，不应未经产品确认就改成隔离模式。需要把“自己所有历史向自己的所有圈共享”与“不通过其他成员传递到他们的其他圈”准确区分，并在加入/创建圈子之前说明。

[docs/LOCATION.md:9](D:/Projects/Tools/for-pocket/docs/LOCATION.md:9) 仍称地点仅随账单保存；当前 reverse API 还会更新圈子地点 presence，见 [server.mjs:257](D:/Projects/Tools/for-pocket/server.mjs:257)。这是产品告知需要核对的地方，不是本报告额外声称发现后台 GPS 跟踪。分类上限 README 的 18 与代码 48 也需同步。

## 测试、覆盖与未验证边界

初始全量命令 `npm test`：**331 tests，330 pass，0 fail，1 skipped，11.36 秒**。跳过的是 reminder setup 的 mock-gcloud 资源创建/幂等集成测试；dry-run 测试通过。`npm test` 只匹配 `tests/*.test.mjs`，不会运行 `*.browser.cjs`，不能把该结果表述为“全平台浏览器已通过”。

| 区域 | 已执行/检查 | 结论与边界 |
| --- | --- | --- |
| Telegram initData / 会话 | 签名、重复字段、过期、不同身份、30 天 bearer、logout 测试；auth/server 源码 | 基础防伪与会话隔离通过；没有真实 Telegram 登录验收 |
| Google / 账号合并 | 模拟 verifyIdToken、claim 拒绝、冲突身份、合并/撤销 ticket、参与人/旧数据迁移测试 | 未见测试覆盖路径新增故障；真实 GSI origin、弹窗、账户选择、服务器验签未登录实测 |
| 圈子权限与账本投影 | 邀请确认、过期、成员容量、管理权限、原账本/其他圈隔离、离圈、重复 ID | 正常 API 防护通过；新发现 L01/L02 补足通知与邀请数据最小化边界 |
| 金额/币种/统计 | 整数最小单位、合法范围、混合币种分别聚合、转账排除、幂等、整批回滚 | 常规路径通过；L04 是 AI 标准化额外边界，不是常规手工金额输入失效 |
| 时间 | 后填时间、UTC/本地转换、跨月年、DST 间隙/重复钟表测试 | 工具函数通过；跨渠道时区传参缺陷见 L03 |
| 导入 | 实际 XLSX/DOCX fixture、坏文件、8MB 限额、截断、部分文件/批次失败 | 模型与附件提取边界受控；未做解压炸弹/超高压并发攻击测试，未送真实隐私票据至云模型 |
| 乐观更新/失败写 | per-entry queue、失败 restore、乱序响应、保存服务及 outbox 源码 | 常规重试/作用域测试通过；本次未重新执行整个实际浏览器离线-刷新-登录切换回归；服务端失败提交边界见 L05 |
| Telegram 对话/自动记账 | 私聊限定、草稿身份绑定、确认重放、旧账本、取消/重试、附件、语言、重复 update 测试 | 全部采用模拟模型/Telegram；真实语音识别率、网络重试和实际消息送达未验收 |
| 摘要/定时任务 | 聚合最小化、cron secret、时区窗口、幂等、失败收件人重试、通知 checkpoint | 单进程 fixtures 通过；线上 Scheduler/Cloud Tasks 配置、真实时刻触发未验证 |
| 持久化/备份 | 原子替换、延迟 flush、Cloud Run 响应前 flush、关闭等待、迁移备份、校验恢复 | fixtures 通过；真实存储服务、容量、RPO/RTO 及恢复未验证；L05 补充外部通知顺序 |
| 构建/部署 | Docker/ignore/CI 静态审查、运行时模块测试；CI 配置含 Windows/Linux Node24 | 本次子审计未构建/运行 Docker 镜像，未执行云端发布或生产 OAuth；CI 配置存在不等于线上最近运行成功 |

### 可重跑复现

脚本仅在 `work/audit-2026-10-13/`；该目录被 Git 忽略，不改变正式测试选择。它们断言期望的安全/数据不变量，**当前非零退出码是已知审计证据，不是应用已被修复**。如要把报告移交另一台机器，请同时携带这些脚本。

```powershell
node --test work/audit-2026-10-13/backend-boundaries.test.mjs
node --test work/audit-2026-10-13/backend-http-membership.test.mjs
node --test work/audit-2026-10-13/backend-http-persistence.test.mjs
```

结果分别为 5/5、2/2、1/1 期望不变量失败；八条用例覆盖上述五项发现，其中 HTTP 成员与单元成员用例互为验证，不重复计算为更多漏洞。HTTP 测试只监听 127.0.0.1 的随机临时端口；外部调用完全模拟；磁盘故障只发生在校验过路径的临时目录，结束后清理 fixture，不接触项目 data。

诊断遵循 diagnosing-bugs 的可重现反馈循环；因为任务范围仅限审计，未进入修改应用和声称“修复回归通过”的阶段。

## 建议处理顺序

1. 优先关闭 L01 的撤销授权后消息泄漏；同时核实生产持久化/备份，作为发布门槛。
2. 将 L02 预览数据最小化、L03 时区来源统一作为紧接的独立修复。
3. 修复 L04 确定性金额/分摊约束，再处理 L05 持久化通知 outbox 及故障语义。
4. 把本报告 red 用例转为正式回归；复跑现有全套及真实浏览器/真实账号端到端；最后做依赖与文档维护。

## 审计源码指纹

以下文件检查时未见并发修改。若后续行号或行为变化，以重新计算 SHA256 和重跑用例为准。

| 文件 | SHA256 |
| --- | --- |
| server.mjs | `C6E374A051DD40263E26ADFBDAF370817B75450CE56B1CE5FB32FC67685F2CF8` |
| domain.mjs | `844A0FA988614FC8AFC2FF50DE41D5A5447263A0B271A5FB3D46F6971BE3396C` |
| store.mjs | `BA8D1A22E102F9B2F559A71E349D04FB7841CB8D98792FFEB4FBE8D0A93A21F8` |
| auth.mjs | `51CB4183DC96795108AD6045989106F8EA7E84F72A373ED43D2CB39B6B41E183` |
| ai.mjs | `3E285C30B3CCFA114272DE0C94659C52271452D74A6E4866FAC28EB01054C008` |
| telegram-ai.mjs | `EE2449595FC38F5C703A3D13FED5AFF85D47E068ED5491F891676A6DA733F4CA` |
| telegram-expense-sync.mjs | `9178668D95838C28E7BB40B91448E88515DAAEDDE6710AD05C842AF7BF9817CD` |
| circle-presence.mjs | `BD91F3CA193598EF878659E25096E0121051D1675812E335F4C5467A20739AB7` |
