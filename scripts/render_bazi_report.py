"""生成八字（子平月令派）结构报告——纯规则事实，不调用模型。

与紫微报告分开：`docs/report-sample.md` 只谈紫微，本文件只谈八字，
互不引用结论。每节末尾给出 `依据` 指针，方便回查 ai_facts。

用法：
    python scripts/render_bazi_report.py
    python scripts/render_bazi_report.py --date 1990-05-15 --time 12:30 --sex male --through 2033
"""

from __future__ import annotations

import argparse
import json
import re
from datetime import datetime
from pathlib import Path

from mingli_tool import bazi

PILLAR_LABELS = [("year", "年柱"), ("month", "月柱"), ("day", "日柱"), ("hour", "时柱")]

ROOT = Path(__file__).resolve().parent.parent
KNOWLEDGE_PATH = ROOT / "knowledge" / "bazi" / "knowledge-v1.json"
ANCHOR_PATH = ROOT / "knowledge" / "bazi" / "scope-anchors.json"

# 一节用到的 scope —— 决定「出处」行挂哪几章，避免所有节都堆满同一串引用。
SECTION_SCOPES = {
    "一、四柱": ["bazi:pillars", "bazi:ten-gods", "bazi:hidden-stems", "bazi:twelve-life-stages"],
    "二、五行分布": ["bazi:element-inventory"],
    "三、旺衰（候选）": ["bazi:strength-candidate"],
    "四、格局（候选）": ["bazi:pattern-candidates", "bazi:dominant-pattern-candidate"],
    "五、调候与用神（候选）": [
        "bazi:balance-useful-elements",
        "bazi:pattern-useful-elements",
        "bazi:full-qiongtong-120-cell-climate-candidate",
    ],
    "六、辅助盘": ["bazi:auxiliary-shensha"],
    "七、大运": ["bazi:luck-cycle-relations"],
    "八、流年（逐年事实）": ["bazi:annual-relations", "bazi:annual-cycle-coverage"],
}

RELATION_LABELS = {
    "stem-combine": "天干五合",
    "stem-clash": "天干相冲",
    "stem-three-combine": "天干三合",
    "branch-six-combine": "地支六合",
    "branch-six-clash": "地支六冲",
    "branch-half-harmony": "地支半合",
    "branch-three-meeting": "地支三会",
    "branch-half-meeting": "地支半会",
    "branch-arch-harmony": "地支拱合",
    "branch-arch-meeting": "地支拱会",
    "branch-punishment": "地支相刑",
    "branch-harm": "地支相害",
    "branch-break": "地支相破",
    "branch-hidden-combine": "地支暗合",
    "branch-hidden-stem-combine-candidate": "地支藏干合（候选）",
}

ELEMENTS = ["木", "火", "土", "金", "水"]

STEM_YIN_YANG = {"甲": "阳", "乙": "阴", "丙": "阳", "丁": "阴", "戊": "阳",
                 "己": "阴", "庚": "阳", "辛": "阴", "壬": "阳", "癸": "阴"}

STEM_CLASH = {("甲", "庚"), ("乙", "辛"), ("丙", "壬"), ("丁", "癸")}
BRANCH_CLASH = {("子", "午"), ("丑", "未"), ("寅", "申"), ("卯", "酉"), ("辰", "戌"), ("巳", "亥")}

STATUS_LABELS = {
    "validated": "已校验",
    "candidate": "候选",
    "candidate-list": "候选列表",
    "multi-axis-candidates": "多轴候选",
    "full-table-candidate": "全表候选",
    "unavailable": "不可得",
    "unsupported": "未支持",
}


def rel_label(kind: str) -> str:
    return RELATION_LABELS.get(kind, kind)


def cell(value) -> str:
    """把任意值压成单行表格单元格。"""
    if value is None:
        return "—"
    if isinstance(value, (list, tuple)):
        text = "、".join(str(item) for item in value)
    else:
        text = str(value)
    return text.replace("|", "／").replace("\n", " ").strip() or "—"


