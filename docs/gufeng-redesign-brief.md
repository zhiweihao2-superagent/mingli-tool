# 小程序古风改版：给 Codex 的提示词与规划

这份是「怎么跟 Codex 说」的底稿。原则：**只换视觉层，不动信息结构**。
13 屏的文案、取数、状态块（`#empty` / `#error` / `#content`）都已经验收过，
改版一旦碰到 DOM 结构，前面那套验收（AC01–AC15）就得重跑一遍，得不偿失。

---

## 一、先选方向（三选一，不要混）

| | A. 宋刻本 / 线装书 | B. 道观符箓 / 朱墨 | C. 青绿山水 / 绢本 |
|---|---|---|---|
| 气质 | 安静、书卷、像在翻一本命书 | 神秘、郑重、像请神问卜 | 华丽、画面感强、像画卷 |
| 底色 | 宣纸米白 | 深檀 / 墨底压朱 | 绢黄 + 青绿 |
| 主色 | 墨 + 朱砂点睛 | 朱 + 金 + 靛 | 石青 + 石绿 + 赭石 |
| 装饰量 | 少（界格、双线、角花） | 中（符纹、雷纹、印章） | 多（山纹、云纹、卷轴） |
| 文字可读性 | 最好 | 一般（深底反白要小心） | 好，但装饰易抢内容 |
| 对现有代码的冲击 | **最小** | 中 | 大（要改 hero 图、卡片底色） |
| 适合本项目 | ✅ 推荐 | 可选，做「金句/结论卡」局部 | 不建议整站，做首页 hero 局部即可 |

**推荐：A 为主 + 借用 B 的印章元素做局部强调。** 理由：这是个要读长文、看表格的工具类小程序，
装饰一多就会跟「四柱表 / 十二宫盘 / 关系列表」抢注意力；而 A 的界格与双线本来就是中国书籍
组织信息的原生手段，加装饰等于加结构感，不会变成噪音。

---

## 二、A 方向的具体规格（照这个写，Codex 才改得准）

### 色彩（直接替换 `design/miniprogram/tokens.css`）

```
--bg:        #F2EBDD   /* 宣纸：比现在的 #F4EFE5 再暖一度、略沉 */
--surface:   #FBF7EE   /* 纸面：卡片/浮层 */
--text:      #1F1B16   /* 墨：正文 */
--muted:     #6A6055   /* 淡墨：次要信息 */
--line:      #D6C9B2   /* 界格线：偏暖的褐灰，不用纯灰 */
--line-soft: #E7DDCA   /* 更淡的第二档线（表格内分隔） */
--primary:   #23332F   /* 松墨绿：主按钮底 */
--accent:    #9E3226   /* 朱砂：强调、当前项、印章 */
--gold:      #8A6A3C   /* 泥金：分隔线两端、序号 */
--wash:      #E8DECB   /* 淡底：标签/表头 */
--nav-bg:    #F2EBDD
```

### 字体

```
--font-serif: "Songti SC", "Source Han Serif SC", "Noto Serif SC", "SimSun", serif;
--font-sans:  -apple-system, "PingFang SC", "HarmonyOS Sans SC", "MiSans", "Microsoft YaHei", sans-serif;
```

规则（必须写进提示词，否则 Codex 会到处用衬线）：

- **标题、数字、干支、星曜名** → 宋体（`--font-serif`），字重 500，`letter-spacing: .06em`～`.14em`。
- **正文段落、按钮、表单** → 黑体（`--font-sans`）。长文用宋体会糊。
- 干支/十二地支这类**两字一组**的，可以用 `letter-spacing: .2em` 模拟碑刻的疏朗感，
  但**不要**真去下载篆书字体（授权、体积、渲染都是坑）。

### 形状与线

```
--radius: 2px;          /* 现在 4px，压到 2px 更「刻」 */
--shadow: none;         /* 一律不用投影，靠线与底色分层 */
--hair: 1px solid var(--line);
```

