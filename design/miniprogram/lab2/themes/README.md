# D 盘面主题皮肤（lab2/themes）

给 `../d-chart.css` 用的三套覆盖样式。`d-chart.css` 与 `d-chart-*.html` **一个字节都没改**，
主题全部是「后加载、同层覆盖」：只改颜色与装饰层，不改结构、不改字号阶梯、不改间距。

| 文件 | 作用 |
| --- | --- |
| `xuanji.css` | 玄机：近墨底 + 石青/黛 + 硫磺金 |
| `fuyao.css` | 符箓：旧黄纸加深 + 重朱砂 + 焦墨 |
| `xingtu.css` | 星图：藏青底 + 银灰 + 暗金 |
| `theme-boot.js` | 按 `?theme=` / `data-theme` / localStorage 挂 `<link>`（供直链预览） |
| `../_themes.html` | 三套并排的比稿台（每套 3 屏 iframe + 色板 + 定位） |
| `../ornaments/*.svg` | 装饰纹样（单文件、`viewBox`、`currentColor`/`var(--zhu)`、无外链、无滤镜） |

---

## 一、三套的定位

### 玄机 `xuanji` — 夜里看星盘

底 `#14161B`（深靛黑），字 `#E6E1D2`（冷米白）；**朱砂位让给硫磺金** `#C9A24C`，
像夜里点的一盏灯——印章、宫名、重点全走金；次要文字走石青 `#7F93A6`。
封面右侧一枚二十八宿细线环，下沿一道云纹收边，页头一层极淡星点。整体 low-key。

### 符箓 `fuyao` — 一张供在案上的旧符纸

纸 `#E7D9B8`（比宣纸更黄更旧），墨 `#1C1710`（焦墨），朱 `#8E1E12`（比原朱更沉），
次要 `#54452D`。区段标题左端一道**朱笔批注**（2px 朱竖条），封面左缘一枚**符箓竖条**，
封面下沿远山、页脚一道回纹封口。是唯一一套浅底主题。

### 星图 `xingtu` — 一张翻开的星图

底 `#1B2233`（藏青），字 `#DFE5F0`（银灰），朱 `#C9A961`（暗金，只做记号），次要 `#9FB0C9`。
背景铺星点与二十八宿细线（`xingxiu.svg` 平铺 + `xiuhuan.svg` 环），封面下沿远山。

---

## 二、色板表

四个主变量是三套都必须给的（`d-chart.css` 的 `:root` 就这四个）：

| 变量 | 含义 | 玄机 | 符箓 | 星图 |
| --- | --- | --- | --- | --- |
| `--paper` | 纸 / 页面底 | `#14161B` | `#E7D9B8` | `#1B2233` |
| `--ink` | 墨 / 正文与框线 | `#E6E1D2` | `#1C1710` | `#DFE5F0` |
| `--zhu` | 朱 / 印章·宫名·重点 | `#C9A24C` | `#8E1E12` | `#C9A961` |
| `--faint` | 淡墨 / 次要文字·图标 | `#7F93A6` | `#54452D` | `#9FB0C9` |

每套另外五个内部量（都带 `--th-` 前缀，不会与 `d-chart.css` 撞名）：

| 变量 | 用途 | 玄机 | 符箓 | 星图 |
| --- | --- | --- | --- | --- |
| `--th-cover` | 封面底（与页底差半档） | `#101216` | `#E2D2AC` | `#171D2B` |
| `--th-rule-strong` | 外框：页头 / 底栏 / 区段顶线 / 卡片外框 | `rgba(230,225,210,.68)` | `rgba(28,23,16,.88)` | `rgba(223,229,240,.66)` |
| `--th-rule` | 格线：命盘宫格 / 四柱 / 分栏 | `rgba(230,225,210,.46)` | `rgba(28,23,16,.62)` | `rgba(223,229,240,.46)` |
| `--th-rule-soft` | 点线：列表行分隔 | `rgba(230,225,210,.36)` | `rgba(28,23,16,.40)` | `rgba(223,229,240,.34)` |
| `--th-tint-zhu` / `--th-tint-ink` | 朱/墨的浅底（选中、按压） | `.14` / `.09` | `.10` / `.07` | `.13` / `.09` |
| `--th-dial-label` | 罗盘外圈八卦字（比 faint 再亮/沉一档） | `#9FB4C6` | `#4A3C26` | `#B4C3D8` |
| `--th-art` | `.cover .art` 的 opacity | `.38` | `.46` | `.38` |

