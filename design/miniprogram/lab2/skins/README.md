# D 盘面 · 皮肤系统

开发时怎么把「主题皮肤」接进小程序、以后怎么加第四套。

## 两层

| 层 | 文件 | 作用 |
| --- | --- | --- |
| **版式** | `../d-chart.css` | 结构、字号、间距、`--paper/--ink/--zhu/--faint` 四个主色 |
| **皮肤** | `skins/*.css` 或 `themes/*.css` | 只覆盖颜色，不改结构 |

`skins/` 是**编译期**用的（选出哪套就固定写进页面），`themes/` 是**运行时**可切的（切 `<link>` 顺序）。
开发阶段建议先用 `skins/`，确定默认配色后再把最终稿挪进 `themes/` 做成可切换。

## skins/（已就位，可直接用）

```
skins/panmian.css           当前 D 盘面本色（纸 #F0E5CB / 墨 / 朱砂）
skins/tokens-design.css     设计系统令牌（--color-* 一套，给新组件用）
skins/components-design.css 设计系统组件（.btn/.input/.card/.tag/.link + 文字样式）
```

### 接法

```html
<link rel="stylesheet" href="d-chart.css">
<link rel="stylesheet" href="skins/panmian.css">
```

`panmian.css` 是**恒等皮肤**：加载前后视觉完全一致（已用截图逐像素核对），作用是把它当作模板——复制一份改「色板」那 10 个值，就是一套新皮肤，覆盖点不用动。

### panmian.css 的内部结构

1. **色板**（10 个值）：4 个主色 + 6 个派生色。派生色是把 `d-chart.css` 里写死的 `rgba()` 收成了变量。
2. **覆盖点**（6 处，固定选择器）：`d-chart.css` 里唯一还有硬编码颜色的地方——
   - `.rows li / .stars2 li / .theme-list li` 的点线
   - `.field` 的表单下划线
   - `.empty` 的空态虚线
   - `.btn:active` / `.btn.zhu:active` 的按下底色
   - `.months12 .on` 的选中月底色
   - `.seg a.on` 的反白文字色

**新增皮肤必须把这 6 处全部对齐**，否则会漏出上一套的纸色。已用一套反相探针（深底浅字）实测过：注入后页面无溢出、无裁切、无低对比，6 处全部换色成功。

## themes/（运行时可切）

见 `../themes/README.md`（旧版三套）与本目录下由 Codex 产出的神秘感三套（玄机 / 符箓 / 星图）。
运行时切换靠 `theme-boot.js` 读 `?theme=` 后插 `<link>`，无需改各页的 `<script>`。

## 校验工具

新增皮肤后跑：

```bash
# 单页 + 单皮肤，输出对比度/溢出/裁切报告与实屏 PNG
node .pair/shot_skin.cjs d-chart-home.html skins/panmian.css out.png
node .pair/shot_skin.cjs d-chart-ziwei.html themes/xuanji.css out-ziwei.png
```

它用 CDP 在页面里注入 `<link>`（不动源文件），再跑一遍和 `lab2-audit.cjs` 同一套的度量，最后截图。