新增两类「界格」：

- **双线框**：外 1px `--line`，内缩 3px 再 1px `--line-soft`。用在 section 容器、
  四柱表外框、十二宫盘外框。这是宋刻本最典型的做法。
- **角花**：四角各一个 6×6 的直角折线（SVG 或 `::before/::after` 边框拼接），
  只给「重点卡」（今日干支、结论卡）用，不要全站铺。

### 纹样（这是「更有古风」的主要来源，且必须是 SVG）

要 Codex 手写 SVG，**不要**让他去找图床或引外链：

1. `ornaments/huiwen.svg` — 回纹（雷纹），做分隔线的两端、页脚收边。8×8 重复单元。
2. `ornaments/yunwen.svg` — 云纹，首页 hero 底部一条极淡的横向纹样（`opacity: .12`）。
3. `ornaments/jiaohua.svg` — 角花，四角折线。
4. `ornaments/yin.svg` — 朱砂方印（阳文两字，如「命」「盘」），36×36，用在关键卡右上角。

约束：**单色描边**（`stroke: currentColor`，`fill: none`），尺寸 ≤ 2KB，
用 `<svg><use href="#...">` 引到一个 sprite 里，别每个页面内联一份。

### 纸纹（可选，但很出效果）

纯 CSS，不要位图：

```css
body::before {
  content: "";
  position: fixed; inset: 0; pointer-events: none; z-index: 1;
  background-image:
    radial-gradient(circle at 20% 10%, rgba(255,255,255,.55), transparent 55%),
    radial-gradient(circle at 80% 90%, rgba(180,160,120,.10), transparent 60%);
  mix-blend-mode: multiply;
  opacity: .5;
}
```

要更细的纤维感就再加一层 1px 的 `repeating-linear-gradient`，
但**必须 `< 0.04` 透明度**，否则截图会看到摩尔纹。

---

## 三、给 Codex 的提示词（可直接粘）

### 3.1 用 pair 走（推荐，因为要复审）

```
pair 开始：把 design/miniprogram 的 13 屏改成「宋刻本 / 线装书」古风，只动视觉层

范围与硬约束：
1) 只改 design/miniprogram/tokens.css、app.css、frame.css，以及新增
   design/miniprogram/ornaments.css 与 design/miniprogram/ornaments/*.svg。
2) 不许改任何 .html 的 DOM 结构、id、class 命名、文案；不许改任何 *-data.js。
   现有 #empty / #error / #content 的显隐逻辑必须原样可用。
3) 目标读者是在手机上看长文与表格的人，装饰不能压过内容。
   四柱表、十二宫盘、关系列表这三处的可读性优先于任何装饰。
4) 现在这套已经通过 scripts/verify_acceptance.py（AC01–AC15），
   改完必须仍然 exit 0，且 check_design 13 屏 390x844 无新问题。

视觉规格（照做，不要自由发挥）：
- 色彩用我给的这一套（宣纸 #F2EBDD / 纸面 #FBF7EE / 墨 #1F1B16 / 界格 #D6C9B2 /
  松墨绿 #23332F / 朱砂 #9E3226 / 泥金 #8A6A3C），替换 tokens.css 里的现有值。
- 标题、干支、星曜名、数字用宋体；正文段落、按钮、表单用黑体。
  干支两字用 letter-spacing .2em。
- --radius 收到 2px，全站去掉 box-shadow。
- section 容器、四柱表、十二宫盘改用「双线框」：外 1px --line，内缩 3px 再 1px --line-soft。
- 新增四个 SVG 纹样（回纹 / 云纹 / 角花 / 朱砂方印），单色描边、fill:none、
  每个 ≤2KB、合成一个 sprite 用 <use> 引；只用在分隔线两端、首页 hero 底部、
  重点卡四角、重点卡右上角，不要全站铺。
- 纸纹用纯 CSS（两层 radial-gradient + 可选 1px 细纹），透明度全部 < 0.12，
  不许引入任何位图。
- 不许出现：渐变按钮、圆角大卡片堆叠、彩色 emoji、外链字体、外链图片。

验收：
- node scripts/crosscheck_wmt_chart.cjs 差异 0
- node scripts/verify_ziwei_engine.cjs 全过
- & $py scripts/verify_acceptance.py exit 0（后端 16 / Node 31 / 交付物 26）
- check_design 13 屏无新增问题（尤其：文字截断、对比度、固定栏压内容）
```

