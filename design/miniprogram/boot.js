// 资源自愈：公网隧道偶发把某个脚本抓成 502，页面就会以为「功能没加载」。
// 这里只做一件事：发现某个必需脚本的全局对象不在，就把它重新拉一次，拉不到再如实报错。
// 不改变任何业务逻辑，也不猜测数据。
(function (global) {
  "use strict";

  var LOADING = {};

  function loadOnce(src) {
    if (LOADING[src]) return LOADING[src];
    LOADING[src] = new Promise(function (resolve) {
      var el = document.createElement("script");
      el.src = src;
      el.onload = function () { resolve(true); };
      el.onerror = function () { resolve(false); };
      document.head.appendChild(el);
    });
    return LOADING[src];
  }

  // specs: [{ ready: () => boolean, src: "vendor/x.js" }]
  // 返回 Promise<{ok, missing: string[]}>
  function ensure(specs) {
    var list = Array.isArray(specs) ? specs : [];
    var missing = list.filter(function (spec) {
      try {
        return !spec.ready();
      } catch (e) {
        return true;
      }
    });
    if (!missing.length) return Promise.resolve({ ok: true, missing: [] });
    return missing.reduce(function (chain, spec) {
      return chain.then(function () { return loadOnce(spec.src); });
    }, Promise.resolve()).then(function () {
      var stillMissing = list.filter(function (spec) {
        try {
          return !spec.ready();
        } catch (e) {
          return true;
        }
      });
      return { ok: stillMissing.length === 0, missing: stillMissing.map(function (s) { return s.src; }) };
    });
  }

  // 紫微页需要的三个引擎脚本（顺序有依赖：iztro → facts → adapter）
  function ensureChart() {
    return ensure([
      { src: "vendor/iztro-v2.6.2.min.js", ready: function () { return !!(global.iztro && global.iztro.astro); } },
      { src: "vendor/ziwei-facts.js", ready: function () { return !!(global.MingliZiweiFacts && global.MingliZiweiFacts.build); } },
      { src: "vendor/ziwei-adapter.js", ready: function () { return !!(global.MingliZiwei && global.MingliZiwei.calculate); } }
    ]);
  }

  global.MingliBoot = Object.freeze({ ensure: ensure, loadOnce: loadOnce, ensureChart: ensureChart });
}(typeof window !== "undefined" ? window : globalThis));