### 实测对比度（headless Edge 157，390×844，取 computed style + 页面上溯到第一个实底）

| 位置 | 选择器 | 玄机 | 符箓 | 星图 |
| --- | --- | --- | --- | --- |
| 正文 | `body` | **13.85:1** | **12.73:1** | **12.55:1** |
| 次要文字 | `.sec-head span`（11px） | **5.71:1** | **6.63:1** | **7.20:1** |
| 次要文字（列表） | `.rows li em` | 5.71:1 | 6.63:1 | 7.20:1 |
| 朱位文字 | `.p-name` / `.seal` | **7.55:1** | **6.40:1** | **7.05:1** |
| 罗盘外圈字 | `.dial text[fill="var(--faint)"]` | **8.46:1** | **7.64:1** | **8.87:1** |
| 罗盘干支 | `.dial text[fill="var(--ink)"]` | 13.85:1 | 12.73:1 | 12.55:1 |
| 底栏图标（描边） | `nav.tabbar .ico` | **5.71:1** | **6.63:1** | **7.20:1** |
| 底栏当前项 | `nav.tabbar a.on .ico` | 7.55:1 | 6.40:1 | 7.05:1 |
| 封面底纹 | `.cover .art` | — | — | — |

黑白格线（不是文字，按非文本 3:1 的门槛量）：

| 线 | 玄机 | 符箓 | 星图 |
| --- | --- | --- | --- |
| `--th-rule-strong`（外框） | 6.92:1 | 9.61:1 | 6.26:1 |
| `--th-rule`（命盘格线） | 3.82:1 | 4.38:1 | 3.78:1 |
| `--th-rule-soft`（列表点线） | 2.84:1 | 2.40:1 | 2.68:1 |

> 点线是**纯分隔**（不是信息边界，行与行靠留白也读得开），所以它低于 3:1；
> 真正承载信息的命盘格线全部 ≥ 3:1。

---

## 三、覆盖了 `d-chart.css` 的哪些硬编码点（逐条）

`d-chart.css` 里的写死颜色一共 **9 个色值、12 处出现**（`#F0E5CB` `#1A140F` `#A32B1C` `#5B4F43`
各 1 处，`rgba(26,20,15,.06)` 1 处，`rgba(26,20,15,.28)` 3 处，`rgba(26,20,15,.3)`
1 处，`rgba(26,20,15,.4)` 1 处，`rgba(163,43,28,.07)` 2 处），加上 3 类结构上的颜色依赖
（`var(--ink)` 框线、`var(--faint)` 的 presentation attribute、`.cover .art` 的 opacity），
逐条对应如下。三套主题的规则**完全一致**，只是变量取值不同——这就是「换主题不依赖
上一套残留」的做法：每套都独立覆盖上面全部条目。

### 1. `:root` 的四个主变量（第 1 行）

```css
:root { --paper:#F0E5CB; --ink:#1A140F; --zhu:#A32B1C; --faint:#5B4F43 }
```

三套各自重定义 `--paper / --ink / --zhu / --faint`。

**刻意不定义 `--line`。** `d-chart.css` 里 `--line` 有两种用法：

- `.cover-date`（第 5 行）→ `border-bottom:1px solid var(--line)`，**没有回退值**；
- `.rows li`（第 28 行）→ `var(--line,rgba(26,20,15,.28))`，**有回退值**。

`--line` 未定义时，第一条是 IACVT（整条声明作废），`.cover-date` 下**不画线**（实测
`border-bottom-width: 0px / style: none`）。一旦定义 `--line`，封面日期条下会凭空多出
一条 1px 线——那就改了原设计的画法。所以三套都**留空 `--line`**，
`.rows li` 的点线改由 `--th-rule-soft` 单独覆盖（第 2 条）。

### 2. `rgba(26,20,15,…)` —— 墨色透明，共 4 处

