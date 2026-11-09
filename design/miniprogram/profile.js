// 多档案：一份资料排一张盘，但家里几个人可以各存一份。
// 旧版本只存一个人的 mingli.profile.v1，这里第一次打开时自动迁移成档案列表。
(function (global) {
  "use strict";

  var LIST = "mingli.profiles.v1";
  var ACTIVE = "mingli.profile.active";      // 旧键，仅用于迁移
  var DEFAULT = "mingli.profile.default";    // 默认档案：各页打开时用它
  var VIEWING = "mingli.profile.viewing";    // 这次在看的档案：可以临时换，不动默认
  var LEGACY = "mingli.profile.v1";

  function readList() {
    try {
      var raw = localStorage.getItem(LIST);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function writeList(list) {
    try { localStorage.setItem(LIST, JSON.stringify(list.slice(0, 12))); } catch (e) { /* 存不下就退回内存 */ }
  }

  function makeId() {
    return "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  }

  function migrate() {
    var list = readList();
    if (list.length) return list;
    try {
      var raw = localStorage.getItem(LEGACY);
      if (!raw) return [];
      var profile = JSON.parse(raw);
      if (!profile || !profile.profile) return [];
      var item = { id: makeId(), name: "我", profile: profile, createdAt: new Date().toISOString() };
      list = [item];
      writeList(list);
      localStorage.setItem(ACTIVE, item.id);
      return list;
    } catch (e) {
      return [];
    }
  }

  function list() {
    return migrate();
  }

  function activeId() {
    return viewingId();
  }

  function active() {
    var id = activeId();
    if (!id) return null;
    return list().filter(function (item) { return item.id === id; })[0] || null;
  }

  // 默认档案：进各页时默认看这份
  function defaultId() {
    var items = list();
    var id = readKey(DEFAULT) || readKey(ACTIVE);
    if (id && items.some(function (item) { return item.id === id; })) return id;
    return items.length ? items[0].id : null;
  }

  function setDefault(id) {
    writeKey(DEFAULT, id);
    writeKey(ACTIVE, id);
    writeKey(VIEWING, id);
  }

  // 这次在看谁：临时切换只改这一项，不影响默认
  function viewingId() {
    var items = list();
    var id = readKey(VIEWING);
    if (id && items.some(function (item) { return item.id === id; })) return id;
    return defaultId();
  }

  function setViewing(id) {
    writeKey(VIEWING, id);
  }

  function readKey(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  function writeKey(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* 忽略 */ }
  }

  function setActive(id) {
    writeKey(ACTIVE, id);
  }

  // 保存当前编辑的档案：有 id 就更新，没有就新增
  function save(entry) {
    var items = list();
    var id = entry.id || null;
    var name = (entry.name || "").trim() || "我";
    var item = {
      id: id || makeId(),
      name: name,
      profile: entry.profile,
      createdAt: entry.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    if (id) {
      var index = items.map(function (x) { return x.id; }).indexOf(id);
      if (index >= 0) items[index] = item; else items.unshift(item);
    } else {
      items.unshift(item);
    }
    writeList(items);
    setActive(item.id);
    if (!readKey(DEFAULT)) writeKey(DEFAULT, item.id);
    writeKey(VIEWING, item.id);
    // 兼容旧代码：保留「最近一份」的单条键
    try { localStorage.setItem(LEGACY, JSON.stringify(item.profile)); } catch (e) { /* 忽略 */ }
    return item;
  }

  function remove(id) {
    var items = list().filter(function (item) { return item.id !== id; });
    writeList(items);
    if (activeId() === id) {
      try { localStorage.setItem(ACTIVE, items.length ? items[0].id : ""); } catch (e) { /* 忽略 */ }
    }
    return items;
  }

  function clearAll() {
    try {
      localStorage.removeItem(LIST);
      localStorage.removeItem(ACTIVE);
      localStorage.removeItem(LEGACY);
    } catch (e) { /* 忽略 */ }
  }

  // 给页面用的「当前资料」：优先档案，其次旧键
  function currentProfile() {
    var item = active();
    return item ? item.profile : null;
  }

  function currentName() {
    var item = active();
    return item ? item.name : "";
  }

  global.MingliProfile = Object.freeze({
    list: list,
    active: active,
    activeId: activeId,
    viewingId: viewingId,
    setViewing: setViewing,
    defaultId: defaultId,
    setDefault: setDefault,
    setActive: setActive,
    save: save,
    remove: remove,
    clearAll: clearAll,
    currentProfile: currentProfile,
    currentName: currentName
  });
})(typeof window !== "undefined" ? window : globalThis);
