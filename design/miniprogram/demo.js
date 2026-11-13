// 设计稿预览用的示例档案：画布上没填资料时，各页拿这份把真实版式渲染出来。
// 真实使用请在「出生信息」页填写；填过之后 localStorage 里的资料优先，这里不生效。
(function (global) {
  "use strict";
  var payload = {
    schema_version: "1.0",
    profile: {
      calendar: "solar",
      date: "1990-05-15",
      is_leap_month: false,
      time: { precision: "minute", value: "12:30" },
      timezone: "Asia/Shanghai",
      sex_for_calculation: "male",
      birthplace: { label: "上海", longitude: 121.47, latitude: 31.23 }
    },
    rules: { profile_id: "engine-default-v1", true_solar_time: true, clock_time_is_dst: false },
    options: { save_history: false, annual_cycles_through: 2031 }
  };
  var item = { id: "p_demo", name: "示例", profile: payload, createdAt: "2026-11-09T00:00:00.000Z" };
  global.MINGLI_DEMO_PROFILE = payload;
  try {
    if (!localStorage.getItem("mingli.profiles.v1")) {
      localStorage.setItem("mingli.profiles.v1", JSON.stringify([item]));
      localStorage.setItem("mingli.profile.default", item.id);
      localStorage.setItem("mingli.profile.viewing", item.id);
      localStorage.setItem("mingli.profile.v1", JSON.stringify(payload));
    }
  } catch (e) { /* 预览环境禁了存储也不影响渲染 */ }
}(window));