| 行 | 选择器 | 原值 | 覆盖规则 |
| --- | --- | --- | --- |
| 28 | `.rows li` | `rgba(26,20,15,.28)` | `border-bottom-color: var(--th-rule-soft)` |
| 45 | `.field` | `rgba(26,20,15,.3)` | `border-bottom-color: var(--th-rule-soft)` |
| 76 | `.stars2 li` | `rgba(26,20,15,.28)` | `border-bottom-color: var(--th-rule-soft)` |
| 89 | `.theme-list li` | `rgba(26,20,15,.28)` | `border-bottom-color: var(--th-rule-soft)` |
| 103 | `.empty` | `rgba(26,20,15,.4)`（dashed 外框） | `border-color: var(--th-rule)` |

（第 103 行也是墨色透明，一起列在这里。）

### 3. `rgba(26,20,15,.06)` —— `.btn:active` 的按压底（第 2 行）

```css
.btn:active { background: var(--th-tint-ink); }
```

### 4. `rgba(163,43,28,.07)` —— 朱色浅底，共 2 处

| 行 | 选择器 | 原值 | 覆盖规则 |
| --- | --- | --- | --- |
| 2 | `.btn.zhu:active` | `rgba(163,43,28,.07)` | `background: var(--th-tint-zhu)` |
| 73 | `.months12 .on` | `rgba(163,43,28,.07)` + `box-shadow: inset 0 0 0 1px var(--zhu)` | `background: var(--th-tint-zhu)`；`box-shadow` 保留手法只换色 |

> `.months12 .on` 的 `box-shadow` 是 **0 模糊的内描边**（`inset 0 0 0 1px`），不是投影；
> 原样式就这么写，主题沿用，不改手法。

### 5. `var(--ink)` 的框线 —— 拆成三级

原来所有框线都取 `--ink`。深底 / 旧纸底上全部同色会糊成一片，所以按用途分三级。
**逐条选择器**（`d-chart.css` 里所有 `border*-color: var(--ink)` 的位置）：

| 级别 | 选择器 | 原值 |
| --- | --- | --- |
| strong | `header` | `border-bottom` |
| strong | `nav.tabbar` | `border-top` |
| strong | `.section-title` | `border-bottom` |
| strong | `.sec-head` | `border-bottom` |
| strong | `.coord` | `border-bottom` |
| strong | `.datebar` | `border-bottom` |
| strong | `.stepper` | `border-bottom` |
| strong | `.entries li` | `border-bottom` |
| strong | `.reading article` | `border-bottom` |
| strong | `.months h2` | `border-bottom` |
| strong | `.seg` | `border` |
| strong | `.months12` | `border` |
| strong | `.hua` | `border` |
| strong | `.cover` | `border` |
| strong | `.double` | `border: 2px` |
| strong→rule | `.double` | `outline: 1px`（外框用 strong，外描边用 rule，保留双线框手法） |
| rule | `.palace` | `border-right` / `border-bottom` |
| rule | `.center` | `border-right` / `border-bottom` |
| rule | `.pillar` | `border-right` |
| rule | `.seg a` | `border-right` |
| rule | `.hua div` | `border-right` |
| rule | `.months12 div` | `border-right` / `border-bottom` |
| rule | `.months > div + div` | `border-left` |
| rule | `.field input / .field select` | `border-bottom: 1px solid transparent`（透明，无影响，不覆盖） |
| —— | `.pair select` | `border-bottom: 1px solid var(--ink)`（**不覆盖**：它是输入框下划线，跟输入文字同色才像一处） |
| —— | `.ruler` | `border-bottom: 1px solid var(--ink)`（**不覆盖**：五行条基线，见下） |
| —— | `.btn` | `border: 1.5px solid var(--ink)`（**不覆盖**：按钮边框与按钮文字同色，见下） |

> 三处例外与理由：
> - `.ruler`（五行条基线）继续用 `var(--ink)`——它旁边就是 34px 的干支大字，基线要和字同重，
>   换淡会读成「没画完」。
> - `.btn` 继续用 `var(--ink)`——按钮字就是 `--ink`，边框同色是一个整体；拆开会让按钮散架。
> - `.pair select` 同理：它是 `border-bottom` 下划线输入框，跟里面的文字同色。

