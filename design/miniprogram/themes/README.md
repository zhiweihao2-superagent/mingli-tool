# 主题（themes）

三套主题共用 `tokens.css` 里的结构变量（字体、字号阶梯、间距、圆角、状态栏/导航/标签栏高度），
只替换颜色与少量装饰层：

| 主题 | 文件 | 长相 |
| --- | --- | --- |
| **原纸**（默认） | `songke.css` | 宣纸底 + 墨字 + 朱砂 |
| **符箓** | `fuyao.css` | 旧符纸（真位图纸纹）+ 焦墨 + 朱砂符 |
| **青绿绢本** | `qinglv.css` | 绢底 + 墨青字 + 赭石 |

`daoguan.css`（道观：深底 + 暖白字 + 铜金）文件还在，但已从 `switch.js` 注销 ——
不登记就选不到，`?theme=daoguan` 会安静回落到原纸。

切换方式：改 `tokens.css` **第一行**的导入路径。

```css
@import "./themes/songke.css";   /* 原纸，默认 */
/* @import "./themes/qinglv.css";   青绿绢本 */
/* @import "./themes/fuyao.css";    符箓 */
```

三套必须提供同一组变量，缺一个就会掉回浏览器默认色：

| 变量 | 用途 |
| --- | --- |
| `--bg` | 页面底色 |
| `--surface` / `--surface-2` | 卡片面 / 次级卡片面 |
| `--text` / `--muted` | 正文 / 次要文字 |
| `--line` / `--line-soft` | 主分隔线 / 次分隔线 |
| `--primary` / `--primary-ink` | 主色块（按钮）/ 其上的字 |
| `--accent` / `--accent-ink` | 强调色（印章、朱批）/ 其上的字 |
| `--gold` | 细金线、角花 |
| `--on` | 反白文字（保持兼容旧规则） |
| `--link` | 链接 |
| `--wash` / `--wash-deep` | 桌面端手机壳外围的衬底 / 更深的衬底 |
| `--nav-bg` | 顶部导航底色 |
| `--shadow-color` | 内描边阴影色（不使用投影） |
| `--art-ink` | 首页插图的山影与网格线（不是正文色，深底主题要单独调浅） |
| `--art-sun` | 首页插图的日轮与强调点 |

新增主题：复制任意一份，改 21 个色值，再按需加装饰层。装饰只作用于容器边缘
（`ornaments.css` 的 `body::before`、`.hero::after`），不进入四柱表与十二宫盘格内。

## 只看效果，不改默认

在地址后面带参数就能临时切（`?theme=songke` 明确回基线，不带参数才会去吃 localStorage）：

```
/mp/ziwei.html?theme=qinglv
/mp/ziwei.html?theme=fuyao
/mp/home.html?theme=songke     ← 显式回默认，截图对比基线时用它
```

也可以直接在「我的 · 设置」里点：三档（原纸 / 符箓 / 青绿绢本）
写进 localStorage 的 mingli.theme.v1，全站 13 页共享。

不带参数时按上次在预览里选过的主题走（存在 `localStorage` 的 `mingli.theme.v1`），
从没选过就是 `tokens.css` 里 `@import` 的那套。这条路径只在看设计稿时用，
真要换默认主题，改的还是 `tokens.css` 第一行——不要两头都改，会打架。

## 纹样

首页大图下沿那条横纹由 `ornaments.css` 的 `.hero::after` 挂，文件在 `../ornaments/`：
`songke → cloud.svg`（默认，符箓也沿用它）、`qinglv → mountain.svg`、`daoguan → thunder.svg`（已下线主题）。
符箓**不换**这条纹：试过换成云雷纹，18px 高只剩一条实心墨杠（`leiwen.png` 是密排带状纹），
云雷纹改为挂在页头下沿与底栏上沿各一条 9px 细带。
纹样只铺在容器边缘，不进入四柱表与十二宫盘格内。

