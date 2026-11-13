/* 主题引导（lab2 / D 盘面）
 *
 * 作用：按当前页面的主题名，在 <head> 末尾补一个覆盖样式的 <link>。
 *       覆盖样式只在 :root/选择器上改颜色，不改结构、不改字号阶梯、不改间距。
 *
 * 主题名来源（按优先级）：
 *   1. <script src="themes/theme-boot.js" data-theme="xingtu">  的 data-theme
 *      —— 给 iframe srcdoc / 无法带查询串的场合用
 *   2. location.search 的 ?theme=xingtu
 *      —— 给直链预览用；lab2 的 d-chart-*.html 目前没有引用本脚本，
 *         要让 ?theme= 在真页面上生效，得在页面 <head> 里加一行
 *         <script src="themes/theme-boot.js"></script>（本次交付不改那些页面）
 *   3. localStorage 的 mingli.lab2.theme.v1 —— 记住上次看的
 *
 * 插 <link> 而不是改 d-chart.css：d-chart.css 一行不动，主题全部是后加载的同层覆盖。
 * 三套主题互不依赖：每套都完整给出 --paper/--ink/--zhu/--faint 与全部硬编码点，
 * 换主题不需要先卸载上一套。
 */
(function () {
  "use strict";

  var THEMES = ["xuanji", "fuyao", "xingtu"];
  var KEY = "mingli.lab2.theme.v1";

  function valid(name) {
    return typeof name === "string" && THEMES.indexOf(name) !== -1;
  }

  function fromScript() {
    var s = document.currentScript;
    if (!s) return null;
    var v = s.getAttribute("data-theme");
    return valid(v) ? v : null;
  }

  function fromQuery() {
    try {
      var params = new URLSearchParams(location.search);
      if (!params.has("theme")) return null;
      var v = params.get("theme");
      return valid(v) ? v : "";   // 显式给了但不认识：空串 = 不挂主题（原纸色）
    } catch (e) {
      return null;
    }
  }

  function fromStore() {
    try {
      var v = localStorage.getItem(KEY);
      return valid(v) ? v : null;
    } catch (e) {
      return null;
    }
  }

  var fromScriptName = fromScript();
  var fromQueryName = fromQuery();   // null = 没给；"" = 给了但不认识
  var name;
  if (fromScriptName) {
    name = fromScriptName;
  } else if (fromQueryName === "") {
    name = null;                     // ?theme=bogus：明确不认识，就别套用记住的那套
  } else if (fromQueryName) {
    name = fromQueryName;
  } else {
    name = fromStore();
  }
  if (!name) return; // 无主题 = 原纸色 D 盘面，什么都不插

  try {
    localStorage.setItem(KEY, name);
  } catch (e) {
    /* 隐私模式存不下就不存，不影响显示 */
  }

  // 给截图 / 排查用：html[data-theme] 能直接看出当前挂的是哪套
  document.documentElement.setAttribute("data-theme", name);

  var link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "themes/" + name + ".css";
  link.setAttribute("data-theme", name);
  document.head.appendChild(link);
})();