### 6. `d-chart-home.html` 里写死的 `#F0E5CB`（太极阴眼）

```html
<circle cx="0" cy="-11" r="4.18" fill="#F0E5CB" ...>
```

这是封面 SVG 里唯一一处硬编码色（模板里叫「旧纸色」）。深色主题下它会变成一颗米黄的点，
所以三套都用属性选择器接住：

```css
.cover .art circle[fill="#F0E5CB"] { fill: var(--paper); }   /* 玄机 / 星图 */
.cover .art circle[fill="#F0E5CB"] { fill: var(--th-cover); }/* 符箓，与封面底同色 */
```

### 7. 罗盘里 `<text fill="var(--faint)">` / `<path stroke="var(--faint)">`

这是 **presentation attribute**（不是 CSS 声明），只改 `--faint` 会让 11.5px 的八卦字
在深底上偏暗。三套都加一条属性选择器精确提亮：

```css
.dial text[fill="var(--faint)"] { fill: var(--th-dial-label); }
.dial path[stroke="var(--faint)"] { stroke: var(--th-dial-label); }
```

（`d-chart-bazi.html` 的罗盘 SVG 内联在页面里，`var(--faint)` 会被解析成具体色，
但 attribute 里写的是字面量 `var(--faint)`，所以属性选择器能选中——实测生效。）

### 8. `.cover .art` 的 opacity

`d-chart.css` 第 3 行写死 `opacity:.5`。浅底纹配深底会太亮，三套各自给 `--th-art`
（`.38` / `.46` / `.38`）。**颜色仍留在 `--ink` 上**——底纹里还有八卦字，
把颜色一起压深会让它们看不见；变暗只靠 opacity。

### 9. `nav.tabbar .ico` 的描边

`stroke: currentColor` + `stroke-width: 1.3`。深底上 1.3px 会发虚，三套都明确给色并把
线宽加到 1.45（当前项 1.6）：

```css
nav.tabbar .ico { stroke: var(--faint); stroke-width: 1.45; }
nav.tabbar a.on .ico { stroke: var(--zhu); stroke-width: 1.6; }
```

---

## 四、装饰层挂在哪些选择器上

**硬规则：装饰只碰容器边缘与背景层，绝不进入 `.pillars`（四柱表）、`.palace`（紫微格）、
`.dial`（罗盘）内部——那里是数据，被盖住就错。** 三套都没有一条规则落在这三个选择器
或其子元素上（`--th-dial-label` 只是给罗盘**已有**的文字换色，不新增图层）。

> 下表是 **v1 三套 SVG 遮罩**的挂点，玄机 / 星图仍在用；
> **符箓已升级为 v2 位图**（纸底、符箓竖条、远山、云雷纹、罗盘、卦象横幅、星图横幅、铜钱、红线、单枚朱印），
> 参数与挂点以文末「位图装饰 · 符箓 v2 现状」为准，本表符箓列的 16px / `.34` 等旧值已作废。

| 选择器 | 玄机 | 符箓（v1，已作废） | 星图 |
| --- | --- | --- | --- |
| `body::before` | 全页薄光（radial-gradient，`.10`） | 纸面提亮（radial-gradient，`.10`） | 左上暗金薄光 + 星点（`.10`） |
| `body::after` | 无 | 页脚回纹封口（12px，`.14`） | 页脚星点远景（120px，`.10`） |
| `header::after` | 页头星点（52px 内，`.12`） | 无 | 无 |
| `.cover::before` | 二十八宿细线环（178px，`.26`） | 符箓竖条（左缘 16px，`.34`） | 二十八宿细线环（190px，`.30`） |
| `.cover::after` | 云纹收边（24px，`.26`） | 远山剪影（74px，`.20`） | 远山剪影（88px，`.16`） |
| `.sec-head::before` | 金菱 4×4 | 朱笔竖条 2×13 | 银菱 4×4 |
| `.empty::before` | 太极八卦环（132px，`.16`） | 太极八卦环（132px，`.12`） | 二十八宿环（132px，`.22`） |

叠加次序：装饰都是 `z-index:0` 的定位层，正文靠
`body > header / main / nav { position:relative; z-index:1 }` 提到上面；
`.cover-txt` 提到 `z-index:2`（封面里有两层装饰）。
**不用 `z-index:-1`**——`body` 有实底，负层会被自己的底色盖住。

