"""把一份命盘的事实包压成「AI 解读所需的可读摘要」。

目的：检验排盘是否够 AI 用，而不是检验证据索引是否完备。
输出写进 tmp-chart-digest.txt，供人工/模型阅读。
"""

import io
import json
import sys

sys.path.insert(0, "src")

from mingli_tool.bazi import calculate

PAYLOAD = {
    "schema_version": "1.0",
    "profile": {
        "display_name": None, "calendar": "solar", "date": "1990-05-15",
        "is_leap_month": False,
        "time": {"precision": "minute", "value": "12:30", "branch": None},
        "timezone": "Asia/Shanghai", "sex_for_calculation": "male",
        "birthplace": {"label": None, "longitude": None, "latitude": None},
    },
    "rules": {"profile_id": "engine-default-v1", "true_solar_time": False},
    "options": {"save_history": False, "annual_cycles_through": 2026},
}

out = []
add = out.append

r = calculate(PAYLOAD)
calc = r["calculation"]
facts = r["ai_facts"]
aux = facts.get("auxiliary_chart") or {}

add("### 基本信息")
add(f"性别: {calc.get('sex_for_calculation')}")
add(f"公历: {r.get('input', {}).get('date') or PAYLOAD['profile']['date']}")
add("")

add("### 四柱")
for name in ("year", "month", "day", "hour"):
    p = (calc.get("pillars") or {}).get(name)
    if not p:
        add(f"{name}: 缺")
        continue
    add(
        f"{name}: {p.get('ganzhi')} | 天干十神={p.get('stem_ten_god')} | "
        f"藏干={p.get('hidden_stems')} | 长生={p.get('stem_life_stage') or p.get('day_master_life_stage')}"
    )
add("")

add("### 五行与旺衰")
inv = facts.get("element_inventory") or {}
add(f"可见天干五行: {inv.get('counts', {}).get('visible_stems')}")
add(f"地支本气: {inv.get('counts', {}).get('branch_primary_elements')}")
dr = facts.get("derived_rules") or {}
for key in ("strength_candidates", "pattern_candidates", "useful_elements", "climate"):
    if key in dr:
        add(f"{key}: {json.dumps(dr[key], ensure_ascii=False)[:400]}")
add("")

add("### 辅助盘")
add(f"纳音: { {k: v.get('value') for k, v in (aux.get('nayin') or {}).items()} }")
add(f"胎元: {(aux.get('taiyuan') or {}).get('value')}")
add(f"日柱旬空: {(aux.get('day_xunkong') or {}).get('value')}")
add(f"命宫/身宫: {(aux.get('minggong') or {}).get('status')} / {(aux.get('shengong') or {}).get('status')}")
add("神煞:")
for hit in (aux.get("shensha") or {}).get("value") or []:
    add(f"  - {hit.get('name')} 落 {hit.get('pillars')}（起算：{hit.get('anchors')}）")
add("")

add("### 大运")
for cycle in (facts.get("luck_cycles") or [])[:12]:
    add(f"  {cycle.get('sequence')}: {cycle.get('ganzhi')} | {cycle.get('age_range')} | 十神={cycle.get('ten_god')}")
add("")

add("### 流年（近 12 年）")
annual = facts.get("annual_cycles") or []
for item in annual[-12:]:
    add(f"  {item.get('year')}: {item.get('ganzhi')}")
add("")

ci = facts.get("cycle_interactions") or {}
add(f"### 岁运交互（status={ci.get('status')}）")
for item in ci.get("items") or []:
    add(f"  {item.get('year')} {item.get('annual_ganzhi')} vs 大运 {item.get('luck_ganzhi')} → {item.get('flags')}")
add("")

rel = facts.get("natal_relations") or []
add(f"### 原局关系（{len(rel)} 条）")
for item in rel[:20]:
    add(f"  {item.get('kind')} {item.get('participants')} {item.get('values') or ''}")

text = "\n".join(str(line) for line in out)
io.open("tmp-chart-digest.txt", "w", encoding="utf-8").write(text)
print(text[:3000])
print("...")
print(f"[digest 共 {len(text)} 字，已写入 tmp-chart-digest.txt]")
