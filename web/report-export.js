// 报告导出：把生成好的解读报告保存成本机文件（Markdown / JSON）。
// 只处理浏览器里已有的报告记录，不发请求、不碰出生资料。
(function (global) {
  "use strict";

  const SCHEMA = "mingli.report-export/v1";
  const DISCLAIMER = "传统文化学习与娱乐参考，不构成医疗、法律、投资或其他现实决策建议。";

  function text(value) {
    return typeof value === "string" ? value : value == null ? "" : String(value);
  }

  function list(value) {
    return Array.isArray(value) ? value.filter(item => text(item).trim()) : [];
  }

  function stamp() {
    const now = new Date();
    const pad = number => String(number).padStart(2, "0");
    return {
      date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
      time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
      compact: `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`,
    };
  }

  // 和报告库同构：system / systemLabel / title / summary / sections / audit
  function recordFromResult(output, meta) {
    const info = meta || {};
    const clock = stamp();
    return {
      schema: SCHEMA,
      createdAt: new Date().toISOString(),
      system: text(info.system || ""),
      systemLabel: text(info.systemLabel || ""),
      requirementId: text(output?.requirementId || ""),
      title: text(info.title || `${text(info.systemLabel || "")}解读报告`),
      summary: {
        plainLanguage: text(output?.summary?.plainLanguage),
        evidencePaths: list(output?.summary?.evidencePaths),
        confidence: text(output?.summary?.confidence),
      },
      sections: list(output?.sections).map(section => ({
        topic: text(section?.topic),
        title: text(section?.title),
        oneLineSummary: text(section?.oneLineSummary),
        plainLanguage: text(section?.plainLanguage),
        evidenceExplanation: text(section?.evidenceExplanation),
        practicalAdvice: list(section?.practicalAdvice),
        reflectionQuestion: text(section?.reflectionQuestion),
        evidencePaths: list(section?.evidencePaths),
        knowledgeCitations: list(section?.knowledgeCitations),
      })),
      limitations: list(output?.limitations),
      audit: output?.audit
        ? { status: text(output.audit.status), evidenceCount: Number(output.audit.evidenceCount) || 0 }
        : null,
      exportedAt: `${clock.date} ${clock.time}`,
    };
  }

  function heading(record) {
    const label = record.systemLabel || record.system || "命理";
    return `${label}解读报告`;
  }

  function toMarkdown(record) {
    if (!record) return "";
    const lines = [];
    lines.push(`# ${record.title || heading(record)}`, "");

    const meta = [];
    if (record.systemLabel) meta.push(`- 体系：${record.systemLabel}`);
    if (record.sections?.length) meta.push(`- 主题数：${record.sections.length}`);
    if (record.audit?.evidenceCount) meta.push(`- 证据引用：${record.audit.evidenceCount} 条（校验 ${record.audit.status || "—"}）`);
    if (record.requirementId) meta.push(`- 报告编号：${record.requirementId}`);
    if (record.createdAt) {
      const when = new Date(record.createdAt);
      const stampText = Number.isNaN(when.getTime())
        ? record.createdAt
        : `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, "0")}-${String(when.getDate()).padStart(2, "0")} ${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`;
      meta.push(`- 生成时间：${stampText}`);
    }
    lines.push(...meta, "");

    if (record.summary?.plainLanguage) {
      lines.push("## 先看这里", "", record.summary.plainLanguage, "");
      if (record.summary.confidence) lines.push(`- 置信度：${record.summary.confidence}`);
      if (record.summary.evidencePaths?.length) {
        lines.push("- 依据：", ...record.summary.evidencePaths.map(path => `  - \`${path}\``));
      }
      lines.push("");
    }

    const sections = record.sections || [];
    sections.forEach((section, index) => {
      lines.push(`## ${index + 1}. ${section.title || section.topic || `主题 ${index + 1}`}`, "");
      if (section.oneLineSummary) lines.push(`**一句话**：${section.oneLineSummary}`, "");
      if (section.plainLanguage) lines.push(section.plainLanguage, "");
      if (section.evidenceExplanation) lines.push(`**依据说明**：${section.evidenceExplanation}`, "");
      if (section.practicalAdvice?.length) {
        lines.push("**可以怎么做**", "", ...section.practicalAdvice.map(item => `- ${item}`), "");
      }
      if (section.reflectionQuestion) lines.push(`**自我核对**：${section.reflectionQuestion}`, "");
      if (section.evidencePaths?.length) {
        lines.push("<details><summary>盘面依据（" + section.evidencePaths.length + "）</summary>", "");
        lines.push(...section.evidencePaths.map(path => `- \`${path}\``), "", "</details>", "");
      }
      if (section.knowledgeCitations?.length) {
        lines.push(`**引用资料**：${section.knowledgeCitations.join("、")}`, "");
      }
    });

    if (record.limitations?.length) {
      lines.push("## 资料边界", "", ...record.limitations.map(item => `- ${item}`), "");
    }

    lines.push("---", "", `> ${DISCLAIMER}`, "");
    lines.push(`> 由本机命理工具生成（本地计算，报告只保存在这台机器的浏览器里）。`);
    return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
  }

  function toJson(record) {
    return JSON.stringify({ schema: SCHEMA, exportedAt: new Date().toISOString(), record }, null, 2);
  }

  function safeFilePart(value, fallback) {
    const cleaned = text(value).replace(/[\\/:*?"<>|\s]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    return cleaned.slice(0, 40) || fallback;
  }

  function filename(record, extension) {
    const clock = stamp();
    const label = safeFilePart(record?.systemLabel || record?.system, "命理");
    return `命理工具-${label}-${clock.compact}.${extension}`;
  }

  function saveBlob(name, content, mime) {
    if (!global.document || !global.URL || typeof global.Blob !== "function") {
      return { ok: false, reason: "当前环境不支持文件下载。" };
    }
    let url = "";
    try {
      const blob = new global.Blob([content], { type: mime });
      url = global.URL.createObjectURL(blob);
      const link = global.document.createElement("a");
      link.href = url;
      link.download = name;
      link.rel = "noopener";
      link.style.display = "none";
      global.document.body.appendChild(link);
      link.click();
      link.remove();
      return { ok: true, name };
    } catch (error) {
      return { ok: false, reason: `导出失败：${error?.message || error}` };
    } finally {
      if (url) {
        setTimeout(() => {
          try { global.URL.revokeObjectURL(url); } catch (error) { /* 忽略 */ }
        }, 4000);
      }
    }
  }

  // format: "md" | "json"
  function download(record, format) {
    if (!record) return { ok: false, reason: "还没有可导出的报告。" };
    const kind = String(format || "md").toLowerCase();
    if (kind === "json") {
      return saveBlob(filename(record, "json"), toJson(record), "application/json;charset=utf-8");
    }
    return saveBlob(filename(record, "md"), toMarkdown(record), "text/markdown;charset=utf-8");
  }

  global.MingliReportExport = Object.freeze({
    SCHEMA,
    DISCLAIMER,
    recordFromResult,
    toMarkdown,
    toJson,
    filename,
    download,
  });
})(typeof window !== "undefined" ? window : globalThis);