---

## 五、切换方式

### 1. 预览页 `../_themes.html`（已可用，不改任何 HTML）

三列 × 三屏 iframe，地址是 `d-chart-home.html?theme=xuanji` 这种真地址。
iframe 与预览页**同源**（都在 `127.0.0.1:8765/mp/lab2/`），所以预览页能在 iframe 的
`onload` 里读 `contentDocument`，往它 `<head>` **末尾**插一个 `<link>`：

```
d-chart.css  →  themes/<name>.css      ← 后加载、同层、同优先级，后者覆盖前者
```

iframe 内部跳转（点底栏去八字页）会重新触发 `load`，预览页会**重新挂一次**，
所以点进去不会退回纸色。插的 `<link>` 带 `data-theme-injected` 标记，
换主题时只清自己插的那几个，不动页面原有的 `d-chart.css`。

### 2. 直链：`themes/theme-boot.js`

```html
<script src="themes/theme-boot.js"></script>   <!-- 放在 </head> 之前 -->
```

之后 `d-chart-home.html?theme=xingtu` 就会自己挂上主题。优先级：

1. `<script src="themes/theme-boot.js" data-theme="xingtu">` 的 `data-theme`（给无法带查询串的场合）
2. `?theme=<name>`；**给了但不认识的名字 → 不套主题**（回原纸色，而不是偷偷套记住的那套）
3. `localStorage["mingli.lab2.theme.v1"]`（记住上次看的）
4. 都没有 → 什么都不插（原纸色 D 盘面）

同时会在 `<html>` 上打 `data-theme="<name>"`，方便截图与排查。

> 13 个 `d-chart-*.html` 的 `</head>` 前**都已**插入 `themes/theme-boot.js`
> （`.pair/gen-theme-boot.cjs` 幂等生成 13/13）。默认不挂主题（原纸色像素不变），
> 只有 `?theme=` 或 localStorage 有记录才生效。所以直链、比稿台、
> 「我的 · 外观」四档切换器现在走的是同一条路径。

### 3. 运行时切换：「我的 · 外观」四档

`d-chart-me.html` 的「外观」段是四档真实可点的选择器（`.pair/gen-theme-picker.cjs` 生成）：

| data-name | 显示 | 说明 |
| --- | --- | --- |
| `none` | 原纸 | 宣纸 · 墨字 · 朱砂（不挂任何主题） |
| `fuyao` | 符箓 | 旧纸 · 墨字 · 朱砂符（**位图级装饰，见下节**） |
| `xuanji` | 玄机 | 深底 · 银字 · 金线 |
| `xingtu` | 星图 | 藏青 · 星点 · 泥金 |

点一下写 `localStorage["mingli.lab2.theme.v1"]` 再带 `?theme=` 重载本屏；
其余 12 屏同源共享这份记录，所以「换完这一屏立刻变，别的屏跟着变」。
当前项靠 `<html data-theme>` 打 `.on`（朱色 + 「 · 当前」后缀）。
「原纸」走 `removeItem` + `?theme=none`，`theme-boot.js` 遇到不认识的名字
会明确回原纸色，而不是偷偷套用记住的那套。

---

## 六、新增第四套要改哪几处

1. **`themes/<name>.css`** — 复制任意一套，改 4 个主变量 + 8 个 `--th-*`，
   再决定装饰层挂什么。务必保留「`--line` 留空」这一条（见第三节第 1 条）。
2. **`themes/theme-boot.js`** — `var THEMES = ["xuanji","fuyao","xingtu"]` 里加名字。
   不加的话 `?theme=<name>` 会被当成「不认识」而回原纸色。
3. **`../_themes.html`** — `THEMES` 数组里加一条（`key / name / tag / say / pal`），
   列会自动多一列；`.deck` 是 `grid-template-columns: repeat(3, auto)`，
   四套要改成 `repeat(4, auto)`（或改成 `auto-fit`）。
