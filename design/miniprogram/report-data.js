// 报告页：把 AI 生成并保存的报告整份展示出来，可存成长图或复制全文。
(function () {
  "use strict";

  var STORE = "mingli.report.v1";
  var empty = document.getElementById("empty");
  var wrap = document.getElementById("report");
  var actions = document.getElementById("actions");
  var toast = document.getElementById("toast");

  function esc(text) {
    return String(text == null ? "" : text).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function load() {
    var id = null;
    try { id = new URLSearchParams(location.search).get("id"); } catch (e) { id = null; }
    try {
      if (id) {
        var list = JSON.parse(localStorage.getItem("mingli.reports.v1") || "[]");
        var hit = list.filter(function (item) { return item.id === id; })[0];
        if (hit) return hit;
      }
      var raw = localStorage.getItem(STORE);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function when(iso) {
    var date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    var p = function (n) { return String(n).padStart(2, "0"); };
    return date.getFullYear() + "-" + p(date.getMonth() + 1) + "-" + p(date.getDate()) + " " + p(date.getHours()) + ":" + p(date.getMinutes());
  }

  function plainText(report) {
    var lines = [report.title || "解读报告", ""];
    (report.sections || []).forEach(function (section, index) {
      lines.push((index + 1) + ". " + (section.title || section.topic));
      if (section.oneLineSummary) lines.push("   " + section.oneLineSummary);
      if (section.plainLanguage) lines.push("   " + section.plainLanguage);
      (section.practicalAdvice || []).forEach(function (item) { lines.push("   · " + item); });
      if (section.reflectionQuestion) lines.push("   自我核对：" + section.reflectionQuestion);
      lines.push("");
    });
    if ((report.limitations || []).length) {
      lines.push("资料边界");
      report.limitations.forEach(function (item) { lines.push(" · " + item); });
    }
    lines.push("");
    lines.push("传统文化学习与娱乐参考，不构成医疗、法律、投资或其他现实决策建议。");
    return lines.join("\n");
  }

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

  function render(report) {
    document.getElementById("title").textContent = report.title || "解读报告";
    document.getElementById("meta").textContent = [
      report.system ? report.system + "体系" : "",
      (report.sections || []).length + " 个主题",
      report.audit && report.audit.evidenceCount ? "证据 " + report.audit.evidenceCount + " 条" : "",
      when(report.createdAt)
    ].filter(Boolean).join(" · ");

    document.getElementById("sections").innerHTML = (report.sections || []).map(function (section) {
      var advice = (section.practicalAdvice || []).map(function (item) { return "<li>" + esc(item) + "</li>"; }).join("");
      return '<section class="section">' +
        "<h2>" + esc(section.title || section.topic) + "</h2>" +
        (section.oneLineSummary ? '<p class="lead">' + esc(section.oneLineSummary) + "</p>" : "") +
        "<p>" + esc(section.plainLanguage || "") + "</p>" +
        (advice ? '<ul class="advice">' + advice + "</ul>" : "") +
        (section.reflectionQuestion ? '<p class="ask">自我核对：' + esc(section.reflectionQuestion) + "</p>" : "") +
        "</section>";
    }).join("");

    var rawLimits = (report.limitations || []).slice();
    (report.failed || []).forEach(function (item) {
      rawLimits.push("这一批主题未能通过校验，已跳过：" + (item.topics || []).join("、") + "（" + (item.reason || "") + "）");
    });
    var picked = window.MingliLimits
      ? window.MingliLimits.pick(rawLimits, 3)
      : { head: rawLimits.slice(0, 3), rest: rawLimits.slice(3), total: rawLimits.length };
    document.getElementById("limits").hidden = picked.total === 0;
    document.getElementById("limit-list").innerHTML =
      picked.head.map(function (item) { return "<li>" + esc(item) + "</li>"; }).join("");
    var more = document.getElementById("limit-more");
    if (more) {
      more.hidden = picked.rest.length === 0;
      more.open = false;
      more.querySelector("summary").textContent = "还有 " + picked.rest.length + " 条方法与资料说明";
      more.querySelector("ul").innerHTML = picked.rest.map(function (item) { return "<li>" + esc(item) + "</li>"; }).join("");
    }

    document.getElementById("foot").textContent =
      "传统文化学习与娱乐参考，不构成医疗、法律、投资或其他现实决策建议。报告由本机服务调用模型生成，输出经服务端复核，只存在这台设备上。";
  }

  var report = load();
  if (!report || !(report.sections || []).length) {
    empty.hidden = false;
  } else {
    wrap.hidden = false;
    actions.hidden = false;
    render(report);

    document.getElementById("copy").addEventListener("click", async function () {
      try {
        await navigator.clipboard.writeText(plainText(report));
        toast.hidden = false;
        toast.textContent = "已复制全文，可粘贴到备忘录。";
      } catch (e) {
        toast.hidden = false;
        toast.textContent = "浏览器不允许自动复制，长按选择正文复制即可。";
      }
    });

    document.getElementById("save").addEventListener("click", async function () {
      var button = this;
      button.disabled = true;
      button.textContent = "正在生成图片…";
      try {
        var result = await window.MingliReportImage.download(toRecord(report));
        toast.hidden = false;
        toast.textContent = result.ok
          ? "已保存 " + result.name + (result.width ? "（" + result.width + "×" + result.height + "）" : "")
          : (result.reason || "导出失败");
      } catch (err) {
        toast.hidden = false;
        toast.textContent = "导出失败：" + (err && err.message ? err.message : err);
      } finally {
        button.disabled = false;
        button.innerHTML = "存成长图";
      }
    });
  }
})();
