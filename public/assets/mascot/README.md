# 小云朵动作素材

这组三张图是沿用 `mascot-main.png` 生成的透明 RGBA 4×2 atlas：

- `mascot-expressions-atlas-v1.png`：平静、闭眼笑、害羞、疑惑、叹气、轻微生气、惊讶、睡觉。
- `mascot-tap-frames-v1.png`：抬起、压扁、回弹和左右轻晃等点击帧。
- `mascot-cash-frames-v1.png`：掏钱、钱飞走、接钱、塞回云朵等收支帧。

`src/PocketMascot.jsx` 会把每个格子裁成独立的 nested SVG，再用 `transform`、`opacity` 和 Web Animations 做连续动作。矢量脸部仍负责可访问的状态切换，atlas 只做很短的纸张回显，避免低分辨率逐帧切图带来的跳动。

素材由内置 `image_gen` 生成，随后移除生成器烘焙的中性棋盘格并保留真实透明通道。不要把整张 atlas 当作按钮背景，也不要在图片里写入金额、文案或业务状态。