4. **`ornaments/`** — 需要新纹样就新建 SVGO-free 的单文件 SVG：`viewBox`、只用
   `currentColor` 或 `var(--zhu,currentColor)`、无外链、无滤镜、注释里**不能出现 `--`**
   （`<!--` 里出现 `--` 是 XML 非法，会整张图解析失败——这个坑已经踩过一次）。
5. **这份 README** — 色板表、对比度表、装饰层表各加一列。
6. **自检** — 跑第四节的审计命令（见下）。

不需要改的：`../d-chart.css`、`../d-chart-*.html`、`../base.css`、`../themes/*`、
`../ornaments/*`（旧版主题与旧纹样，与 lab2 无关）。

---

## 七、自检怎么做

```powershell
# 1) 静态服务（:8765，脱离会话常驻）+ 无头 Edge CDP（:9333）
node .pair/serve.mjs 8765

# 2) 三套 × 十三屏：溢出 / 裁切 / 小字 / 对比度 / 外链
node .pair/audit_themes.cjs                 # xuanji / fuyao / xingtu 各 13/13

# 3) 375 宽左右边距：只量 lum<110 的近黑像素，跳过铺满行，取 2%/98% 分位
node .pair/shot-375.cjs                    # 先出 none-* 与 t-* 两套截图
node .pair/ink2.cjs .pair/shots-375 t-

# 4) 主题态单屏 / 全量截图（禁缓存 + URL 加 cb；位图改内容不改 URL 时必须用这个）
node .pair/shot-theme-nocache.cjs bazi ziwei
node .pair/shot-theme-nocache.cjs          # 十三屏全量

# 5) 十三屏总览拼图
node .pair/sheet-theme.cjs                 # -> docs/shots/lab2-fuyao-all.png
```

判据：`audit_themes` 三套各 13/13；`ink2` 十三屏左右差 0（journal 差 2 是
`.bounds li` 的 `·` 项目符号出血，亚像素级）；总览图 13 张 img 全部 `complete`。
`shot-theme-nocache.cjs` 的 `deviceScaleFactor:2` × `clip.scale:2` = **实际像素是 CSS 的 4 倍**，
裁图定位时别按 2 倍算。

> **服务一死，审计会「全绿」或者「全红」，但都是假的。** 静态服务掉了之后浏览器渲染的是
> 自己的 `ERR_CONNECTION_REFUSED` 错误页，那页的 `.error-code` 文案是 10px，
> 于是 13 屏齐刷刷报「小字 1」——曾经按这个假象查了半小时。
> 现在 `audit_themes.cjs` 有两道守卫：开跑前 `fetch` 首页并要求返回内容含 `data-page`，
> 不满足直接 `exit 1` 并提示先起服务；逐屏再核 `document.body.dataset.page === 屏名`，
> 不符就记「页面未装载」而不是输出假的度量。守卫本身用
> `node .pair/test-audit-guard.cjs` 回归（它会临时把 BASE 指向死端口，断言退出码为 1）。

真页面（`design/miniprogram/*.html`，不是 lab2）另有一套对称性探针：
`node .pair/probe-mp-sym-desktop.cjs`，375 下 13 页 nav/tabbar `[0,0]`、首块 `[16,16]`。

---

## 八、已知取舍

1. **不定义 `--line`**，代价是 `.cover-date` 的 `var(--line)` 继续走 IACVT（不画线），
   这是**保留**原设计，不是遗漏。
2. **`.ruler` 与 `.btn` 的边框仍用 `var(--ink)`**，不拆三级——理由见第三节第 5 条。
3. **`theme-boot.js` 已接入 13 屏**，且「我的 · 外观」四档可直接点着换。
   `?theme=none / bogus` 明确回原纸色；localStorage 只做「记住上次」，不覆盖显式查询串。
4. **玄机 / 星图仍走 `mask-image` + `background-color`**（一套 SVG 三套通用）；
   **符箓 v2 已换成 codex 生图的位图**，并在 v2 段里对四个旧 `::before/::after`
   显式 `-webkit-mask:none; mask:none; opacity:1` —— 否则 v1 的 SVG 遮罩会按旧尺寸
   把位图裁掉、v1 的 opacity 还会二次乘上已烘焙进 PNG 的 alpha（页脚雷纹几乎看不见就是这条）。
