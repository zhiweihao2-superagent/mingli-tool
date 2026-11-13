// 小程序设计稿的主题体系：颜色只允许住在 themes/*.css 里。
//
// 这套测试守四件事：
//   1. tokens.css 第一行选主题，且只放结构变量（字体、字号、间距、圆角、骨架高度）
//   2. 三套主题各自提供同一组颜色变量，一个不缺
//   3. 13 屏 HTML 与 app/frame/ornaments 里不再有硬编码色（否则换主题会花）
//   4. 按变量算出来的正文/次要文字对比度过线（深底主题最容易翻车）
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DIR = path.join(ROOT, "design", "miniprogram");
const THEME_DIR = path.join(DIR, "themes");

let assertionCount = 0;
function ok(condition, message) {
  if (!condition) {
    console.error("FAIL:", message);
    process.exitCode = 1;
    throw new Error(message);
  }
  assertionCount += 1;
}
function eq(actual, expected, message) {
  ok(actual === expected, `${message}（实际 ${JSON.stringify(actual)}，期望 ${JSON.stringify(expected)}）`);
}

function read(rel) {
  return fs.readFileSync(path.join(DIR, rel), "utf8");
}

// 三套对外主题（原纸 / 青绿绢本 / 符箓）。道观（daoguan）已下线：
// 文件还在 themes/daoguan.css，但 switch.js 不登记就选不到，这里也不再要求它齐全。
const THEMES = ["songke", "qinglv", "fuyao"];

// 三套必须齐全的颜色变量。少一个就会掉回浏览器默认色（白底黑字），换主题等于没换。
const COLOR_VARS = [
  "bg", "surface", "surface-2", "text", "muted", "line", "line-soft",
  "primary", "primary-ink", "accent", "accent-ink", "gold", "on", "link",
  "wash", "wash-deep", "nav-bg", "shadow-color", "art-ink", "art-sun",
];

// 结构变量：与配色无关，留在 tokens.css。
const STRUCTURE_VARS = [
  "font-sans", "font-serif", "w-head", "fs-micro", "fs-meta", "fs-body",
  "fs-h3", "fs-h1", "fs-num", "space-1", "space-2", "space-3", "space-4",
  "space-5", "space-6", "space-7", "gutter", "radius", "radius-pill",
  "shadow", "hair", "status-h", "nav-h", "tab-h", "home-bar",
];

function varsOf(css) {
  const found = {};
  const re = /--([a-z0-9-]+)\s*:\s*([^;]+);/gi;
  let m;
  while ((m = re.exec(css))) found[m[1]] = m[2].trim();
  return found;
}