def status_of(node) -> str:
    if not isinstance(node, dict):
        return "—"
    raw = node.get("status")
    return STATUS_LABELS.get(raw, raw or "—")


def pointer(node) -> str:
    if not isinstance(node, dict):
        return ""
    evidence = node.get("evidence") or []
    if not evidence:
        return ""
    return evidence[0].get("json_pointer") or ""


def parse_age_range(text: str):
    if not isinstance(text, str):
        return None
    match = re.match(r"\s*(\d+)\s*岁?\s*-\s*(\d+)", text)
    if match:
        return int(match.group(1)), int(match.group(2))
    match = re.match(r"\s*(\d+)\s*岁", text)
    if match:
        value = int(match.group(1))
        return value, value
    return None


def dedupe(texts):
    """去掉重复的关系描述（同一柱位组合可能命中多条同值关系）。"""
    seen = []
    for text in texts:
        if text not in seen:
            seen.append(text)
    return seen


def load_anchor_maps():
    """读知识包与 scope→anchor 映射，返回 (anchor→条目, scope→anchor 列表)。

    读不到就返回空表——报告仍然生成，只是没有「出处」行，并且会在末尾如实说明。
    """
    entries: dict[str, dict] = {}
    scopes: dict[str, list[str]] = {}
    note = None
    try:
        knowledge = json.loads(KNOWLEDGE_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        return {}, {}, f"知识包不可读（{error.__class__.__name__}），本节不附出处"
    for document in knowledge.get("documents") or []:
        doc_id = document.get("id") or ""
        doc_title = document.get("title") or doc_id
        doc_file = document.get("file") or ""
        for chapter in document.get("chapters") or []:
            chapter_anchor = chapter.get("anchor")
            if not chapter_anchor:
                continue
            chapter_items = []
            for section in chapter.get("subsections") or []:
                anchor = section.get("anchor")
                if not anchor:
                    continue
                items = [
                    (item.get("text") or "").strip()
                    for item in (section.get("items") or [])
                    if (item.get("text") or "").strip()
                ]
                chapter_items.extend(items)
                entries[anchor] = {
                    "documentId": doc_id,
                    "documentTitle": doc_title,
                    "file": doc_file,
                    "chapter": chapter_anchor,
                    "title": section.get("title") or anchor,
                    "line": section.get("line"),
                    "items": items,
                }
            entries.setdefault(chapter_anchor, {
                "documentId": doc_id,
                "documentTitle": doc_title,
                "file": doc_file,
                "chapter": chapter_anchor,
                "title": chapter.get("title") or chapter_anchor,
                "line": chapter.get("line"),
                "items": chapter_items,
            })
    try:
        mapping = json.loads(ANCHOR_PATH.read_text(encoding="utf-8"))
        scopes = mapping.get("scopes") or {}
    except (OSError, ValueError) as error:
        note = f"scope 映射不可读（{error.__class__.__name__}），本节不附出处"
    return entries, scopes, note


def citation_for(entry: dict) -> str:
    if not entry:
        return ""
    if entry.get("documentId") == "classical-texts":
        source = f"《{entry.get('chapter')}·{entry.get('title')}》"
    else:
        source = f"《{entry.get('documentTitle')}·{entry.get('title')}》"
    return f"{source}，bazi-skill@112a5d84（MIT）"


def provenance_line(entries, scopes, section_key) -> tuple[str, list[tuple[str, str]]]:
    """给一节生成「出处」行与附录行；anchor 解析不到就如实标注，不省略。"""
    wanted_scopes = SECTION_SCOPES.get(section_key) or []
    resolved: list[tuple[str, str]] = []
    missing: list[str] = []
    seen = set()
    for scope in wanted_scopes:
        for anchor in scopes.get(scope) or []:
            if anchor in seen:
                continue
            seen.add(anchor)
            entry = entries.get(anchor)
            if entry:
                resolved.append((anchor, citation_for(entry)))
            else:
                missing.append(anchor)
    parts = [citation for _anchor, citation in resolved]
    if missing:
        parts.append("未收录：" + "、".join(missing))
    if not parts:
        return "", resolved
    return "出处：" + "；".join(parts), resolved


def render(calc: dict, facts: dict, birth_year: int) -> str:
    calendar = calc.get("calendar_display") or {}
    pillars = calc.get("pillars") or {}
    derived = facts.get("derived_rules") or {}
    inventory = facts.get("element_inventory") or {}
    auxiliary = facts.get("auxiliary_chart") or {}
    luck = facts.get("luck_cycles") or []
    annual = facts.get("annual_cycles") or []
    coverage = facts.get("annual_cycle_coverage") or {}
    validation = facts.get("validation") or {}
    profile = calc.get("rule_profile") or {}
    engine = calc.get("engine") or {}

    lines: list[str] = []
    add = lines.append

    entries, scope_map, anchor_note = load_anchor_maps()
    appendix_scopes: list[tuple[str, list[tuple[str, str]]]] = []

    def emit_provenance(section_key: str) -> None:
        line, resolved = provenance_line(entries, scope_map, section_key)
        if resolved:
            appendix_scopes.append((section_key, resolved))
        if line:
            add(line)
            add("")
        elif anchor_note:
            add(anchor_note)
            add("")

    add("# 八字结构报告（子平月令派）")
    add("")
    add(f"生成时间：{datetime.now().strftime('%Y-%m-%d %H:%M')}")
    add("")
    add("## 这份报告是什么")
    add("")
    add("只把八字事实层算出来的东西摊开：四柱、五行计数、旺衰候选、格局候选、"
        "调候与用神、辅助盘、大运、流年。**不出断语、不预测事件、不写吉凶**——"
        "这一层的职责是「事实齐不齐、能不能指回来源」，解读留给人或另一次解读。")
    add("")
    add("与紫微报告分开：`docs/report-sample.md` 只谈紫微（钦天门），本文件只谈八字（子平月令派）。"
        "两套体系分属不同判法，结论不互相引用。")
    add("")
    add(f"- 判法口径：`{profile.get('id', '—')}`")
    add(f"- 时区：{profile.get('timezone', '—')}；年界：{profile.get('year_boundary', '—')}；"
        f"月界：{profile.get('month_boundary', '—')}；日界：{profile.get('day_boundary', '—')}")
    add(f"- 真太阳时：{'开' if profile.get('true_solar_time') else '关'}；"
        f"夏令时输入：{'是' if profile.get('clock_time_is_dst') else '否'}")
    add(f"- 排盘引擎：{engine.get('name', '—')}@{str(engine.get('commit') or '')[:8]}"
        f"（{engine.get('license', '—')}），适配层 {engine.get('adapter_version', '—')}")
    add(f"- 自检：{status_of(validation)}，通过 {sum(1 for c in (validation.get('checks') or []) if c.get('pass'))}"
        f"/{len(validation.get('checks') or [])} 项")
    add("")

    # 一、四柱
    add("## 一、四柱")
    add("")
    add("| 柱 | 干支 | 十神 | 藏干（本／中／余·十神） | 星运 | 自坐 | 纳音 |")
    add("| --- | --- | --- | --- | --- | --- | --- |")
    nayin = auxiliary.get("nayin") or {}
    for key, label in PILLAR_LABELS:
        pillar = pillars.get(key) or {}
        hidden = pillar.get("hidden_stems") or []
        hidden_text = "；".join(
            f"{item.get('role', '')}{item.get('stem', '')}·{item.get('ten_god', '')}"
            for item in hidden
        )
        add("| {} | {} | {} | {} | {} | {} | {} |".format(
            label,
            cell(pillar.get("ganzhi")),
            cell(pillar.get("ten_god")),
            cell(hidden_text),
            cell(pillar.get("stem_life_stage")),
            cell(pillar.get("day_master_life_stage")),
            cell((nayin.get(key) or {}).get("value")),
        ))
    add("")
    day = pillars.get("day") or {}
    add(f"日主：{day.get('stem', '—')}（{day.get('stem_element', '—')}，{day.get('stem_yin_yang', '—')}）；"
        f"月令：{(inventory.get('month_command') or {}).get('branch', '—')}"
        f"（本气 {(inventory.get('month_command') or {}).get('primary_element', '—')}）。")
    add("")
    add("依据：`/pillars/{年,月,日,时}`、`/auxiliary_chart/nayin`")
    emit_provenance("一、四柱")
    add("")

    # 二、五行分布
    counts = inventory.get("counts") or {}
    add("## 二、五行分布")
    add("")
    add("| 五行 | 显干 | 地支本气 | 藏干（个） | 藏干名义权重 |")
    add("| --- | --- | --- | --- | --- |")
    visible = counts.get("visible_stems") or {}
    branch_primary = counts.get("branch_primary_elements") or {}
    hidden = counts.get("hidden_stems") or {}
    hidden_weight = counts.get("hidden_stems_nominal_weight") or {}
    for element in ELEMENTS:
        weight = hidden_weight.get(element)
        add("| {} | {} | {} | {} | {} |".format(
            element,
            visible.get(element, 0),
            branch_primary.get(element, 0),
            hidden.get(element, 0),
            f"{float(weight):.2f}" if isinstance(weight, (int, float)) else "—",
        ))
    add("")
    roots = inventory.get("roots") or {}
    same_stem = [f"{item.get('pillar')}支{item.get('branch')}藏{item.get('hidden_stem')}"
                 for item in (roots.get("same_stem") or [])]
    add(f"日主之根（同干）：{cell(same_stem) if same_stem else '无同干之根'}；"
        f"同五行之根：{len(roots.get('same_element') or [])} 处。")
    add("")
    add("口径提醒：本节是**原始计数**，不做吉凶评分。旺衰分数在下一节，"
        "两者不能互相替代（`stem_root_audit.concept` 已写明结构口径与十神归属口径不同）。")
    add("")
    add("依据：`/element_inventory/counts`、`/element_inventory/roots`")
    emit_provenance("二、五行分布")
    add("")

    # 三、旺衰
    strength = derived.get("strength") or {}
    add("## 三、旺衰（候选）")
    add("")
    add(f"结论：**{strength.get('conclusion', '—')}**（状态：{status_of(strength)}），"
        f"同党 {strength.get('supportPoints', '—')} 分、异党 {strength.get('opposingPoints', '—')} 分，"
        f"同党占比 {strength.get('supportRatio', '—')}。")
    add("")
    items = strength.get("items") or {}
    add("| 侧 | 前五项来源 |")
    add("| --- | --- |")
    for side, label in (("support", "同党"), ("opposing", "异党")):
        rows = items.get(side) or []
        text = "；".join(
            f"{row.get('label', '')} +{row.get('points', '')}" for row in rows[:5]
        )
        more = f"（共 {len(rows)} 项）" if len(rows) > 5 else ""
        add(f"| {label} | {cell(text + more)} |")
    add("")
    add("为什么叫「候选」：判法只给分档，强弱本身不是结论，"
        "还要和格局取法一起看；破格条件优先于泛化吉凶。")
    add("")
    add("依据：`/derived_rules/strength`、`/derived_rules/strength/items`")
    emit_provenance("三、旺衰（候选）")
    add("")

    # 四、格局
    pattern = derived.get("pattern") or {}
    add("## 四、格局（候选）")
    add("")
    add(f"主候选：**{pattern.get('primaryCandidate', '—')}**（状态：{status_of(pattern)}）")
    add("")
    add("| 格 | 十神 | 月令藏干位 | 状态 | 已满足条件 | 加分条件 | 破格触发 |")
    add("| --- | --- | --- | --- | --- | --- | --- |")
    for candidate in pattern.get("candidates") or []:
        required = [row.get("label") for row in (candidate.get("requiredMatched") or [])]
        bonus = [row.get("label") for row in (candidate.get("bonusMatched") or [])]
        breaking = [row.get("label") for row in (candidate.get("breakingTriggered") or [])]
        add("| {} | {} | {} | {} | {} | {} | {} |".format(
            cell(candidate.get("name")),
            cell(candidate.get("tenGod")),
            cell(candidate.get("monthHiddenRole")),
            cell(candidate.get("status")),
            cell(required),
            cell(bonus),
            cell(breaking) if breaking else "未触发",
        ))
    add("")
    for candidate in pattern.get("candidates") or []:
        if candidate.get("basis"):
            add(f"- {candidate.get('name')}：{candidate.get('basis')}"
                f"（出处：{candidate.get('source', '—')}）")
    add("")
    add("依据：`/derived_rules/pattern/candidates`")
    emit_provenance("四、格局（候选）")
    add("")

    # 五、调候与用神
    climate = derived.get("climate_adjustment") or {}
    useful = derived.get("useful_elements") or {}
    add("## 五、调候与用神（候选）")
    add("")
    add(f"调候：{climate.get('temperature', '—')}、{climate.get('moisture', '—')}"
        f"（状态：{status_of(climate)}）；调候主用五行 {cell(climate.get('primaryElements'))}，"
        f"次用 {cell(climate.get('secondaryElements'))}。")
    add("")
    present = climate.get("presentRequestedStems") or []
    add(f"调候天干：主 {cell(climate.get('primaryStems'))}、次 {cell(climate.get('secondaryStems'))}；"
        f"本盘中已出现的：{cell(present) if present else '一个都没有'}。")
    add("")
    add("| 取法轴 | 主用 | 次用 | 回避 | 说明 |")
    add("| --- | --- | --- | --- | --- |")
    for axis_key, axis in (useful.get("axes") or {}).items():
        add("| {} | {} | {} | {} | {} |".format(
            cell(axis_key),
            cell(axis.get("primaryElements") or axis.get("coreElement")),
            cell(axis.get("secondaryElements") or axis.get("supportingElements")),
            cell(axis.get("avoidElements")),
            cell(axis.get("reason")),
        ))
    add("")
    add("三条取法轴（扶抑／格局／调候）分开保存，不合成一个「喜用神」结论——"
        "合成会把互相牵制的条件抹平。")
    add("")
    add("依据：`/derived_rules/climate_adjustment`、`/derived_rules/useful_elements/axes`")
    emit_provenance("五、调候与用神（候选）")
    add("")

    # 六、辅助盘
    add("## 六、辅助盘")
    add("")
    add("| 项 | 值 | 规则 | 状态 |")
    add("| --- | --- | --- | --- |")
    for key, label in (("taiyuan", "胎元"), ("minggong", "命宫"), ("shengong", "身宫")):
        node = auxiliary.get(key) or {}
        add(f"| {label} | {cell(node.get('value'))} | {cell(node.get('rule_id'))} | {status_of(node)} |")
    xunkong = auxiliary.get("xunkong") or {}
    xunkong_text = "；".join(
        f"{dict(PILLAR_LABELS).get(key, key)}{cell((xunkong.get(key) or {}).get('value'))}"
        for key in ("year", "month", "day", "hour")
    )
    add(f"| 旬空 | {cell(xunkong_text)} | xunkong.sixty-cycle | {status_of(auxiliary.get('day_xunkong'))} |")
    add("")
    shensha = auxiliary.get("shensha") or {}
    records = shensha.get("value") or []
    add(f"神煞（{len(records)} 条，状态：{status_of(shensha)}）：")
    add("")
    if records:
        add("| 神煞 | 落点 | 取法 | 可复算 |")
        add("| --- | --- | --- | --- |")
        for record in records:
            add("| {} | {} | {} | {} |".format(
                cell(record.get("name")),
                cell(record.get("positions")),
                cell(record.get("anchors")),
                "是" if record.get("anchor_recomputable") else "否",
            ))
    else:
        add("本盘未触发已收录的神煞。")
    add("")
    add("依据：`/auxiliary_chart/{taiyuan,minggong,shengong,xunkong,shensha}`")
    emit_provenance("六、辅助盘")
    add("")

    # 七、大运
    add("## 七、大运")
    add("")
    add("| 序 | 年龄段 | 干支 | 十神 | 与命局关系 |")
    add("| --- | --- | --- | --- | --- |")
    luck_windows = []
    for step in luck:
        relations = step.get("relations_to_natal") or []
        texts = dedupe([
            f"{rel_label(rel.get('kind'))}{cell(rel.get('values'))}" for rel in relations
        ])
        summary = "；".join(texts[:4])
        if len(texts) > 4:
            summary += f"（共 {len(texts)} 条）"
        add("| {} | {} | {} | {} | {} |".format(
            cell(step.get("sequence")),
            cell(step.get("age_range")),
            cell(step.get("ganzhi")),
            cell(step.get("ten_god")),
            cell(summary) if summary else "无",
        ))
        window = parse_age_range(step.get("age_range"))
        if window:
            luck_windows.append((window[0], window[1], step))
    add("")
    add("依据：`/luck_cycles/{i}/relations_to_natal`")
    emit_provenance("七、大运")
    add("")

    # 八、流年
    add("## 八、流年（逐年事实）")
    add("")
    if coverage:
        add(f"覆盖 {coverage.get('start_year')}–{coverage.get('end_year')} 共 {coverage.get('count')} 年"
            f"（请求至 {coverage.get('requested_through')}，"
            f"{'完整' if coverage.get('complete_for_requested_range') else '不完整'}）。")
        add("")
    add("| 年 | 干支 | 十神 | 虚岁 | 所在大运 | 与命局关系 | 标记 |")
    add("| --- | --- | --- | --- | --- | --- | --- |")
    marks_by_year = {}
    for step in annual:
        year = step.get("year")
        ganzhi = step.get("ganzhi") or ""
        stem = step.get("stem") or (ganzhi[0] if ganzhi else "")
        branch = step.get("branch") or (ganzhi[1] if len(ganzhi) > 1 else "")
        nominal_age = (year - birth_year + 1) if (year and birth_year) else None
        current_luck = None
        for start, end, luck_step in luck_windows:
            if nominal_age is not None and start <= nominal_age <= end:
                current_luck = luck_step
        marks = []
        is_decadal = bool(current_luck) and str(current_luck.get("sequence", "")).isdigit()
        if is_decadal:
            luck_ganzhi = current_luck.get("ganzhi") or ""
            if luck_ganzhi and luck_ganzhi == ganzhi:
                marks.append("岁运并临")
            luck_stem = current_luck.get("stem") or (luck_ganzhi[0] if luck_ganzhi else "")
            luck_branch = current_luck.get("branch") or (luck_ganzhi[1] if len(luck_ganzhi) > 1 else "")
            stem_clashed = (stem, luck_stem) in STEM_CLASH or (luck_stem, stem) in STEM_CLASH
            branch_clashed = ((branch, luck_branch) in BRANCH_CLASH
                              or (luck_branch, branch) in BRANCH_CLASH)
            if stem_clashed and branch_clashed:
                marks.append("天克地冲")
        if marks:
            marks_by_year[year] = marks
        relations = step.get("relations_to_natal") or []
        texts = dedupe([
            f"{rel_label(rel.get('kind'))}{cell(rel.get('values'))}" for rel in relations
        ])
        summary = "；".join(texts[:3])
        if len(texts) > 3:
            summary += f"（共 {len(texts)} 条）"
        add("| {} | {} | {} | {} | {} | {} | {} |".format(
            cell(year),
            cell(ganzhi),
            cell(step.get("ten_god")),
            cell(nominal_age),
            cell((current_luck or {}).get("ganzhi")) if current_luck else "起运前",
            cell(summary) if summary else "无",
            cell("、".join(marks)) if marks else "—",
        ))
    add("")
    if marks_by_year:
        add("标记说明：「岁运并临」= 流年干支与大运干支完全相同；"
            "「天克地冲」= 流年与大运天干相克且地支六冲。两者只是结构提示，不代表吉凶。")
        add("")
    add("依据：`/annual_cycles/{i}`、`/annual_cycles/{i}/relations_to_natal`")
    emit_provenance("八、流年（逐年事实）")
    add("")

    # 九、未覆盖
    add("## 九、这次没有覆盖的")
    add("")
    readiness = facts.get("readiness") or {}
    unsupported = readiness.get("unsupported_scopes") or []
    add(f"- 解析层可用范围：{len(readiness.get('supported_scopes') or [])} 个；"
        f"明确不支持：{', '.join(unsupported) if unsupported else '无'}。")
    add("- 不输出吉凶断语、不判成败、不定应期——这些需要解读层，本报告只给事实。")
    add("- 流月吉凶时序未裁定（规则档案 `monthly.timing-candidate` 状态 unresolved），故不给流月。")
    add("- 格局成败判据未裁定（`pattern.chengge-baise` unresolved），故格局只列候选条件，不下成败。")
    add("- 纳音／旬空／胎元三项在本知识层里没有对应章节（上游未及），"
        "所以正文给了值但给不出口诀出处，属如实留白。")
    add("")

    # 十、条款出处
    add("## 十、条款出处")
    add("")
    add("上面每节末尾的「出处」行来自随包知识层 `knowledge/bazi/knowledge-v1.json`"
        "（上游 `jinchenma94/bazi-skill`，MIT）。这里把用到的章节集中列出，"
        "`行` 是它在 `knowledge/bazi/source/<文件>` 里的起始行号，可以直接去原文核对。")
    add("")
    add("| 节 | 引用章节 | 源文件 | 行 | 出处 |")
    add("| --- | --- | --- | --- | --- |")
    seen_pairs = set()
    for section_key, resolved in appendix_scopes:
        for anchor, citation in resolved:
            key = (section_key, anchor)
            if key in seen_pairs:
                continue
            seen_pairs.add(key)
            entry = entries.get(anchor) or {}
            add("| {} | {} | {} | {} | {} |".format(
                cell(section_key),
                cell(entry.get("title") or anchor),
                cell(entry.get("file")),
                cell(entry.get("line")),
                cell(citation),
            ))
    add("")
    missing_anchors = []
    for scope, anchors in scope_map.items():
        for anchor in anchors:
            if anchor not in entries:
                missing_anchors.append(f"{scope} → {anchor}")
    if missing_anchors:
        add("以下 anchor 在知识包里查不到，已如实标在对应节的「出处」行里，没有编造章节名：")
        add("")
        for row in missing_anchors:
            add(f"- {row}")
        add("")
    else:
        add("全部 anchor 都在知识包里逐条命中，没有悬空引用。")
        add("")

    return "\n".join(lines).rstrip() + "\n"


def build_payload(date: str, time_value: str, sex: str, through: int) -> dict:
    return {
        "schema_version": "1.0",
        "profile": {
            "calendar": "solar",
            "date": date,
            "is_leap_month": False,
            "time": {"precision": "minute", "value": time_value, "branch": None},
            "timezone": "Asia/Shanghai",
            "sex_for_calculation": sex,
        },
        "rules": {
            "profile_id": "engine-default-v1",
            "true_solar_time": False,
            "clock_time_is_dst": False,
        },
        "options": {"save_history": False, "annual_cycles_through": through},
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="生成八字结构报告（不调用模型）")
    parser.add_argument("--date", default="1990-05-15")
    parser.add_argument("--time", default="12:30")
    parser.add_argument("--sex", default="male", choices=["male", "female"])
    parser.add_argument("--through", type=int, default=2033)
    parser.add_argument("--out", default="docs/bazi-report.md")
    args = parser.parse_args()

    payload = build_payload(args.date, args.time, args.sex, args.through)
    result = bazi.calculate(payload)
    if result.get("status") != "ok":
        print(json.dumps(result, ensure_ascii=False)[:2000])
        return 1

    text = render(result["calculation"], result["ai_facts"], int(args.date[:4]))
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(text, encoding="utf-8")
    print(f"已写入 {out_path}（{len(text)} 字符）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