5. **符箓是唯一浅底主题**，它的朱色 `#8E1E12` 比原朱 `#A32B1C` 更沉（6.40:1 vs 5.14:1），
   是为了在更旧的黄纸（`#E7D9B8`）上够清楚。若想更「朱」，可回调到 `#A32B1C`，
   代价是对比度掉到 5.14:1（仍在 4.5 门槛上）。
6. **没有圆角**：三套 CSS 里 `border-radius` 出现 **0 次**（连 `999px` 都没用），
   阴阳鱼、星点这类圆一律在 SVG 里用 `<circle>` 画——SVG 的圆不是 CSS 圆角。
7. **没有投影、没有模糊**：`filter` / `blur(` 出现 0 次。唯一的 `box-shadow` 是沿用
   `.months12 .on` 原有的 `inset 0 0 0 1px`（0 模糊内描边，只换色）。
8. **渐变只出现在两个 `body::before`**（玄机 / 符箓 / 星图各一处），
   都是 `radial-gradient` 底色薄光，`opacity: .10`，且不带任何文字。
---

## 位图装饰（codex 生图）· 符箓 v2 现状

`ornaments/*.svg` 是手写矢量纹样（玄机 / 星图仍在用）。符箓另有一组 **codex 图像生成工具
产出的真实位图**，放在 `../art/fuyao/`，原件在 `../art/raw-fuyao/`（9 张，1254² 或 2172×724）。
用户要求「再生成一些和算命相关的插图和装饰，颜色深一点」后，只深做了符箓这一套；
玄机（黑）与星图（青）按用户「先不要做」暂缓，仍是 v1 的换色 + SVG。

### 成品清单（`../art/fuyao/`）

| 文件 | 尺寸 | 内容 | 挂点 |
| --- | --- | --- | --- |
| `paper-deep-tile.png` | 600×600 | 旧符纸，纤维/霉斑/折痕，**无缝平铺** | `body` background，600px 平铺 |
| `orn-fuzhuan.png` | 220×440 | 朱砂笔触符箓竖条（纯抽象无字） | `.cover::before` 左缘 22×150 |
| `orn-shanying.png` | 900×300 | 三层远山墨 wash | `.cover::after` 下沿 66px |
| `leiwen.png` | 900×300 | 商周云雷纹长带 | `.sec-head::after` + `nav.tabbar::before` |
| `luopan.png` | 760² | 风水罗盘（同心环 + 太极心） | `.deco-luopan` / `.empty::before` |
| `guaxiang-band.png` | 900×200 | 六爻卦象，**竖列横排 4 列** | `.deco-guaxiang` 78px（bazi） |
| `xingxiu-band.png` | 900×410 | 二十八宿四象星图（横幅） | `.deco-xingxiu` 152px（ziwei） |
| `tongqian.png` | 420² | 三枚方孔铜钱 | `.deco-tongqian` 82px（input） |
| `hongxian.png` | 440² | 红线盘长结 | `.deco-hongxian` 96px（match） |
| `yinzhang-one.png` | 220² | **单枚**朱砂印（从 2×2 四枚里裁出） | `.deco-yinzhang` 46px（cycle/journal/report） |
| `guijia.png` | 480² | 龟甲卜辞 + 灼裂 | 备用（当前未挂） |

### 两条挂法铁律

1. **伪元素只铺本身就是空白/页边的位置**：`body` 纸底、`.cover::before/::after`、
   `.sec-head::before/::after`、`nav.tabbar::before`、`.empty::before`。
   页头右端 22px 印章已整条删掉（缩到 22px 只是一团红点，还和「命/柱/盘」字章并排抵消）。
2. **其余用真正占位的 `<div class="deco deco-xxx">`**（`.pair/patch-fuyao-art.cjs` 幂等插入
   8 屏：bazi/ziwei/palace/input/match/cycle/report/journal），占版面高度，
   结构上不可能与正文重叠。装饰边界未变：`.pillars` / `.palace` / `.dial` 内部零规则。

alpha 一律**烘焙进 PNG**（`.pair/fade.cjs`），CSS 不再用 opacity —— 叠层顺序怎么变都不会吃掉正文。
正文实测对比 7.2–7.5:1（`.pair/contrast.cjs`），理论 `#D9C79B / #1C1710 = 10.68:1`。

