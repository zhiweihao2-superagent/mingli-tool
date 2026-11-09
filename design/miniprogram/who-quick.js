// 命盘页顶部的「这次看谁」：只切换正在看的档案，不改默认。
(function () {
  "use strict";

  var select = document.getElementById("who-quick");
  if (!select || !window.MingliProfile) return;

  var items = window.MingliProfile.list();
  if (items.length < 2) {
    select.hidden = true;
    return;
  }

  select.innerHTML = items.map(function (item) {
    return '<option value="' + item.id + '">' + item.name + "</option>";
  }).join("");

  var current = window.MingliProfile.viewingId();
  if (current) select.value = current;

  select.addEventListener("change", function () {
    window.MingliProfile.setViewing(select.value);
    location.reload();
  });
})();