符箓**不换** hero 纹样，继续用 `cloud.svg`。试过把 `.hero::after` 的 mask 换成位图云雷纹：
云雷纹是密排带纹，压到 18px 高只剩一道实心墨杠，横在封面底部很丑，已回退。
符箓的装饰密度放在页头页脚的横带与区段标题的朱笔上，不在 hero 里。

## 符箓（fuyao）多了什么

唯一用**位图**的主题（其余三套只有色值 + 一条 SVG 纹样）。位图在 `../assets/fuyao/`，
四张一共约 720 KB：

| 文件 | 尺寸 | 用途 |
| --- | --- | --- |
| `paper-deep-tile.png` | 600×600 | 整页符纸底纹，**无缝平铺**（`.pair/seamless.cjs` 做的环绕错位 + 交叉淡入） |
| `leiwen.png` | 900×300 | 商周云雷纹，压在页头下沿、底栏上沿 |
| `luopan.png` | 760² | 风水罗盘，压在空态告示（`.notice`）右下角 |
| `yinzhang-one.png` | 220² | 单枚朱砂印。**当前没有挂点**（见下），留作后续做「流内印章」时用 |

装饰挂点全部在既有容器上，**没有新增 DOM**（真页面正文多由 JS 注入，静态插块会错位）：

| 选择器 | 做了什么 |
| --- | --- |
| `html, body` | 纸纹平铺 + 一层 30% 暖白 veil（`linear-gradient`）。veil 直接去掉会霉斑太重，加到 .44 霉斑与折痕又几乎看不见，加到 .58 退成奶油色 |
| `.mp-nav::after` | 云雷纹 9px 横带，贴在导航下沿；`background-size: auto 9px` 必须按原图 3:1 走，写死宽高会被拉成一排竖杠 |
| `.mp-nav:not(.custom)::before` | **不放印章**。试过 24px 朱印钉在胶囊左侧：位图缩到这么小只剩一团红线，远看像坏掉的小图标，还紧挨居中标题像角标。lab2 那一版踩过同一个坑（22px 朱印最终删掉，改用 46px 的流内 `.deco-yinzhang`）；真页面正文由 JS 注入、没有稳定的流内锚点，所以这里干脆留白 |
| `.mp-tabbar::before` | 底栏上沿云雷纹 9px |
| `.section-head` / `.card-head` | 标题左端 2.5×13 朱笔 + 标题右让 7px；两个容器的 `position:relative` 由本主题补 |
| `.card` | `outline: 1px solid var(--line); outline-offset: -4px`（内描细线，不用伪元素，不吃点击）。**用 `--line` 不用 `--line-soft`**：卡底已压平纸面，`--line-soft` 对新卡底只有 1.33:1，1px 细线看不见 |
| `.notice` | 朱框加深 + 右下角罗盘水印。走 `background-image` 而不是 `::before` —— 背景永远在文字下面，不用给子元素补 `z-index`，也就不会盖住 `.sheet-panel` 那类浮层 |

对比度（WCAG，脚本算的，方案 B 之后）：text/surface 10.30、text/surface-2 9.57、text/bg 10.37、muted/surface 5.22、muted/bg 5.25、accent/surface 5.34；
gold/bg 3.97，所以 `--gold` 只做线不做字。

**卡底为什么这么浅（方案 B）**：纸面实测 `#D8BF8D`，原先 `--surface #E4D5AC` 与它的亮度差 +13.3（1.23:1），卡片看着像在旧纸上另贴了一张白纸。
2026-11-13 与用户比过三档（A +8.0 / B +3.8 / B2 −3.2），选定 **B**：`--surface #DBC694`、`--surface-2 #D4BF8F`、`--wash #CFB98B`、`--wash-deep #C3AD7D`，
卡面与纸面亮度差 +3.8（1.06:1），层级改由边框 + 内描线 + 卡头朱笔承担。
比稿用的 `fuyao-a/b2` 变体与 `_tones.html` 已删，生成脚本留在 `.pair/archive/gen-tones.cjs`（要再比一次能用）。

新增主题时注意：**装饰规则一律带 `:root` 前缀**（`daoguan.css` 就是范例）。
不带前缀会在主题没开的时候也生效，三套会互相打架。