### 生成链路

```powershell
# 生图（stdin 必须 ignore，否则 codex exec 一直等追加输入、永不返回）
node .pair/gen-art-fuyao.mjs                 # 9 张，落到 art/raw-fuyao/

# 处理（自写 PNG 编解码，不依赖 Pillow / sharp —— 这台机器装不上）
node .pair/imgtool.cjs flatten <raw> <out> '#D9C79B' 0.42 0.60 600
node .pair/seamless.cjs <in> art/fuyao/paper-deep-tile.png 200   # 环绕错位 + 中心十字带交叉淡入
node .pair/imgtool.cjs mask    <raw> <out> '#1C1710' 760
node .pair/fade.cjs           <in>  <out> 0.85                    # 把 alpha 乘进像素
node .pair/gen-guaxiang-band.cjs && node .pair/install-guaxiang-band.cjs
node .pair/imgtool.cjs crop ... yinzhang-one.png 372 379 234 234

# 装进 CSS（幂等）
node .pair/patch-fuyao-art.cjs
```

`patch-fuyao-art.cjs` 的两条保护：**CSS 段以 `.pair/fuyao-art-block.css` 为单一事实源**
（不再内联旧 BLOCK），边界用 v2 标记；**位图成品已存在就跳过**（保护后来调好的
alpha 与构图，例如 xingxiu 0.34→0.85、纸底 400px 镜像→600px 无缝、卦象竖条→横幅）。
连跑三次 `fuyao.css` SHA-256 完全一致。

### 素材画廊

`../_art.html` 把所有生过的图集中到一页（`:8765/mp/lab2/_art.html`），分三组共 **27 件**：

| 组 | 目录 | 件数 |
| --- | --- | --- |
| 符箓 · 位图成品 | `../art/fuyao/` | 13（含 4 张已被取代的方形原件，标「对照用」） |
| 上一版 · 生图原件 | `../art/raw/` | 7（1254² 或 2172×724，2–3 MB 一张） |
| 手写矢量纹样 | `../ornaments/` | 7（玄机 / 星图在用） |

页面由 `.pair/gen-art-gallery.cjs` 生成（`--check` 只校验尺寸与文件存在）。它做了两件事：

1. **缩略图**：原件单张 2–3 MB，27 张全量加载十几 MB。脚本用 `.pair/imgtool.cjs scale`
   把每张 PNG 压到 360 宽存进 `../_art-thumbs/`（合计约 2 MB，mtime 比原件新才重做），
   点缩略图仍然打开原尺寸。SVG 本来就只有几 KB，直接用。
2. **尺寸与用途**：PNG 尺寸从 IHDR 读（不依赖任何图像库），SVG 从 `viewBox` 读；
   每张卡附「中名 / 一句话说明 / 尺寸 · 体积 / 挂点 / 文件名」。

```powershell
node .pair/gen-art-gallery.cjs          # 重新生成
node .pair/gen-art-gallery.cjs --check  # 只校验
```

### 两条工具页的体检命令

`:8765/mp/lab2/_art.html`（素材画廊）与 `_themes.html`（三套比稿台）不是设计稿，
但也会被打开，所以一并按多宽度量：

```powershell
node .pair/probe-page.cjs _art.html "320,390,768,1100"
node .pair/probe-page.cjs _themes.html "375,390,768,1280"
```

判据：`scrollW == 视口宽`、无越界元素、无 <11px 小字、无未加载的图。
两个已知修正记在这里，免得下次又当 bug 查：

- **`loading="lazy"` 的图**要先把页面滚一遍再量，否则「还没轮到加载」会被报成「图坏了」。
- **横向滚动容器**（`.deck` 比稿台、任何 `overflow-x:auto` 的横滑条）里的元素天然在视口外，
  探针会跳过它们的祖先有 `overflow-x:auto/scroll` 且 `scrollWidth > clientWidth` 的情况。
- `_themes.html` 原本 `body{min-width:1280px}`，在 375 下整页横向溢出 1280。
  已改为页面不定宽、三列放进 `.deck` 自己的横向滚动条（`.pair/fix-themes-page.cjs`，幂等）。
