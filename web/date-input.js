"use strict";

(() => {
  const PARTS = [
    { id: "birth-year", maxLength: 4 },
    { id: "birth-month", maxLength: 2 },
    { id: "birth-day", maxLength: 2 }
  ];

  function digits(value, maxLength) {
    return String(value ?? "").replace(/\D/g, "").slice(0, maxLength);
  }

  function attachAutoAdvance(inputs) {
    const ordered = PARTS.map(part => ({ ...part, input: inputs[part.id] })).filter(part => part.input);
    const cleanups = [];

    ordered.forEach((part, index) => {
      const onInput = event => {
        if (event.isComposing) return;
        const normalized = digits(part.input.value, part.maxLength);
        if (part.input.value !== normalized) part.input.value = normalized;
        if (normalized.length !== part.maxLength || event.inputType?.startsWith("delete")) return;
        const next = ordered[index + 1]?.input;
        if (!next) return;
        next.focus();
        if (next.value && typeof next.select === "function") next.select();
      };

      const onKeyDown = event => {
        if (event.key !== "Backspace" || part.input.value || index === 0) return;
        event.preventDefault();
        const previous = ordered[index - 1].input;
        previous.focus();
        if (typeof previous.setSelectionRange === "function") {
          const end = previous.value.length;
          previous.setSelectionRange(end, end);
        }
      };

      part.input.addEventListener("input", onInput);
      part.input.addEventListener("keydown", onKeyDown);
      cleanups.push(() => {
        part.input.removeEventListener("input", onInput);
        part.input.removeEventListener("keydown", onKeyDown);
      });
    });

    const yearInput = inputs["birth-year"];
    const onPaste = event => {
      const compact = digits(event.clipboardData?.getData("text"), 8);
      if (compact.length !== 8) return;
      event.preventDefault();
      inputs["birth-year"].value = compact.slice(0, 4);
      inputs["birth-month"].value = compact.slice(4, 6);
      inputs["birth-day"].value = compact.slice(6, 8);
      inputs["birth-day"].focus();
      if (typeof inputs["birth-day"].select === "function") inputs["birth-day"].select();
    };
    yearInput?.addEventListener("paste", onPaste);
    if (yearInput) cleanups.push(() => yearInput.removeEventListener("paste", onPaste));

    return () => cleanups.forEach(cleanup => cleanup());
  }

  function parse(yearValue, monthValue, dayValue, calendar) {
    const parts = [
      { value: String(yearValue ?? "").trim(), id: "birth-year", maxLength: 4 },
      { value: String(monthValue ?? "").trim(), id: "birth-month", maxLength: 2 },
      { value: String(dayValue ?? "").trim(), id: "birth-day", maxLength: 2 }
    ];
    const missing = parts.find(part => !part.value);
    if (missing) {
      return { isoDate: null, focusId: missing.id, error: "请按顺序填写完整的出生年、月、日。" };
    }
    const invalid = parts.find(part => !new RegExp("^\\d{1," + part.maxLength + "}$").test(part.value));
    if (invalid) {
      return { isoDate: null, focusId: invalid.id, error: "日期只能填写数字，请检查出生年、月、日。" };
    }

    const year = Number(parts[0].value);
    const month = Number(parts[1].value);
    const day = Number(parts[2].value);
    if (year < 1900 || year > 2100) {
      return { isoDate: null, focusId: "birth-year", error: "出生年份需在 1900 至 2100 年之间。" };
    }
    if (month < 1 || month > 12) {
      return { isoDate: null, focusId: "birth-month", error: "月份请填写 1 至 12。" };
    }

    if (calendar === "lunar") {
      if (day < 1 || day > 30) {
        return { isoDate: null, focusId: "birth-day", error: "农历日期请填写 1 至 30。" };
      }
    } else {
      const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
      if (day < 1 || day > maxDay) {
        return { isoDate: null, focusId: "birth-day", error: "这个月份没有该日期，请检查月和日。" };
      }
    }

    return {
      isoDate: String(year).padStart(4, "0") + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0"),
      focusId: null,
      error: null
    };
  }

  globalThis.MingliDateInput = Object.freeze({ attachAutoAdvance, digits, parse });
})();
