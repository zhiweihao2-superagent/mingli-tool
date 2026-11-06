// 报告库：把已经生成过的解读报告留在本机浏览器里，随时能翻出来看。
// 只存模型输出与校验后的引用，不存出生资料，也不发回服务端。
// 任何一步失败都降级——报告库坏了不能挡住排盘和生成。
(function (global) {
  "use strict";

  const SCHEMA = "mingli.reports/v1";
  const STORAGE_KEY = "mingli.reports.v1";
  const STORAGE_VERSION = 1;
  const MAX_RECORDS = 8;

  function storage() {
    try {
      if (!global.localStorage) return null;
      const probe = "__mingli_reports_probe__";
      global.localStorage.setItem(probe, "1");
      global.localStorage.removeItem(probe);
      return global.localStorage;
    } catch (error) {
      return null;
    }
  }

  function empty(reason) {
    return { available: Boolean(storage()), records: [], reason: reason || null };
  }

  function readAll() {
    const store = storage();
    if (!store) return empty("本机浏览器不允许写入本地存储。");
    let raw = null;
    try {
      raw = store.getItem(STORAGE_KEY);
    } catch (error) {
      return empty("读取本地存储失败。");
    }
    if (!raw) return { available: true, records: [], reason: null };
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      return { available: true, records: [], corrupt: true, reason: "本地报告记录已损坏，已按空处理。" };
    }
    if (!parsed || parsed.schema !== SCHEMA || parsed.version !== STORAGE_VERSION || !Array.isArray(parsed.records)) {
      return { available: true, records: [], corrupt: true, reason: "本地报告记录版本不符，已按空处理。" };
    }
    const records = parsed.records.filter(isRecord);
    return { available: true, records, reason: null };
  }

  function isRecord(item) {
    return Boolean(item) && typeof item.id === "string" && Array.isArray(item.sections);
  }

  function fingerprintOf(input) {
    const system = String(input?.system || "");
    const requirement = String(input?.requirementId || "");
    const topics = Array.isArray(input?.sections)
      ? input.sections.map(section => String(section?.topic || "")).join(",")
      : "";
    return `${system}|${requirement}|${topics}`;
  }

  function trim(value, limit) {
    const text = typeof value === "string" ? value : value == null ? "" : String(value);
    if (!limit || text.length <= limit) return text;
    return `${text.slice(0, limit)}…`;
  }

  function normalizeSection(section) {
    return {
      topic: String(section?.topic || ""),
      title: String(section?.title || ""),
      oneLineSummary: trim(section?.oneLineSummary, 200),
      plainLanguage: trim(section?.plainLanguage, 4000),
      evidenceExplanation: trim(section?.evidenceExplanation, 2000),
      practicalAdvice: Array.isArray(section?.practicalAdvice)
        ? section.practicalAdvice.map(item => trim(item, 400))
        : [],
      reflectionQuestion: trim(section?.reflectionQuestion, 400),
      evidencePaths: Array.isArray(section?.evidencePaths) ? section.evidencePaths.map(String) : [],
      knowledgeCitations: Array.isArray(section?.knowledgeCitations) ? section.knowledgeCitations.map(String) : [],
    };
  }

  function normalize(input) {
    const sections = Array.isArray(input?.sections) ? input.sections.map(normalizeSection) : [];
    const summary = input?.summary || {};
    return {
      schema: SCHEMA,
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      system: String(input?.system || ""),
      systemLabel: String(input?.systemLabel || ""),
      requirementId: String(input?.requirementId || ""),
      title: String(input?.title || ""),
      fingerprint: fingerprintOf({ ...input, sections }),
      summary: {
        plainLanguage: trim(summary.plainLanguage, 1200),
        evidencePaths: Array.isArray(summary.evidencePaths) ? summary.evidencePaths.map(String) : [],
        confidence: String(summary.confidence || ""),
      },
      sections,
      audit: input?.audit ? { status: String(input.audit.status || ""), evidenceCount: Number(input.audit.evidenceCount) || 0 } : null,
    };
  }

  function save(input) {
    const record = normalize(input);
    if (!record.sections.length) return { ok: false, reason: "报告里没有可保存的主题。" };
    const store = storage();
    if (!store) return { ok: false, reason: "本机浏览器不允许写入本地存储，报告只在当前页面可见。" };
    const current = readAll();
    const kept = current.records.filter(item => item.fingerprint !== record.fingerprint);
    const records = [record, ...kept].slice(0, MAX_RECORDS);
    try {
      store.setItem(STORAGE_KEY, JSON.stringify({ schema: SCHEMA, version: STORAGE_VERSION, records }));
    } catch (error) {
      return { ok: false, reason: "写入本地存储失败，报告只在当前页面可见。" };
    }
    return { ok: true, record, count: records.length };
  }

  function list() {
    return readAll();
  }

  function find(id) {
    return readAll().records.find(item => item.id === id) || null;
  }

  function remove(id) {
    const store = storage();
    if (!store) return { ok: false, reason: "本机浏览器不允许写入本地存储。" };
    const current = readAll();
    const records = current.records.filter(item => item.id !== id);
    try {
      store.setItem(STORAGE_KEY, JSON.stringify({ schema: SCHEMA, version: STORAGE_VERSION, records }));
    } catch (error) {
      return { ok: false, reason: "写入本地存储失败。" };
    }
    return { ok: true, count: records.length };
  }

  function clear() {
    const store = storage();
    if (!store) return { ok: false, reason: "本机浏览器不允许写入本地存储。" };
    try {
      store.removeItem(STORAGE_KEY);
    } catch (error) {
      return { ok: false, reason: "清除本地记录失败。" };
    }
    return { ok: true, count: 0 };
  }

  global.MingliReportArchive = Object.freeze({
    SCHEMA,
    STORAGE_KEY,
    STORAGE_VERSION,
    MAX_RECORDS,
    save,
    list,
    find,
    remove,
    clear,
    fingerprintOf,
  });
})(typeof window !== "undefined" ? window : globalThis);