### 3.2 只想先看一屏（快写，不复审）

```
pair 快写：只改 design/miniprogram/home.html 的视觉，做成「宋刻本」古风给我看效果

只要一屏，不要动其它 12 页，也不要动 tokens.css（先在 home.html 的 <style> 里覆盖）。
给三套配色各做一版，用 CSS 变量切换，我挑一版再推广。

约束：
- 不动 DOM 结构与 id（home-data.js / home-recent.js 依赖它们）。
- 装饰只用 SVG 与 CSS，不引外链、不用位图、不用投影。
- 「今日」「快捷入口」「最近解读」三块的信息层级保持不变。
```

---

## 四、关于「图」：Codex 出不了位图，要分清两件事

你要的「图」有三种，做法完全不同：

| 要什么 | 谁做 | 怎么做 |
|---|---|---|
| 纹样（回纹、云纹、角花、印章） | **Codex 直接写 SVG** | 提示词里明确「单色描边、fill:none、≤2KB、sprite」 |
| 页面本身的界面设计稿 | **Codex 改 HTML/CSS** | 就是上面那段提示词 |
| 水墨山纹 / 绢本质地 / hero 插画 | **图像生成模型**（Codex 不做这个） | 见下面 4.1 的提示词，出图后放 `design/miniprogram/assets/` |

### 4.1 如果要一张 hero 背景图，给图像模型的提示词模板

（中文可，英文更稳；关键是把「留白」和「不要字」说死）

> 中国传统水墨山水横幅，极简，远山淡墨三层，留白占画面 70%，
> 米黄宣纸底（#F2EBDD），无任何文字、无印章、无人物、无边框，
> 笔触克制，适合作为手机界面顶部背景，正中区域留空以便叠加文字。
> 输出 1125×600，PNG。

负面词（一定要给）：`文字, 印章, 书法, 人物, 建筑, 彩色, 高饱和, 渐变光晕, 水印, 边框`

出图后：压到 80KB 以内、转 WebP、放 `design/miniprogram/assets/hero-ink.webp`，
在 CSS 里 `opacity: .18; mix-blend-mode: multiply;`，**不要**直接铺满当底图。

### 4.2 提醒一句

真做小程序时，`<img>` 走的是小程序自己的资源包；这份 `design/miniprogram` 是网页形态的设计稿，
图片放同目录、用相对路径引，两边都能跑。别用 `background-image: url("https://...")`。

---

## 五、我会盯的三个风险

1. **装饰抢内容**：四柱表、十二宫盘这两处一旦加框加纹，12 个格子会变得拥挤。
   建议这两处只加外框，格子内部保持现在的极简。
2. **深底反白**：如果选 B 方向，正文在深檀底上要 ≥ 7:1 对比度；
   现在 `--muted: #6A6055` 在深底上会糊掉，必须另配一套深底 token。
3. **宋体渲染**：Android 上 `Songti SC` 没有，会退到 `SimSun`（更细），
   小字号会显得虚弱。所以正文一律黑体，只有 ≥18px 的标题用宋体。

---

## 六、顺序建议

1. 先跑 3.2 的快写版，只看首页，十分钟内能看到效果、能改方向。
2. 方向定了，再跑 3.1 的全量版（走 pair，有复审）。
3. 全量版落地后，再决定要不要 4.1 那张 hero 图——**先做 CSS/SVG 能做的**，
   位图最后加，加不加都不影响结构。
