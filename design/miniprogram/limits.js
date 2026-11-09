// 「资料边界」整理：把模型和引擎给的边界条目去重、分档，只把最关键的几条摆在前面。
// 用户在意的不是「有多少条」，而是「这份报告回答什么、不回答什么」。
(function (global) {
  "use strict";

  // 传输/分批造成的边界：对读者没有意义，直接丢掉
  var NOISE = /本批|本主题|传输|分批|本合同|本报告不涉及本批/;
  // 方法学层面的：确实是限制，但不该占头条
  var METHOD = /规则档案|阈值|流派|门派|口径|简表|刊本|一家之言|未裁定|候选|未量化|未加权|枚举/;
  // 读者最需要知道的：这份报告不回答什么
  var SCOPE = /不构成|不回答|不涉及|无法判断|不能判断|不判断|仅供参考|不替代|不作/;

  function clean(list) {
    var seen = {};
    var out = [];
    (list || []).forEach(function (raw) {
      var text = String(raw == null ? "" : raw).replace(/\s+/g, " ").trim();
      if (!text || NOISE.test(text)) return;
      if (seen[text]) return;
      seen[text] = true;
      out.push(text);
    });
    return out;
  }

  function rank(item) {
    if (SCOPE.test(item)) return 0;
    if (METHOD.test(item)) return 2;
    return 1;
  }

  // 返回 { head: 前三四条, rest: 其余, total }
  function pick(list, headSize) {
    var limit = headSize || 3;
    var items = clean(list);
    var sorted = items
      .map(function (text, index) { return { text: text, score: rank(text), index: index }; })
      .sort(function (a, b) { return a.score - b.score || a.index - b.index; })
      .map(function (entry) { return entry.text; });
    return { head: sorted.slice(0, limit), rest: sorted.slice(limit), total: sorted.length };
  }

  global.MingliLimits = Object.freeze({ pick: pick, clean: clean });
})(typeof window !== "undefined" ? window : globalThis);
