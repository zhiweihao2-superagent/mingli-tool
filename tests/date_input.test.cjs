"use strict";

const assertRaw = require("node:assert/strict");
// 统计断言次数：验证脚本据此确认「真的跑了断言」，而不是只看退出码。
let __checks = 0;
const assert = new Proxy(assertRaw, {
  get(target, key) {
    const value = target[key];
    if (typeof value !== "function") return value;
    return (...args) => {
      __checks += 1;
      return value.apply(target, args);
    };
  },
});

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../web/date-input.js"), "utf8");
const context = {};
vm.runInNewContext(source, context);
const { attachAutoAdvance, digits, parse } = context.MingliDateInput;

class FakeInput {
  constructor() {
    this.value = "";
    this.listeners = {};
    this.focused = false;
    this.selected = false;
  }
  addEventListener(name, handler) { this.listeners[name] = handler; }
  removeEventListener(name) { delete this.listeners[name]; }
  focus() { this.focused = true; }
  select() { this.selected = true; }
  setSelectionRange(start, end) { this.selection = [start, end]; }
  emit(name, event = {}) { this.listeners[name]?.({ preventDefault() {}, ...event }); }
}

const normalized = parse("1990", "5", "15", "solar");
assert.equal(normalized.isoDate, "1990-05-15");
assert.equal(normalized.focusId, null);
assert.equal(normalized.error, null);
assert.equal(parse("2000", "2", "29", "solar").error, null);
assert.equal(parse("1900", "2", "29", "solar").focusId, "birth-day");
assert.equal(parse("2023", "2", "29", "solar").error, "这个月份没有该日期，请检查月和日。");
assert.equal(parse("2023", "2", "30", "lunar").error, null);
assert.equal(parse("2023", "2", "31", "lunar").focusId, "birth-day");
assert.equal(parse("1899", "12", "31", "solar").focusId, "birth-year");
assert.equal(parse("2024", "13", "1", "solar").focusId, "birth-month");
assert.equal(parse("2024", "05", "", "solar").focusId, "birth-day");
assert.equal(parse("20a4", "05", "01", "solar").focusId, "birth-year");
assert.equal(digits("20年24", 4), "2024");

const year = new FakeInput();
const month = new FakeInput();
const day = new FakeInput();
attachAutoAdvance({ "birth-year": year, "birth-month": month, "birth-day": day });
year.value = "1990";
year.emit("input", { inputType: "insertText" });
assert.equal(month.focused, true);
month.value = "05";
month.emit("input", { inputType: "insertText" });
assert.equal(day.focused, true);
month.focused = false;
day.value = "";
day.emit("keydown", { key: "Backspace" });
assert.equal(month.focused, true);

year.emit("paste", {
  clipboardData: { getData: () => "20001231" }
});
assert.equal(year.value, "2000");
assert.equal(month.value, "12");
assert.equal(day.value, "31");

if (__checks === 0) {
  console.error("没有任何断言执行");
  process.exit(1);
}
console.log(`===== Birth date input checks passed. ${__checks} 项 =====`);
