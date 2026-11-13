// 记录页：列出本机生成过的解读报告，点进去看全文。
(function () {
  "use strict";

  var REPORTS = "mingli.reports.v1";
  var entries = document.getElementById("entries");
  var empty = document.getElementById("empty");

  function hasProfiles() {
    try {
      if (window.MingliProfile && window.MingliProfile.list) return (window.MingliProfile.list() || []).length > 0;
      var raw = localStorage.getItem("mingli.profiles.v1");
      return !!(raw && JSON.parse(raw).length);
    } catch (e) { return false; }
  }

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
    var cta = empty.querySelector(".btn");
    if (cta) {
      if (hasProfiles()) {
        cta.textContent = "去命盘生成解读";
        cta.href = "bazi.html";
      } else {
        cta.textContent = "去填写出生信息";
        cta.href = "input.html";
      }
    }
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
      "</a>" +
      '<div class="entry-actions"><button type="button" class="save-report" data-id="' +
      esc(report.id) + '">存长图</button></div>' +
      "</li>";
  }).join("");

  function toRecord(report) {
    return {
      system: report.system || "",
      systemLabel: report.systemLabel || report.system || "命盘",
      title: report.title || "解读报告",
      createdAt: report.createdAt,
      summary: report.summary || {},
      sections: (report.sections || []).map(function (section) {
        return {
          topic: section.topic,
          title: section.title,
          oneLineSummary: section.oneLineSummary,
          plainLanguage: section.plainLanguage,
          evidenceExplanation: section.evidenceExplanation,
          practicalAdvice: section.practicalAdvice || [],
          reflectionQuestion: section.reflectionQuestion,
          evidencePaths: section.evidencePaths || [],
          knowledgeCitations: section.knowledgeCitations || []
        };
      }),
      limitations: report.limitations || [],
      audit: report.audit || null
    };
  }

  entries.addEventListener("click", function (event) {
    var button = event.target.closest ? event.target.closest(".save-report") : null;
    if (!button) return;
    event.preventDefault();
    var id = button.getAttribute("data-id");
    var report = list.filter(function (item) { return String(item.id) === String(id); })[0];
    if (!report) return;
    if (!window.MingliReportImage) {
      button.textContent = "出图模块未加载";
      setTimeout(function () { button.textContent = "存长图"; }, 1600);
      return;
    }
    var keep = "存长图";
    button.disabled = true;
    button.textContent = "正在出图…";
    Promise.resolve(window.MingliReportImage.download(toRecord(report))).then(function (result) {
      button.textContent = result && result.ok ? "已保存" : "导出失败";
    }).catch(function () {
      button.textContent = "导出失败";
    }).then(function () {
      setTimeout(function () { button.textContent = keep; button.disabled = false; }, 1800);
    });
  });
})();
