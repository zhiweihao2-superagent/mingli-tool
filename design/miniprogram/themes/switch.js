// 主题切换（仅用于预览与演示，不改变默认主题）
//
// 三套：原纸（songke，默认，tokens.css 里 @import）、符箓（fuyao）、青绿绢本（qinglv）。
// 道观（daoguan）已下线，文件还在 themes/daoguan.css，但不登记就选不到。
//
// 用法：在地址后面加 ?theme=fuyao 或 ?theme=qinglv 就能换；「我的 · 设置」里点也行。
// 不带参数时按上次选的走，从没选过就是 tokens.css 里 @import 的那套（原纸）。
//
// 原理：tokens.css 第一行 @import 主题文件，这里再往 <head> 末尾插一个 <link>，
// 同优先级下后加载的覆盖先加载的，所以不用改 tokens.css 也能临时换色。
(function () {
  "use strict";

  var THEMES = { songke: "原纸", qinglv: "青绿绢本", fuyao: "符箓" };
  var KEY = "mingli.theme.v1";
  var DEFAULT = "songke";

  function current() {
    var fromQuery = null;
    try {
      fromQuery = new URLSearchParams(location.search).get("theme");
    } catch (e) {
      fromQuery = null;
    }
    if (fromQuery && THEMES[fromQuery]) return fromQuery;
    try {
      var stored = localStorage.getItem(KEY);
      if (stored && THEMES[stored]) return stored;
    } catch (e) {
      /* 隐私模式下拿不到 localStorage，用默认值即可 */
    }
    return DEFAULT;
  }

  var name = current();
  try {
    localStorage.setItem(KEY, name);
  } catch (e) {
    /* 存不下就不存，不影响显示 */
  }

  // 给页面一个可读的标记，方便截图与排错（默认主题也标，下面才判断要不要插 link）
  document.documentElement.setAttribute("data-theme", name);

  // 默认主题已经在 tokens.css 里 @import 进来，不必重复插一遍
  if (name === DEFAULT) return;

  var link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "themes/" + name + ".css";
  link.setAttribute("data-theme", name);
  document.head.appendChild(link);
})();
