# 分类实图 v1

36 件独立生成的透明图片：30 个消费分类和 6 个收入分类。风格与已有 `pocket-materials-v2` 纸感文具一致，采用奶白、灰绿、浅杏、浅蓝和浅黄，避免高光、文字及星号装饰。

- `manifest.json`：全部分类 ID、默认图标/颜色、原件/运行图尺寸、字节数和 SHA 总索引。
- `manifest-food.json`、`manifest-life.json`、`manifest-personal.json`：生成提示词、来源及真实检查记录。约会双杯的修订记录保留在 personal 分组。
- `.png`：未经手工重绘的生成原件，保留在 Git 中；由 `.dockerignore` 排除出部署上下文。
- `.webp`：160px、质量 85、保留 alpha 的运行图，合计 235,340 字节。仅缩放/编码，不用程序重新画图。

调用入口 `src/CategoryArt.jsx`，五处使用：主页、账目列表、分类管理、账目修改、导入预览。仅默认 ID、图标及颜色都匹配时用实图；用户改变颜色或图标后使用原来的可自定义表示。不要迁移或重写历史账目分类。

图片为空 alt 的装饰，标签仍由组件渲染。首页显示 28px，编辑器 32px，账目行 36px。图片随父组件原有按压和选中动画运动，勿追加各自独立循环动画。

验收入口：`tests/category-art.test.mjs`、`tests/category-materials.browser.cjs`。整体排版约束见 `docs/UI_SYSTEM.md`。
