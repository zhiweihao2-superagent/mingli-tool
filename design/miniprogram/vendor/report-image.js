// 报告出图：把解读报告画成一张 PNG（纯 Canvas 2D，无第三方库、不发请求）。
// 布局与绘制分离：layoutReport 只依赖一个 measure 函数，便于在 node 里用桩测量做回归。
(function (global) {
  "use strict";

  const SCHEMA = "mingli.report-image/v1";
  const DISCLAIMER = "传统文化学习与娱乐参考，不构成医疗、法律、投资或其他现实决策建议。";

  const THEME = {
    width: 1080,
    scale: 2,
    pad: 72,
    paper: "#faf7f2",
    ink: "#221d17",
    inkSoft: "#5c5147",
    inkFaint: "#8b8076",
    accent: "#8a5a2b",
    accentSoft: "#b98a52",
    card: "#ffffff",
    cardWarm: "#f6efe3",
    rule: "#e3d9c9",
    fonts: '"Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Source Han Sans SC", sans-serif',
  };

  function text(value) {
    return typeof value === "string" ? value : value == null ? "" : String(value);
  }

  function list(value) {
    return Array.isArray(value) ? value.filter(item => text(item).trim()) : [];
  }

  function font(size, weight) {
    return `${weight || 400} ${size}px ${THEME.fonts}`;
  }

  // 中文按字断行，英文按词优先；全部走 measure，不猜字宽。
  function wrapLine(value, maxWidth, measure) {
    const source = text(value).replace(/\s+/g, " ").trim();
    if (!source) return [];
    const lines = [];
    let current = "";
    const tokens = source.match(/[A-Za-z0-9_\-./:@#%+=]+|\s|[\s\S]/g) || [];
    for (const token of tokens) {
      const next = current + token;
      if (current && measure(next) > maxWidth) {
        lines.push(current.trimEnd());
        current = token === " " ? "" : token;
      } else {
        current = next;
      }
      // 单个 token 本身就超宽（长串英文/路径）时强制切开
      while (measure(current) > maxWidth && current.length > 1) {
        let cut = current.length - 1;
        while (cut > 1 && measure(current.slice(0, cut)) > maxWidth) cut -= 1;
        lines.push(current.slice(0, cut));
        current = current.slice(cut);
      }
    }
    if (current.trim()) lines.push(current.trimEnd());
    return applyLineBreaksRules(lines);
  }

  // 中文排版禁则：行首不能是收尾标点，行尾不能是开引号/开括号。
  const NO_LINE_START = "，。、；：？！）》」』”’%,.;:?!)]}…";
  const NO_LINE_END = "（《「『“‘([{";

  function applyLineBreaksRules(lines) {
    for (let i = 1; i < lines.length; i += 1) {
      let guard = 0;
      while (lines[i] && lines[i].length && NO_LINE_START.includes(lines[i][0]) && guard < 3) {
        lines[i - 1] += lines[i][0];
        lines[i] = lines[i].slice(1);
        guard += 1;
      }
      guard = 0;
      while (lines[i] && lines[i - 1] && lines[i - 1].length > 1
        && NO_LINE_END.includes(lines[i - 1].slice(-1)) && guard < 3) {
        const last = lines[i - 1].slice(-1);
        lines[i - 1] = lines[i - 1].slice(0, -1);
        lines[i] = last + lines[i];
        guard += 1;
      }
    }
    return lines.filter((line, index) => line.trim() || index === 0);
  }

  function layoutReport(record, measure, options) {
    const opts = options || {};
    const width = THEME.width;
    const pad = THEME.pad;
    const contentWidth = width - pad * 2;
    const items = [];
    let y = pad;

    const push = item => items.push(item);

    function textBlock(value, { size = 26, weight = 400, color = THEME.inkSoft, lineHeight = 1.62, gap = 14, maxWidth = contentWidth } = {}) {
      if (!text(value).trim()) return;
      const f = font(size, weight);
      const lines = wrapLine(value, maxWidth, s => measure(s, f));
      lines.forEach((line, index) => {
        push({ kind: "text", text: line, x: pad, y: y + size, font: f, color, size });
        y += Math.round(size * lineHeight);
        if (index === lines.length - 1) y += 0;
      });
      y += gap;
    }

    function bullets(values, { size = 25, color = THEME.ink, gap = 10 } = {}) {
      const items2 = list(values);
      if (!items2.length) return;
      const f = font(size, 400);
      for (const value of items2) {
        const lines = wrapLine(value, contentWidth - 34, s => measure(s, f));
        lines.forEach((line, index) => {
          if (index === 0) push({ kind: "dot", x: pad + 6, y: y + size - 9, color: THEME.accentSoft });
          push({ kind: "text", text: line, x: pad + 30, y: y + size, font: f, color, size });
          y += Math.round(size * 1.55);
        });
      }
      y += gap;
    }

    // ---- 页头 ----
    const label = record.systemLabel || record.system || "命理";
    const title = record.title || `${label}解读报告`;
    const titleFont = font(56, 700);
    wrapLine(title, contentWidth, s => measure(s, titleFont)).forEach(line => {
      push({ kind: "text", text: line, x: pad, y: y + 56, font: titleFont, color: THEME.ink, size: 56 });
      y += 74;
    });
    y += 4;

    const metaBits = [];
    if (record.systemLabel) metaBits.push(`体系 ${record.systemLabel}`);
    if (record.sections && record.sections.length) metaBits.push(`${record.sections.length} 个主题`);
    if (record.audit && record.audit.evidenceCount) metaBits.push(`${record.audit.evidenceCount} 条证据引用`);
    if (record.createdAt) {
      const when = new Date(record.createdAt);
      if (!Number.isNaN(when.getTime())) {
        const p = n => String(n).padStart(2, "0");
        metaBits.push(`${when.getFullYear()}-${p(when.getMonth() + 1)}-${p(when.getDate())} ${p(when.getHours())}:${p(when.getMinutes())}`);
      }
    }
    if (metaBits.length) {
      const metaFont = font(24, 400);
      push({ kind: "text", text: metaBits.join(" · "), x: pad, y: y + 24, font: metaFont, color: THEME.inkFaint, size: 24 });
      y += 24 + 26;
    }

    push({ kind: "rule", x: pad, y, width: contentWidth, color: THEME.rule });
    y += 40;

    // ---- 摘要卡 ----
    if (record.summary && text(record.summary.plainLanguage).trim()) {
      const summaryFont = font(28, 400);
      const lines = wrapLine(record.summary.plainLanguage, contentWidth - 72, s => measure(s, summaryFont));
      const headH = 30;
      const bodyH = lines.length * Math.round(28 * 1.68);
      const cardH = 46 + headH + 18 + bodyH + 46;
      push({ kind: "card", x: pad, y, width: contentWidth, height: cardH, fill: THEME.cardWarm });
      push({ kind: "text", text: "先看这里", x: pad + 36, y: y + 46 + 24, font: font(26, 700), color: THEME.accent, size: 26 });
      let sy = y + 46 + headH + 18;
      lines.forEach(line => {
        push({ kind: "text", text: line, x: pad + 36, y: sy + 28, font: summaryFont, color: THEME.ink, size: 28 });
        sy += Math.round(28 * 1.68);
      });
      y += cardH + 48;
    }

    // ---- 主题小节 ----
    const sections = Array.isArray(record.sections) ? record.sections : [];
    sections.forEach((section, index) => {
      const headFont = font(36, 700);
      const oneLineFont = font(26, 500);
      const bodyFont = font(26, 400);
      const smallFont = font(22, 400);

      const bodyLines = wrapLine(section.plainLanguage, contentWidth - 72, s => measure(s, bodyFont));
      const oneLineLines = wrapLine(section.oneLineSummary, contentWidth - 72, s => measure(s, oneLineFont));
      const advice = list(section.practicalAdvice);
      const adviceLines = [];
      advice.forEach(item => {
        wrapLine(item, contentWidth - 72 - 34, s => measure(s, bodyFont)).forEach(line => adviceLines.push(line));
      });
      const evidence = list(section.evidencePaths);
      const evidenceLines = evidence.slice(0, 6);
      const citations = list(section.knowledgeCitations);
      const reflectionText = text(section.reflectionQuestion).trim();
      const reflectionLines = reflectionText
        ? wrapLine(`自我核对：${reflectionText}`, contentWidth - 72 - 8, s => measure(s, smallFont))
        : [];

      const innerTop = 44;
      let h = innerTop;
      const headLines = wrapLine(`${index + 1}. ${section.title || section.topic || "主题"}`, contentWidth - 72, s => measure(s, headFont));
      h += headLines.length * 48 + 14;
      if (oneLineLines.length) h += oneLineLines.length * 40 + 14;
      if (bodyLines.length) h += bodyLines.length * 42 + 18;
      if (adviceLines.length) h += adviceLines.length * 38 + 18;
      if (reflectionLines.length) h += reflectionLines.length * 34 + 14;
      if (evidenceLines.length) h += 34 + evidenceLines.length * 30 + 12;
      if (citations.length) h += 34;
      h += 30;

      push({ kind: "card", x: pad, y, width: contentWidth, height: h, fill: THEME.card, border: THEME.rule });
      let cy = y + innerTop;
      headLines.forEach(line => {
        push({ kind: "text", text: line, x: pad + 36, y: cy + 36, font: headFont, color: THEME.ink, size: 36 });
        cy += 48;
      });
      cy += 14;
      oneLineLines.forEach(line => {
        push({ kind: "text", text: line, x: pad + 36, y: cy + 26, font: oneLineFont, color: THEME.accent, size: 26 });
        cy += 40;
      });
      if (oneLineLines.length) cy += 14;
      bodyLines.forEach(line => {
        push({ kind: "text", text: line, x: pad + 36, y: cy + 26, font: bodyFont, color: THEME.ink, size: 26 });
        cy += 42;
      });
      if (bodyLines.length) cy += 18;

      if (adviceLines.length) {
        push({ kind: "text", text: "可以怎么做", x: pad + 36, y: cy + 24, font: font(24, 700), color: THEME.inkSoft, size: 24 });
        cy += 34;
        let lineIndex = 0;
        advice.forEach(item => {
          const wrapped = wrapLine(item, contentWidth - 72 - 34, s => measure(s, bodyFont));
          wrapped.forEach((line, i) => {
            if (i === 0) push({ kind: "dot", x: pad + 42, y: cy + 26 - 9, color: THEME.accentSoft });
            push({ kind: "text", text: line, x: pad + 66, y: cy + 26, font: bodyFont, color: THEME.ink, size: 26 });
            cy += 38;
            lineIndex += 1;
          });
        });
        cy += 18;
      }

      reflectionLines.forEach(line => {
        push({ kind: "text", text: line, x: pad + 36, y: cy + 22, font: smallFont, color: THEME.inkFaint, size: 22 });
        cy += 34;
      });
      if (reflectionLines.length) cy += 14;

      if (evidenceLines.length) {
        push({ kind: "text", text: `盘面依据 ${evidence.length} 条`, x: pad + 36, y: cy + 22, font: font(22, 700), color: THEME.inkSoft, size: 22 });
        cy += 34;
        evidenceLines.forEach(path => {
          push({ kind: "text", text: `· ${path}`, x: pad + 40, y: cy + 20, font: font(20, 400), color: THEME.inkFaint, size: 20 });
          cy += 30;
        });
        cy += 12;
      }
      if (citations.length) {
        push({ kind: "text", text: `引用 ${citations.slice(0, 4).join("、")}`, x: pad + 36, y: cy + 22, font: smallFont, color: THEME.inkFaint, size: 22 });
      }
      y += h + 40;
    });

    // ---- 资料边界 ----
    const limits = list(record.limitations);
    if (limits.length) {
      push({ kind: "text", text: "资料边界", x: pad, y: y + 26, font: font(26, 700), color: THEME.inkSoft, size: 26 });
      y += 44;
      bullets(limits, { size: 23, color: THEME.inkSoft, gap: 6 });
    }

    // ---- 页脚 ----
    y += 8;
    push({ kind: "rule", x: pad, y, width: contentWidth, color: THEME.rule });
    y += 30;
    const footFont = font(21, 400);
    wrapLine(DISCLAIMER, contentWidth, s => measure(s, footFont)).forEach(line => {
      push({ kind: "text", text: line, x: pad, y: y + 21, font: footFont, color: THEME.inkFaint, size: 21 });
      y += 32;
    });
    push({ kind: "text", text: "本机命理工具生成 · 排盘与解读只保存在这台机器", x: pad, y: y + 21, font: footFont, color: THEME.inkFaint, size: 21 });
    y += 21;

    return { schema: SCHEMA, width, height: Math.round(y + pad), items };
  }

  function roundRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function paint(ctx, layout) {
    ctx.save();
    ctx.fillStyle = THEME.paper;
    ctx.fillRect(0, 0, layout.width, layout.height);
    ctx.textBaseline = "alphabetic";
    for (const item of layout.items) {
      if (item.kind === "rule") {
        ctx.fillStyle = item.color;
        ctx.fillRect(item.x, item.y, item.width, 1);
      } else if (item.kind === "card") {
        ctx.fillStyle = item.fill;
        roundRect(ctx, item.x, item.y, item.width, item.height, 22);
        ctx.fill();
        if (item.border) {
          ctx.strokeStyle = item.border;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      } else if (item.kind === "dot") {
        ctx.fillStyle = item.color;
        ctx.beginPath();
        ctx.arc(item.x, item.y + 4, 4, 0, Math.PI * 2);
        ctx.fill();
      } else if (item.kind === "text") {
        ctx.fillStyle = item.color;
        ctx.font = item.font;
        ctx.fillText(item.text, item.x, item.y);
      }
    }
    ctx.restore();
    return layout;
  }

  function measureWith(ctx) {
    return (value, f) => {
      ctx.font = f;
      return ctx.measureText(value).width;
    };
  }

  function render(record, options) {
    const opts = options || {};
    const doc = opts.document || global.document;
    if (!doc || typeof doc.createElement !== "function") return { ok: false, reason: "当前环境无法创建画布。" };
    const scale = opts.scale || THEME.scale;
    const probe = doc.createElement("canvas").getContext("2d");
    if (!probe) return { ok: false, reason: "当前浏览器不支持 Canvas 2D。" };
    const layout = layoutReport(record, measureWith(probe), opts);
    const canvas = doc.createElement("canvas");
    canvas.width = layout.width * scale;
    canvas.height = layout.height * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { ok: false, reason: "当前浏览器不支持 Canvas 2D。" };
    ctx.scale(scale, scale);
    paint(ctx, layout);
    return { ok: true, canvas, layout, scale };
  }

  function safeFilePart(value, fallback) {
    const cleaned = text(value).replace(/[\\/:*?"<>|\s]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    return cleaned.slice(0, 40) || fallback;
  }

  function filename(record) {
    const now = new Date();
    const p = n => String(n).padStart(2, "0");
    const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
    return `命理工具-${safeFilePart(record && (record.systemLabel || record.system), "命理")}-${stamp}.png`;
  }

  function download(record, options) {
    if (!record) return { ok: false, reason: "还没有可导出的报告。" };
    const opts = options || {};
    const doc = opts.document || global.document;
    const made = render(record, opts);
    if (!made.ok) return made;
    const name = filename(record);
    if (typeof made.canvas.toBlob !== "function") {
      return { ok: false, reason: "当前浏览器不支持导出 PNG。" };
    }
    return new Promise(resolve => {
      made.canvas.toBlob(blob => {
        if (!blob) {
          resolve({ ok: false, reason: "生成图片失败，请重试。" });
          return;
        }
        let url = "";
        try {
          url = global.URL.createObjectURL(blob);
          const link = doc.createElement("a");
          link.href = url;
          link.download = name;
          link.rel = "noopener";
          link.style.display = "none";
          doc.body.appendChild(link);
          link.click();
          link.remove();
          resolve({ ok: true, name, width: made.canvas.width, height: made.canvas.height });
        } catch (error) {
          resolve({ ok: false, reason: `导出失败：${error && error.message ? error.message : error}` });
        } finally {
          if (url) {
            setTimeout(() => {
              try { global.URL.revokeObjectURL(url); } catch (error) { /* 忽略 */ }
            }, 4000);
          }
        }
      }, "image/png");
    });
  }

  global.MingliReportImage = Object.freeze({
    SCHEMA,
    THEME,
    layoutReport,
    paint,
    render,
    download,
    filename,
    wrapLine,
  });
})(typeof window !== "undefined" ? window : globalThis);
