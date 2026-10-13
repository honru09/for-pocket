# 圈子头像互动

首页头像保留成员昵称和自定义头像。自己的头像打开资料，对方头像打开表情抽屉；头像不再切换这笔记录的付款人。首页手动记账始终使用当前登录用户。

抽屉提供 84 个表情，单行横向滑动；头部只保留头像、昵称及可选的位置。位置只展示同一圈子内一小时内更新的地点名称，不展示坐标或过期位置。

表情按一下立即发射，后台独立提交；可连续发送。收件人打开同一圈子时，在记账页、小账本或弹窗上方都能收到动画。页面可见期间每 1.5 秒刷新，回到前台也会刷新；后台暂停。播放完成后按批确认收件，页面切换不重复播放。发送失败可点击重试。

同一圈子、发送人、收件人和表情，连续两次间隔不超过 3 秒时合并为一组。接收动画右下角显示 `✖️` 与 emoji 数字，单次不显示次数。最后一次发送 13 秒后，给收件人的 Telegram 私聊发送一条静默提醒；生产环境使用 Cloud Tasks 保障延时投递，详见 [表情提醒部署](REACTION_NOTIFICATIONS.md)。

接口需既有 Telegram / Google 会话认证，且需当前圈子成员权限：

- `GET /api/circles/reactions?ledgerId=...`：只返回当前成员的未读表情。
- `POST /api/circles/reactions`：`id`、`circleId`、`ledgerId`、`recipientId`、`emoji`。同一 id 重试不重复发送或累计次数；发送人由会话确定。响应包含 `burstId`、`burstIndex`、`burstCount`、`burstLastAt`。
- `POST /api/circles/reactions/ack`：`circleId`、`ledgerId`、`ids`。只能确认自己的收件。

表情保存在对应圈子中，保留 7 天，每圈子最多 1000 条；每次最多获取或确认 40 条。允许单个 Unicode emoji（含肤色、旗帜及组合表情），不接受正文或 HTML。跨圈子、退圈和已过期权限不能读写。

验证：`npm test`；浏览器回归 `node tests/circle-reactions.browser.cjs`（需可用的 Playwright）。回归使用独立临时账号与目录，不向真实成员发送消息。
