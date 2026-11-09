// 记录页：列出本机生成过的解读报告，点进去看全文。
(function () {
  "use strict";

  var REPORTS = "mingli.reports.v1";
  var entries = document.getElementById("entries");
  var empty = document.getElementById("empty");

  function esc(text) {
    return String(text == null ? "" : text).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function when(iso) {
    var date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    var p = function (n) { return String(n).padStart(2, "0"); };
    return (date.getMonth() + 1) + " 月 " + date.getDate() + " 日 " + p(date.getHours()) + ":" + p(date.getMinutes());
  }

  function markOf(system) {
    var text = String(system || "");
    if (text.indexOf("紫微") >= 0) return "紫";
    if (text.indexOf("合盘") >= 0) return "合";
    if (text.indexOf("年度") >= 0 || /^\d{4}/.test(text)) return "年";
    return "八";
  }

  var list = [];
  try {
    list = JSON.parse(localStorage.getItem(REPORTS) || "[]");
  } catch (e) {
    list = [];
  }

  if (!list.length) {
    // 兼容旧数据：只有「最近一份」时也列出来
    try {
      var latest = JSON.parse(localStorage.getItem("mingli.report.v1") || "null");
      if (latest && (latest.sections || []).length) {
        latest.id = latest.id || "latest";
        list = [latest];
      }
    } catch (e) { /* 忽略 */ }
  }

  if (!list.length) {
    empty.hidden = false;
    return;
  }

  entries.innerHTML = list.map(function (report) {
    var topics = (report.sections || []).length;
    var evidence = (report.audit && report.audit.evidenceCount) || 0;
    var failed = (report.failed || []).length;
    return '<li><a href="report.html?id=' + encodeURIComponent(report.id) + '">' +
      '<span class="e-mark">' + esc(markOf(report.system)) + "</span>" +
      '<span class="e-txt">' +
      '<span class="e-line"><b>' + esc(report.title || "解读报告") + "</b><span>" + esc(when(report.createdAt)) + "</span></span>" +
      '<span class="e-meta">' + topics + " 个主题 · 证据 " + evidence + " 条" +
      (failed ? " · " + failed + " 批已跳过" : "") + "</span>" +
      "</span>" +
      '<span class="e-chev"><svg class="ico"><use href="#i-chev"/></svg></span>' +
      "</a></li>";
  }).join("");
})();
