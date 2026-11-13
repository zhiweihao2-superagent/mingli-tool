// 首页「最近解读」：读本机真实存过的解读记录（和记录页同一个键），
// 没有就如实说「还没有」，不摆假条目。
// 数据来源：ai.js 的 save() 写入 mingli.reports.v1（新的在前，最多 12 条）。
(function () {
  "use strict";

  var REPORTS = "mingli.reports.v1";
  var LATEST = "mingli.report.v1";
  var LIMIT = 3;

  var listEl = document.getElementById("recent-list");
  var noteEl = document.getElementById("recent-note");
  if (!listEl) return;

  function esc(text) {
    return String(text == null ? "" : text).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  // 和记录页保持同一套标记，用户在两个页面看到的是同一件事
  function markOf(system) {
    var text = String(system || "");
    if (text.indexOf("紫微") >= 0) return "紫";
    if (text.indexOf("合盘") >= 0) return "合";
    if (text.indexOf("流月") >= 0) return "月";
    if (text.indexOf("流日") >= 0) return "日";
    if (text.indexOf("流年") >= 0 || /^\d{4}/.test(text)) return "年";
    return "八";
  }

  function when(iso) {
    var date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    return (date.getMonth() + 1) + " 月 " + date.getDate() + " 日";
  }

  function read() {
    var list = [];
    try {
      list = JSON.parse(localStorage.getItem(REPORTS) || "[]");
    } catch (e) {
      list = [];
    }
    if (!Array.isArray(list)) list = [];
    // 兼容只有「最近一份」的旧数据
    if (!list.length) {
      try {
        var latest = JSON.parse(localStorage.getItem(LATEST) || "null");
        if (latest && (latest.sections || []).length) {
          latest.id = latest.id || "latest";
          list = [latest];
        }
      } catch (e) { /* 忽略 */ }
    }
    return list
      .filter(function (report) { return report && (report.sections || []).length; })
      .slice()
      .sort(function (a, b) {
        return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
      });
  }

  var list = read();

  if (!list.length) {
    if (noteEl) noteEl.hidden = false;
    listEl.hidden = true;
    return;
  }

  listEl.innerHTML = list.slice(0, LIMIT).map(function (report) {
    var topics = (report.sections || []).length;
    var kind = report.systemLabel || report.system || "命盘";
    return '<li><a href="report.html?id=' + encodeURIComponent(report.id) + '">' +
      '<span class="r-mark">' + esc(markOf(report.system)) + "</span>" +
      '<span class="r-txt"><b>' + esc(report.title || "解读报告") + "</b>" +
      '<span class="meta">' + esc(when(report.createdAt)) +
      (when(report.createdAt) ? " · " : "") + esc(kind) +
      " · " + topics + " 个主题</span></span>" +
      '<span class="chev"><svg class="ico"><use href="#i-chev"/></svg></span></a></li>';
  }).join("");

  listEl.hidden = false;
  if (noteEl) noteEl.hidden = true;
})();
