// 盘面出图：把八字四柱 / 紫微十二宫画成一张可以分享的 PNG。
// 纯 Canvas 2D，不引第三方库；和小程序里「保存到相册」的做法一致。
(function (global) {
  "use strict";

  var W = 1080;
  var PAD = 72;
  var FONTS = '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif';
  var SERIF = '"Songti SC", "Noto Serif SC", "Source Han Serif SC", serif';
  var C = {
    paper: "#F4EFE5", ink: "#23201B", soft: "#6B6157", line: "#DCD2C1",
    primary: "#2A3C38", accent: "#A33A2B", on: "#F7F3EA", card: "#FBF8F2"
  };

  function font(size, weight, family) {
    return (weight || 400) + " " + size + "px " + (family || FONTS);
  }

  function roundRect(ctx, x, y, w, h, r) {
    var radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  function wrap(ctx, text, maxWidth) {
    var source = String(text == null ? "" : text).replace(/\s+/g, " ").trim();
    if (!source) return [];
    var lines = [];
    var line = "";
    for (var i = 0; i < source.length; i += 1) {
      var next = line + source[i];
      if (ctx.measureText(next).width > maxWidth && line) {
        lines.push(line);
        line = source[i];
      } else {
        line = next;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  function createCanvas(document, height) {
    var canvas = document.createElement("canvas");
    canvas.width = W * 2;
    canvas.height = height * 2;
    var ctx = canvas.getContext("2d");
    ctx.scale(2, 2);
    ctx.fillStyle = C.paper;
    ctx.fillRect(0, 0, W, height);
    return { canvas: canvas, ctx: ctx };
  }

  function header(ctx, title, subtitle) {
    ctx.fillStyle = C.ink;
    ctx.font = font(52, 700, SERIF);
    ctx.fillText(title, PAD, PAD + 46);
    ctx.font = font(24, 400);
    ctx.fillStyle = C.soft;
    ctx.fillText(subtitle, PAD, PAD + 86);
    ctx.fillStyle = C.line;
    ctx.fillRect(PAD, PAD + 112, W - PAD * 2, 1);
    return PAD + 152;
  }

  function footer(ctx, y) {
    ctx.fillStyle = C.line;
    ctx.fillRect(PAD, y, W - PAD * 2, 1);
    ctx.fillStyle = C.soft;
    ctx.font = font(22, 400);
    var lines = wrap(ctx, "传统文化学习与娱乐参考，不构成医疗、法律、投资或其他现实决策建议。本图由本机命理工具生成。", W - PAD * 2);
    lines.forEach(function (line, index) {
      ctx.fillText(line, PAD, y + 42 + index * 34);
    });
    return y + 42 + lines.length * 34;
  }

  // ── 八字盘面 ─────────────────────────────────────────
  function drawBazi(calc, meta) {
    var document = global.document;
    var height = 1180;
    var made = createCanvas(document, height);
    var ctx = made.ctx;

    var display = calc.calendar_display || {};
    var y = header(ctx, "八字命盘" + (meta && meta.name ? " · " + meta.name : ""), [
      display.solar || "", meta && meta.sex ? meta.sex : "", display.lunar || ""
    ].filter(Boolean).join(" · "));

    var order = ["year", "month", "day", "hour"];
    var names = { year: "年柱", month: "月柱", day: "日柱", hour: "时柱" };
    var colW = (W - PAD * 2) / 4;
    var rowH = 300;

    ctx.strokeStyle = C.line;
    ctx.strokeRect(PAD, y, W - PAD * 2, rowH);
    order.forEach(function (key, index) {
      var p = calc.pillars[key];
      var x = PAD + colW * index;
      if (index) {
        ctx.fillStyle = C.line;
        ctx.fillRect(x, y, 1, rowH);
      }
      var cx = x + colW / 2;
      ctx.textAlign = "center";
      ctx.fillStyle = key === "day" ? C.accent : C.soft;
      ctx.font = font(22, 400);
      ctx.fillText(p ? (p.ten_god || names[key]) : names[key], cx, y + 48);

      ctx.fillStyle = key === "day" ? C.accent : C.ink;
      ctx.font = font(74, 500, SERIF);
      ctx.fillText(p ? p.stem : "—", cx, y + 134);
      ctx.fillText(p ? p.branch : "—", cx, y + 212);

      ctx.fillStyle = C.soft;
      ctx.font = font(20, 400);
      var hides = p && p.hidden_stems ? p.hidden_stems : [];
      if (!hides.length) ctx.fillText(p ? "" : "时辰未知", cx, y + 250);
      hides.slice(0, 3).forEach(function (h, i) {
        ctx.fillText(h.stem + " " + (h.ten_god || ""), cx, y + 248 + i * 30);
      });
    });
    ctx.textAlign = "left";
    y += rowH + 56;

    // 大运
    ctx.fillStyle = C.ink;
    ctx.font = font(30, 500, SERIF);
    ctx.fillText("大运", PAD, y);
    var start = (calc.luck_cycles || {}).start || {};
    ctx.fillStyle = C.soft;
    ctx.font = font(22, 400);
    ctx.textAlign = "right";
    ctx.fillText(
      [start.years != null ? "起运 " + start.years + " 岁" + (start.months ? " " + start.months + " 个月" : "") : "",
        (calc.luck_cycles || {}).direction === "forward" ? "顺行" : "逆行"].filter(Boolean).join(" · "),
      W - PAD, y
    );
    ctx.textAlign = "left";
    y += 36;

    var cycles = ((calc.luck_cycles || {}).cycles || []).slice(0, 9);
    var gap = 6;
    var boxW = (W - PAD * 2 - gap * (cycles.length - 1)) / cycles.length;
    cycles.forEach(function (cycle, index) {
      var x = PAD + index * (boxW + gap);
      ctx.strokeStyle = C.line;
      ctx.strokeRect(x, y, boxW, 92);
      ctx.textAlign = "center";
      ctx.fillStyle = C.ink;
      ctx.font = font(24, 500, SERIF);
      var gz = String(cycle.ganzhi || "").replace("（小运）", "");
      ctx.fillText(gz, x + boxW / 2, y + 42);
      ctx.fillStyle = C.soft;
      ctx.font = font(15, 400);
      var age = String(cycle.age_range || "").replace("岁", "").replace("个月", "月");
      if (age.length > 8) age = age.slice(0, 8);
      ctx.fillText(age, x + boxW / 2, y + 70);
    });
    ctx.textAlign = "left";
    y += 96 + 60;

    // 五行与关系条数
    var facts = (meta && meta.facts) || {};
    var inv = (facts.element_inventory && facts.element_inventory.counts && facts.element_inventory.counts.hidden_stems) || {};
    var order5 = ["木", "火", "土", "金", "水"];
    var max = 1;
    order5.forEach(function (name) { max = Math.max(max, Number(inv[name] || 0)); });
    ctx.fillStyle = C.ink;
    ctx.font = font(30, 500, SERIF);
    ctx.fillText("五行（按藏干）", PAD, y);
    y += 30;
    order5.forEach(function (name, index) {
      var value = Number(inv[name] || 0);
      var barY = y + index * 40;
      ctx.fillStyle = C.soft;
      ctx.font = font(22, 400);
      ctx.fillText(name, PAD, barY + 20);
      ctx.fillStyle = "#E7DFD0";
      roundRect(ctx, PAD + 44, barY + 6, W - PAD * 2 - 100, 14, 7);
      ctx.fill();
      if (value > 0) {
        ctx.fillStyle = index === 2 ? C.accent : C.primary;
        roundRect(ctx, PAD + 44, barY + 6, (W - PAD * 2 - 100) * (value / max), 14, 7);
        ctx.fill();
      }
      ctx.fillStyle = C.soft;
      ctx.textAlign = "right";
      ctx.fillText(String(value), W - PAD, barY + 20);
      ctx.textAlign = "left";
    });
    y += order5.length * 40 + 40;

    footer(ctx, y);
    return made.canvas;
  }

  // ── 紫微盘面 ─────────────────────────────────────────
  function drawZiwei(chart, meta) {
    var document = global.document;
    var height = 1560;
    var made = createCanvas(document, height);
    var ctx = made.ctx;
    var a = chart.astrolabe || {};

    var y = header(ctx, "紫微命盘" + (meta && meta.name ? " · " + meta.name : ""), [
      a.solarDate || "", a.timeRange || "", a.gender || "", a.lunarDate || ""
    ].filter(Boolean).join(" · "));

    var palaces = chart.palaces || [];
    var slots = {
      "巳": 0, "午": 1, "未": 2, "申": 3,
      "辰": 4, "酉": 5, "卯": 6, "戌": 7,
      "寅": 8, "丑": 9, "子": 10, "亥": 11
    };
    var cells = new Array(12);
    palaces.forEach(function (palace) {
      var index = slots[palace.earthlyBranch];
      if (index != null) cells[index] = palace;
    });

    var cellW = (W - PAD * 2) / 4;
    var cellH = 116;
    var gridH = cellH * 4;

    // 先画外框与中宫
    ctx.strokeStyle = C.line;
    ctx.strokeRect(PAD, y, W - PAD * 2, gridH);
    ctx.fillStyle = C.card;
    ctx.fillRect(PAD + cellW, y + cellH, cellW * 2, cellH * 2);

    var positions = [
      [0, 0], [1, 0], [2, 0], [3, 0],
      [0, 1], [3, 1], [0, 2], [3, 2],
      [0, 3], [1, 3], [2, 3], [3, 3]
    ];

    cells.forEach(function (palace, index) {
      if (!palace) return;
      var pos = positions[index];
      var x = PAD + pos[0] * cellW;
      var cy = y + pos[1] * cellH;
      if (palace.name === "命宫") {
        ctx.fillStyle = "#EFE8DA";
        ctx.fillRect(x, cy, cellW, cellH);
      }
      ctx.strokeStyle = C.line;
      ctx.strokeRect(x, cy, cellW, cellH);

      var inner = x + 12;
      var maxW = cellW - 24;
      ctx.fillStyle = palace.name === "命宫" ? C.accent : C.soft;
      ctx.font = font(18, 400);
      ctx.fillText(String(palace.name || "").replace("宫", "") + " " + (palace.earthlyBranch || ""), inner, cy + 28);

      var majors = (palace.majorStars || []).map(function (s) {
        return s.name + (s.transformation ? "·" + s.transformation : "");
      }).join(" ");
      ctx.fillStyle = palace.name === "命宫" ? C.accent : C.ink;
      ctx.font = font(24, 500, SERIF);
      var lines = wrap(ctx, majors || "空宫", maxW).slice(0, 2);
      lines.forEach(function (line, i) { ctx.fillText(line, inner, cy + 58 + i * 26); });

      var minors = (palace.minorStars || []).map(function (s) { return s.name; }).join(" ");
      if (minors) {
        ctx.fillStyle = C.soft;
        ctx.font = font(16, 400);
        wrap(ctx, minors, maxW).slice(0, 2).forEach(function (line, i) {
          ctx.fillText(line, inner, cy + 92 + i * 18);
        });
      }
    });

    // 中宫信息
    var soul = palaces.filter(function (p) { return p.name === "命宫"; })[0] || {};
    var midX = PAD + cellW + 36;
    var midY = y + cellH + 54;
    ctx.fillStyle = C.ink;
    ctx.font = font(34, 500, SERIF);
    ctx.fillText((soul.heavenlyStem || "") + (soul.earthlyBranch || "") + " · " + (a.gender || ""), midX, midY);
    ctx.font = font(20, 400);
    ctx.fillStyle = C.soft;
    ctx.fillText("命主 " + (a.soul || "—") + " · 身主 " + (a.body || "—"), midX, midY + 40);
    ctx.fillText("五行局 " + (a.fiveElementsClass || "—"), midX, midY + 70);
    ctx.fillText("命宫 " + (soul.heavenlyStem || "") + (soul.earthlyBranch || ""), midX, midY + 100);

    var hua = [];
    palaces.forEach(function (palace) {
      (palace.majorStars || []).concat(palace.minorStars || []).forEach(function (star) {
        if (star.transformation) hua.push(star.name + star.transformation);
      });
    });
    ctx.fillStyle = C.accent;
    ctx.font = font(20, 400);
    hua.slice(0, 4).forEach(function (item, index) {
      ctx.fillText(item, midX + (index % 2) * 190, midY + 142 + Math.floor(index / 2) * 32);
    });

    y += gridH + 56;
    footer(ctx, y);
    return made.canvas;
  }

// ── 对照图（合盘）：左右两栏，逐行对比 ────────────────
  function drawCompare(options) {
    var document = global.document;
    var opts = options || {};
    var rows = opts.rows || [];
    var height = 760 + rows.length * 78;
    var made = createCanvas(document, height);
    var ctx = made.ctx;

    var y = header(ctx, opts.title || "对照", opts.subtitle || "");
    var midX = W / 2;
    var colW = (W - PAD * 2 - 48) / 2;
    var leftX = PAD;
    var rightX = PAD + colW + 48;

    // 两栏表头
    ctx.textAlign = "left";
    ctx.fillStyle = C.ink;
    ctx.font = font(34, 500, SERIF);
    ctx.fillText(String((opts.left && opts.left.name) || "一方"), leftX, y + 36);
    ctx.fillText(String((opts.right && opts.right.name) || "另一方"), rightX, y + 36);
    ctx.fillStyle = C.soft;
    ctx.font = font(20, 400);
    ctx.fillText(String((opts.left && opts.left.sub) || ""), leftX, y + 68);
    ctx.fillText(String((opts.right && opts.right.sub) || ""), rightX, y + 68);
    y += 96;

    ctx.fillStyle = C.line;
    ctx.fillRect(PAD, y, W - PAD * 2, 1);
    y += 30;

    rows.forEach(function (row) {
      ctx.fillStyle = C.soft;
      ctx.font = font(20, 400);
      ctx.fillText(String(row[0] || ""), PAD, y + 10);

      ctx.fillStyle = C.ink;
      ctx.font = font(30, 500, SERIF);
      var leftLines = wrap(ctx, String(row[1] == null ? "—" : row[1]), colW).slice(0, 2);
      var rightLines = wrap(ctx, String(row[2] == null ? "—" : row[2]), colW).slice(0, 2);
      leftLines.forEach(function (line, i) { ctx.fillText(line, leftX, y + 48 + i * 34); });
      rightLines.forEach(function (line, i) { ctx.fillText(line, rightX, y + 48 + i * 34); });

      y += Math.max(40 + leftLines.length * 34, 40 + rightLines.length * 34) + 22;
      ctx.fillStyle = C.line;
      ctx.fillRect(PAD, y - 24, W - PAD * 2, 1);
    });

    footer(ctx, y + 10);
    return made.canvas;
  }

  function save(canvas, filename) {
    return new Promise(function (resolve) {
      if (!canvas || typeof canvas.toBlob !== "function") {
        resolve({ ok: false, reason: "当前环境不支持导出图片" });
        return;
      }
      canvas.toBlob(function (blob) {
        if (!blob) { resolve({ ok: false, reason: "生成图片失败" }); return; }
        var url = URL.createObjectURL(blob);
        var link = document.createElement("a");
        link.href = url;
        link.download = filename;
        link.style.display = "none";
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) { /* 忽略 */ } }, 4000);
        resolve({ ok: true, name: filename, width: canvas.width, height: canvas.height });
      }, "image/png");
    });
  }

  function stamp() {
    var d = new Date();
    var p = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes());
  }

  global.MingliChartImage = Object.freeze({
    drawBazi: drawBazi,
    drawZiwei: drawZiwei,
    drawCompare: drawCompare,
    save: save,
    baziFile: function (name) { return "命理工具-八字-" + (name || "命盘") + "-" + stamp() + ".png"; },
    ziweiFile: function (name) { return "命理工具-紫微-" + (name || "命盘") + "-" + stamp() + ".png"; },
    matchFile: function (name) { return "命理工具-合盘-" + (name || "对照") + "-" + stamp() + ".png"; }
  });
})(typeof window !== "undefined" ? window : globalThis);