function parseHex(value) {
  const m = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(rgb) {
  const f = (v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
}

function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

// ── 1. tokens.css 只选主题，不藏颜色 ─────────────────────────
{
  const css = read("tokens.css");
  const lines = css.split(/\r?\n/);
  const importLine = lines.find((line) => line.trim().startsWith("@import"));
  ok(typeof importLine === "string", "tokens.css 应该有一行 @import 选主题");
  eq(importLine.trim(), '@import "./themes/songke.css";', "默认主题应该是宋刻本（首行导入 songke）");
  eq(lines[0].trim(), importLine.trim(), "@import 必须是第一行（后面再导入会晚于变量定义生效）");

  const vars = varsOf(css);
  for (const name of STRUCTURE_VARS) {
    ok(name in vars, `tokens.css 应该保留结构变量 --${name}`);
  }
  // 颜色不能留在 tokens.css，否则换主题改不动。
  for (const name of COLOR_VARS) {
    ok(!(name in vars), `tokens.css 不应该定义颜色变量 --${name}（它属于主题文件）`);
  }
  const hardcoded = css.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi) || [];
  eq(hardcoded.length, 0, "tokens.css 里不应该有硬编码颜色");
}

// ── 2. 三套主题变量齐全，且都是真颜色 ───────────────────────
for (const name of THEMES) {
  const file = path.join("themes", `${name}.css`);
  ok(fs.existsSync(path.join(DIR, file)), `主题文件应该存在：${file}`);
  const vars = varsOf(read(file));
  for (const v of COLOR_VARS) {
    ok(v in vars, `${name} 缺少颜色变量 --${v}`);
  }
  // 正文与底色必须是能算对比度的十六进制；带透明度的值在这里说明写错了。
  for (const v of ["bg", "surface", "text", "muted", "primary", "primary-ink", "accent", "accent-ink", "art-ink", "art-sun"]) {
    ok(parseHex(vars[v]) !== null, `${name} 的 --${v} 应该是 #RRGGBB（实际 ${vars[v]}）`);
  }
  eq((read(file).match(/#[0-9a-f]{3}\b/gi) || []).length, 0, `${name} 不应该用三位缩写色值（读起来容易错）`);
}

// ── 3. 对比度：正文 ≥ 7:1，次要文字 ≥ 4.5:1 ─────────────────
{
  const thresholds = { songke: [7, 4.5], qinglv: [7, 4.5], fuyao: [7, 4.5] };
  for (const name of THEMES) {
    const vars = varsOf(read(path.join("themes", `${name}.css`)));
    const bg = parseHex(vars.bg);
    const surface = parseHex(vars.surface);
    const text = parseHex(vars.text);
    const muted = parseHex(vars.muted);
    const [textMin, mutedMin] = thresholds[name];

    const textOnBg = contrast(text, bg);
    const textOnSurface = contrast(text, surface);
    const mutedOnBg = contrast(muted, bg);
    const mutedOnSurface = contrast(muted, surface);

    ok(textOnBg >= textMin, `${name} 正文/页面底 对比度 ${textOnBg.toFixed(2)}:1，应 ≥ ${textMin}:1`);
    ok(textOnSurface >= textMin, `${name} 正文/卡片面 对比度 ${textOnSurface.toFixed(2)}:1，应 ≥ ${textMin}:1`);
    ok(mutedOnBg >= mutedMin, `${name} 次要文字/页面底 对比度 ${mutedOnBg.toFixed(2)}:1，应 ≥ ${mutedMin}:1`);
    ok(mutedOnSurface >= mutedMin, `${name} 次要文字/卡片面 对比度 ${mutedOnSurface.toFixed(2)}:1，应 ≥ ${mutedMin}:1`);

    // 按钮上的字：色块与其上的墨色也必须过线，否则按钮像空框。
    const primaryInk = contrast(parseHex(vars["primary-ink"]), parseHex(vars.primary));
    const accentInk = contrast(parseHex(vars["accent-ink"]), parseHex(vars.accent));
    ok(primaryInk >= 4.5, `${name} 主按钮字对比度 ${primaryInk.toFixed(2)}:1，应 ≥ 4.5:1`);
    ok(accentInk >= 4.5, `${name} 强调按钮字对比度 ${accentInk.toFixed(2)}:1，应 ≥ 4.5:1`);
  }
}

// ── 4. 13 屏 HTML 与公共 CSS 里不许再有硬编码色 ─────────────
{
  // 遮罩层是中性黑，深浅主题共用，不算主题色。
  const ALLOWED = [/rgba\(0,\s*0,\s*0,\s*\.\d+\)/];
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".html"))
    .concat(["app.css", "frame.css", "ornaments.css"]);

  const offenders = [];
  for (const f of files) {
    const css = read(f);
    // 只看样式块与内联 style 属性，正文里的 # 号（如「#3」）不算。
    const styleBlocks = (css.match(/<style[\s\S]*?<\/style>/gi) || []).join("\n");
    const styleAttrs = (css.match(/style="[^"]*"/gi) || []).join("\n");
    const svgAttrs = (css.match(/(?:fill|stroke|stop-color)="[^"]*"/gi) || []).join("\n");
    const scope = f.endsWith(".html") ? [styleBlocks, styleAttrs, svgAttrs] : [css];
    for (const chunk of scope) {
      const hits = chunk.match(/#[0-9a-f]{3,8}\b|rgba?\(\s*\d+[^)]*\)/gi) || [];
      for (const hit of hits) {
        if (ALLOWED.some((re) => re.test(hit))) continue;
        offenders.push(`${f}: ${hit}`);
      }
    }
  }
  eq(offenders.length, 0, `这些地方还写死了颜色，换主题会花：${offenders.slice(0, 6).join(" / ")}`);
}

// ── 5. 覆盖层必须存在：内嵌 styles 的旧规则要被后加载层压住 ──
{
  const frame = read("frame.css");
  ok(/option\s*\{[^}]*background:\s*var\(--surface\)/.test(frame), "frame.css 应该给 option 指定底色（原生下拉是系统画的）");
  ok(/option\s*\{[^}]*color:\s*var\(--text\)/.test(frame), "frame.css 应该给 option 指定字色");
  ok(/\.btn-ghost\s*\{[^}]*color:\s*var\(--text\)/.test(frame), "frame.css 应该让 .btn-ghost 用正文色，而不是主按钮的墨色");
  ok(/\.btn:not\(\.btn-ghost\)/.test(frame), "主按钮的墨色只应作用于非 ghost 按钮");

  const ornaments = read("ornaments.css");
  ok(/body::before/.test(ornaments), "纹样层应该挂在 body::before 上，不进入内容流");
  ok(!/\.pillars[^{]*\{[^}]*background-image/.test(ornaments), "四柱表格内部不应该铺纹样");
}

// ── 5b. 纹样：一个文件一条，能被 CSS mask 引用 ──────────────
{
  const dir = path.join(DIR, "ornaments");
  const all = fs.readdirSync(dir).filter((f) => f.endsWith(".svg")).sort();
  // 三张遮罩用的横纹 + 上一版留下的四张旧花纹（没被任何文件引用，保留备用）
  const MASK_MOTIFS = ["cloud.svg", "mountain.svg", "thunder.svg"];
  const LEGACY = ["huiwen.svg", "jiaohua.svg", "yin.svg", "yunwen.svg"];
  for (const f of MASK_MOTIFS) {
    ok(all.includes(f), `纹样应该存在：${f}`);
  }
  const stale = all.filter((f) => !MASK_MOTIFS.includes(f) && !LEGACY.includes(f));
  eq(stale.join(","), "", `ornaments/ 里出现了没登记的图：${stale.join(",")}`);

  for (const f of MASK_MOTIFS) {
    const svg = fs.readFileSync(path.join(dir, f), "utf8");
    ok(svg.startsWith("<svg"), `${f} 应该是纯 SVG 文件`);
    ok(/fill="none"/.test(svg), `${f} 应该是描边纹样（fill="none"）`);
    ok(/stroke="#fff"/.test(svg), `${f} 的描边应为白色——CSS mask 只看 alpha，用 #fff 最稳`);
    ok(!svg.includes("currentColor"), `${f} 不能用 currentColor（mask 里会变成实心块）`);
    ok(!svg.includes("<symbol") && !svg.includes("<view "), `${f} 不能是 sprite（mask-image 引用 #id 不生效）`);
    ok(Buffer.byteLength(svg, "utf8") <= 2048, `${f} 应该 ≤ 2KB（实际 ${Buffer.byteLength(svg, "utf8")} B）`);
    ok(!/#[0-9a-f]{3,8}\b/i.test(svg.replace('stroke="#fff"', "").replace('fill="none"', "")), `${f} 不该带自己的颜色（颜色由 CSS 给）`);
  }
  // 三套主题各引用自己那条，且指向真实文件。
  // 只有「换掉首页大图下沿那条横纹」的主题才在这里登记。
  // 符箓故意沿用默认的 cloud.svg：云雷纹是密排带状纹，压到 18px 只剩一条实心墨杠，
  // 所以它把云雷纹改挂在页头下沿与底栏上沿（见 themes/fuyao.css 的 .mp-nav::after）。
  const map = { songke: "cloud", qinglv: "mountain" };
  for (const [theme, motif] of Object.entries(map)) {
    const css = read(path.join("themes", `${theme}.css`));
    ok(css.includes(`../ornaments/${motif}.svg`), `${theme}.css 应该引用 ${motif}.svg`);
    ok(!css.includes("motifs.svg"), `${theme}.css 不应再引用旧的 motifs.svg sprite`);
  }
  // 遮罩必须写在 ::after 上并且是 repeat-x，否则只看得到 120px 一小段。
  for (const cssFile of ["ornaments.css", ...Object.keys(map).map((t) => path.join("themes", `${t}.css`))]) {
    const css = read(cssFile);
    if (!css.includes("mask-image")) continue;
    const block = css.slice(Math.max(0, css.indexOf(".hero::after") - 200), css.indexOf(".hero::after") + 600);
    ok(/hero::after/.test(block), `${cssFile} 的遮罩应该挂在 .hero::after 上`);
    ok(/-webkit-mask-image/.test(block), `${cssFile} 需要 -webkit-mask-image 兜底`);
  }
}

// ── 6. 主题说明要写清怎么切、有哪些变量 ─────────────────────
{
  const p = path.join(THEME_DIR, "README.md");
  ok(fs.existsSync(p), "themes/README.md 应该存在");
  const doc = fs.readFileSync(p, "utf8");
  ok(/tokens\.css/.test(doc), "说明里要写清切换位置是 tokens.css");
  for (const name of THEMES) {
    ok(doc.includes(`${name}.css`), `说明里应该列出 ${name}.css`);
  }
  for (const v of ["--bg", "--text", "--primary-ink", "--art-ink"]) {
    ok(doc.includes(v), `说明里应该解释变量 ${v}`);
  }
  ok(!/\?{4,}/.test(doc), "说明文件不应有乱码（PowerShell 写中文的老坑）");
  ok(doc.length > 600, `说明文件太短了（${doc.length} 字符），应该是真写清楚了`);
  ok(/theme=/.test(doc), "说明里应该写清预览时怎么用 URL 参数切主题");
}

// ── 7. 预览切换脚本：13 屏都挂上，且只认白名单里的名字 ──────
{
  const switcher = path.join(THEME_DIR, "switch.js");
  ok(fs.existsSync(switcher), "themes/switch.js 应该存在（预览时用 ?theme= 切）");
  const js = fs.readFileSync(switcher, "utf8");
  for (const name of THEMES) {
    ok(js.includes(name), `switch.js 应该认得 ${name} 这个名字`);
  }
  eq(/THEMES\[/.test(js), true, "switch.js 应该按白名单校验，不能拿参数直接拼路径");

  // index.html 是设计索引（列出 13 屏 + 13 张设计稿），本身不是一屏，不算进来。
  const screens = fs.readdirSync(DIR).filter((f) => f.endsWith(".html") && f !== "index.html");
  eq(screens.length, 13, "设计稿应该有 13 屏");
  for (const f of screens) {
    const html = read(f);
    ok(html.includes('src="themes/switch.js"'), `${f} 应该引入 themes/switch.js`);
    // 必须早于其它脚本，否则首屏会先按默认主题画一遍再跳色
    const switchAt = html.indexOf('src="themes/switch.js"');
    const firstOther = html.search(/<script src="(?!themes\/switch\.js)/);
    ok(firstOther === -1 || switchAt < firstOther, `${f} 里 switch.js 应该在其它脚本之前加载`);
  }

  // 「我的」页要能直接点着换，否则别人拿到链接只能改代码。
  const me = read("me.html");
  for (const name of THEMES) {
    ok(me.includes(`me.html?theme=${name}`), `me.html 应该有切到 ${name} 的入口`);
  }
  eq((me.match(/class="theme-opt"/g) || []).length, 3, "设置里的主题应该正好三档");
  // 「当前」高亮：app.css 要给对外这三套各配一条，缺一条那档就点不出反馈。
  const appCss = read("app.css");
  for (const name of THEMES) {
    ok(appCss.includes(`html[data-theme="${name}"] .theme-opt[data-name="${name}"]`),
      `app.css 应该给 ${name} 标出「当前」`);
  }
  ok(!/data-name="daoguan"/.test(me), "me.html 不该再留道观的入口（已下线）");
}

console.log(`Mini program theme checks passed. ${assertionCount} 项全部通过`);
