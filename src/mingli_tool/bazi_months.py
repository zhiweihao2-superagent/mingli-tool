"""目标年份的确定性流月坐标（十二节分月）。

设计约束：
- 所有月份边界来自 pinned 引擎的太阳视黄经定气，不看公历月，不猜节气日期。
- 流月天干按五虎遁对**流年干**起算（不是本命年干），与 ``pai_pan.resolve_month_pillar`` 同一口径。
- 上游覆盖不到的目标年份返回显式 ``unsupported``，不退回近似值。
- 本模块只产出坐标与干支；与原局/大运/流年的合冲刑害破关系属于后续层。
"""

from __future__ import annotations

import calendar
import math
import re
from contextvars import ContextVar
from datetime import datetime, timedelta
from typing import Any

from scripts import pai_pan as engine

from . import bazi_facts as relations_lib

SCHEMA_VERSION = "1.1"
# 1.1 相对 1.0 的破坏性变更（消费方需要按版本分支处理）：
#   - ``layers.luck`` 改为**年度汇总**：原先把年中（7-01）那一刻的
#     ``status/reason/ganzhi/from/to/sequence`` 直接摊在顶层，跨运年份会出现
#     "年度不可用却带着某个具体干支"的矛盾。现在年中结果收进 ``layers.luck.mid_year``，
#     顶层只给年度状态与覆盖信息（``months_with_luck`` / ``months_without_luck``）。
#   - 新增 ``relation_audit.luck_coverage``：说明大运层是全月覆盖还是部分覆盖。
#   - 新增 ``months[].luck.boundary_precision`` / ``boundary_uncertainty_seconds`` /
#     ``ambiguous_windows``：切点可信度不再让消费方自己猜。
#   - ``relation_scope`` 增加 ``segments`` 语义约束，并被 ``validation.checks`` 自校验。
MONTH_COUNT = 12

# 引擎节气精度声明覆盖 1900–2100（pai_pan 模块头）。流年 Y 需要 Y+1 的立春，
# 所以上限留一年余量。
MIN_TARGET_YEAR = 1900
MAX_TARGET_YEAR = 2099

# 流年 12 个节：立春起，到次年立春前。每项 (黄经, 起始节气名, 月支下标)。
# 与 engine.JIE_DEFS 同序，但第 12 个月（丑月）的起始节气落在 Y+1。
_MONTH_JIE = tuple(engine.JIE_DEFS)

INSTANT_FORMAT = "%Y-%m-%dT%H:%M:%S%z"

# 参与关系审计的四层。名字进 _pair_relations 的参与柱集合，层标签进输出。
LAYER_NATAL = "natal"
LAYER_LUCK = "luck"
LAYER_ANNUAL = "annual"
LAYER_MONTHLY = "monthly"

_LAYER_OF = {
    "year": LAYER_NATAL,
    "month": LAYER_NATAL,
    "day": LAYER_NATAL,
    "hour": LAYER_NATAL,
    "dayun": LAYER_LUCK,
    "liunian": LAYER_ANNUAL,
    "liuyue": LAYER_MONTHLY,
}

_AGE_RANGE = re.compile(r"^(\d+)-(\d+)岁$")

# 起运精度只到「月」，换运时刻因此有约 ±1 个月的不确定度
BOUNDARY_TOLERANCE = timedelta(days=31)

# 十二个流月的中文名，索引 0 对应寅月（正月）
MONTH_LABELS = (
    "正月", "二月", "三月", "四月", "五月", "六月",
    "七月", "八月", "九月", "十月", "冬月", "腊月",
)


def _fnv1a_ascii(text: str) -> str:
    """与装配层一致的内容指纹算法（FNV-1a over UTF-8 bytes）。"""
    value = 0x811C9DC5
    for byte in text.encode("utf-8"):
        value ^= byte
        value = (value * 0x01000193) & 0xFFFFFFFF
    return f"{value:08x}"


def _relations_digest(relations: list[dict[str, Any]]) -> str:
    """把一组关系压成稳定摘要：只含种类、参与柱、成化状态与阻断条件的有无。

    排序后再拼接，保证与输入顺序无关；全部 ASCII，JS 侧可原样复算。
    """
    tokens = []
    for relation in relations:
        participants = ".".join(str(name) for name in relation.get("participants") or [])
        transformation = relation.get("transformation") or {}
        # 阻断条件实际写在 transformation.blocking_conditions 里（形如
        # "参与柱另见冲动关系：<evidence_id>"）。只看顶层 blocked_by/blocking
        # 会漏掉「阻断条件被换成另一个冲」这类内容变化。
        blocking = sorted(str(item) for item in (transformation.get("blocking_conditions") or []))
        supporting = sorted(str(item) for item in (transformation.get("supporting_conditions") or []))
        # 参与者取值、组合所需值、结果五行、绑定柱的取值都要进摘要：
        # 只记柱名的话，改了某柱的干支取值也会被认为内容未变。
        bindings = "|".join(
            f"{item.get('participant')}={item.get('value')}"
            for item in (relation.get("bindings") or [])
        )
        # 输出字段叫 required_values；写成 values 会永远取到空串，摘要就漏了它
        required = ".".join(
            str(value)
            for value in (relation.get("required_values") or relation.get("values") or [])
        )
        tokens.append(":".join((
            str(relation.get("kind") or ""),
            participants,
            str(transformation.get("status") or ""),
            "|".join(blocking),
            "|".join(supporting),
            bindings,
            required,
            str(relation.get("result_element") or ""),
            # 藏干配对也是关系内容：改了配对而计数/种类不变时同样要能检出
            ",".join(
                f"{pair[0]}{pair[1]}"
                for pair in (relation.get("hidden_stem_pairs") or [])
                if isinstance(pair, (list, tuple)) and len(pair) >= 2
            ),
        )))
    tokens.sort()
    return _fnv1a_ascii(";".join(tokens))


def _luck_digest(luck: Any) -> str:
    """大运摘要：状态、干支、起止与分段边界都要进指纹。

    只哈希干支与关系的话，起运年龄不同导致 luck.from/luck.to 变化时，
    指纹不会变——那就不叫内容指纹了。
    """
    if not isinstance(luck, dict):
        return ""
    segments = luck.get("segments") or []
    token = "|".join((
        str(luck.get("status") or ""),
        str(luck.get("ganzhi") or ""),
        str(luck.get("from") or ""),
        str(luck.get("to") or ""),
        str(len(segments)),
        ",".join(
            # 分段的起止字段叫 start/end；读 from/to 会永远得到空值，
            # 既让分段边界变化检不出，也会和 JS 侧产生 "None" vs "undefined" 的差异
            f"{segment.get('start')}~{segment.get('end')}:{segment.get('ganzhi')}"
            for segment in segments
        ),
    ))
    return _fnv1a_ascii(token)


def month_fingerprint(months: list[dict[str, Any]]) -> str:
    """覆盖边界**与内容**，全 ASCII，便于 JS 侧用同一算法复算。

    内容只取**落盘后一定存在**的字段（夹具是 lean 投影）：
    索引、起止、干支、关系条数/确认数/候选数。
    活动运等更细的字段不进哈希，避免两侧输入不同源。

    注意：必须在 ``attach_relations`` **之后**计算，否则关系计数还是 0，
    指纹就退化成边界哈希。
    """
    parts: list[str] = []
    for month in months:
        parts.append("|".join((
            str(month["index"]),
            str(month["start"]),
            str(month["end"]),
            str(month.get("ganzhi") or ""),
            str(month.get("relation_count") or 0),
            str(month.get("confirmed_count") or 0),
            str(month.get("candidate_count") or 0),
            str(month.get("relations_digest") or ""),
            _luck_digest(month.get("luck")),
            str(month.get("boundary_source") or ""),
            str(month.get("jie") or ""),
            str(month.get("jie_longitude") or ""),
        )))
    return f"mf-{_fnv1a_ascii('||'.join(parts))}"


# 现有关系表覆盖的关系类型；其余类型必须显式列进 unsupported，不能静默漏算。
_COMBINE_KINDS = frozenset({
    "stem-combine",
    "stem-three-combine",
    "branch-six-combine",
    "branch-three-harmony",
    "branch-three-meeting",
    "branch-half-harmony",
    "branch-arch-harmony",
    "branch-half-meeting",
    "branch-arch-meeting",
    "branch-hidden-combine",
})
_CONFLICT_KINDS = frozenset({
    "stem-clash",
    "branch-six-clash",
    "branch-harm",
    "branch-break",
    "branch-punishment",
})

# 关系表已覆盖全部十种（含半合/半会/拱合/拱会/三朋/暗合），
# 这里保持为空元组是有意的：只要还有算不出来的类型就必须显式列进来。
UNSUPPORTED_RELATION_KINDS: tuple[str, ...] = ()

# 藏干五合枚举候选：只是"藏干组合匹配"，不等于严格暗合或合化成立。
# 它不进 _COMBINE_KINDS，因此不会被当作已成组合去算阻碍/合化。
_CANDIDATE_KINDS = frozenset({"branch-hidden-stem-combine-candidate"})

# 上游 _annotate_transformation_reviews 只对原来这四类给出成化审查结果。
# 新增的半合/拱合/半会/拱会/三朋/暗合没有对应审查，**不能**回填成化候选——
# 那会让消费者以为它们也走过成化判定（暗合甚至会拿到 target_element 为 null 的候选）。
_TRANSFORMATION_AUDITED_KINDS = frozenset({
    "stem-combine",
    "branch-six-combine",
    "branch-three-harmony",
    "branch-three-meeting",
})

def _count_relations(relations: list[dict[str, Any]]) -> tuple[int, int, int]:
    """返回 (总条数, 确定关系数, 候选数)。

    relation_count 保持"等于数组条数"的既有契约（逐月计数验收要求），
    强弱区分靠另外两个字段：confirmed_count 与 candidate_count。
    """
    candidates = sum(1 for item in relations if item.get("kind") in _CANDIDATE_KINDS)
    return len(relations), len(relations) - candidates, candidates



def _fmt_instant(value: datetime) -> str:
    """统一成带冒号的 ISO-8601 北京时间，**保留微秒**。

    早期版本把边界四舍五入到整秒，导致「引擎交节 10:00:00.400、发布 10:00:00」
    这类偏差：0.4 秒内的输入按发布区间会归入新月，而引擎判旧月。
    现在原样发布引擎给的时刻，``instant_resolution`` 也相应改为微秒级。
    相邻月用同一个边界字符串，所以不会有缝或重叠。
    """
    # strftime 的 %f 才能带微秒，而 INSTANT_FORMAT 里没有它；
    # 这里显式拼，保证发布值与引擎时刻完全一致。
    base = value.strftime("%Y-%m-%dT%H:%M:%S")
    micro = f".{value.microsecond:06d}" if value.microsecond else ""
    offset = value.strftime("%z")
    return f"{base}{micro}{offset[:3]}:{offset[3:]}"


def _boundaries(target_year: int) -> list[dict[str, Any]]:
    """返回 13 个节气边界：立春(Y) … 小寒(Y+1) … 立春(Y+1)。"""
    year = int(target_year)
    spec: list[tuple[float, int, str, int]] = []
    for index, (longitude, name, zhi_index) in enumerate(_MONTH_JIE):
        # 第 12 个月（丑）的起始节气是次年小寒；收尾边界是次年立春。
        owner_year = year + 1 if index == len(_MONTH_JIE) - 1 else year
        spec.append((longitude, owner_year, name, zhi_index))
    spec.append((315.0, year + 1, "立春", 2))

    return [
        {
            "at": engine.solar_term_beijing(owner_year, longitude),
            "longitude": longitude,
            "jie": name,
            "zhi_index": zhi_index,
            "owner_year": owner_year,
        }
        for longitude, owner_year, name, zhi_index in spec
    ]


def _validation(months: list[dict[str, Any]], target_year: int) -> dict[str, Any]:
    checks: list[dict[str, Any]] = []

    def record(check_id: str, ok: bool, detail: str) -> None:
        checks.append({"id": check_id, "pass": bool(ok), "detail": detail})

    record("months.count", len(months) == MONTH_COUNT, f"实际 {len(months)} 个")
    record(
        "months.index",
        [m["index"] for m in months] == list(range(1, MONTH_COUNT + 1)),
        "索引应为 1..12 各一次",
    )

    contiguous = all(
        months[i]["end"] == months[i + 1]["start"] for i in range(len(months) - 1)
    )
    record("months.contiguous", contiguous, "相邻月首尾必须相接且不重叠")

    ordered = all(m["start"] < m["end"] for m in months)
    record("months.order", ordered, "每月起点必须早于终点")

    gan_zhi_ok = all(
        m["ganzhi"] == m["gan"] + m["zhi"] and len(m["ganzhi"]) == 2 for m in months
    )
    record("months.ganzhi", gan_zhi_ok, "干支拼接必须与分字段一致")

    record(
        "months.boundary_year",
        months[0]["start"] == _fmt_instant(engine.solar_term_beijing(target_year, 315))
        and months[-1]["end"]
        == _fmt_instant(engine.solar_term_beijing(target_year + 1, 315)),
        "首月起点应为当年立春，末月终点应为次年立春",
    )

    # 作用域诚实性：包自己声明「算过哪些层、没算哪些层」，那就必须自洽。
    # 让事实包在返回前先自检，比只靠外部测试更能防住以后改坏。
    # 注意：不传 calculation 时根本不做关系审计，月份里没有 relation_scope，
    # 这类检查此时无从谈起，直接跳过而不是判失败。
    scopes = [m.get("relation_scope") for m in months]
    audited = any(isinstance(scope, dict) for scope in scopes)
    if audited:
        record(
            "months.relation_scope_present",
            all(isinstance(scope, dict) and scope.get("computed_layers") for scope in scopes),
            "每个月都必须带 computed_layers",
        )
        record(
            "months.relation_scope_disjoint",
            all(
                not set(scope["computed_layers"]) & set(scope.get("omitted_layers") or [])
                for scope in scopes
                if isinstance(scope, dict) and scope.get("computed_layers")
            ),
            "同一层不能既算过又声明没算",
        )
        record(
            "months.relation_scope_reason",
            all(
                scope.get("reason")
                for scope in scopes
                if isinstance(scope, dict) and scope.get("omitted_layers")
            ),
            "声明了没算的层就必须说明原因",
        )
        # 段数一致性要按「声明」来要求，而不是按「有没有数组」来过滤。
        # 否则把 relation_segments 整个删掉，月份就被过滤掉，检查反而通过。
        # 口径：声明 >1 段 → 数组长度必须相等；声明 0 或 1 段 → 不应存在分段数组。
        def _segments_match(month: dict[str, Any], scope: dict[str, Any]) -> bool:
            declared = int(scope.get("segments") or 0)
            actual = len(month.get("relation_segments") or [])
            if declared > 1:
                return actual == declared
            return actual == 0

        record(
            "months.natal_complete",
            all(
                scope.get("natal_complete") is not None
                for scope in scopes if isinstance(scope, dict)
            ) if audited else True,
            "逐月 scope 必须显式标注原局四柱是否完整",
        )
        record(
            "months.natal_completeness_consistent",
            all(
                (scope.get("natal_complete") is not False) or bool(scope.get("reason"))
                for scope in scopes if isinstance(scope, dict)
            ),
            "四柱不全时必须在 scope 里说明",
        )
        record(
            "months.relation_segments",
            all(
                _segments_match(month, scope)
                for month, scope in zip(months, scopes)
                if isinstance(scope, dict)
            ),
            "声明切成 N 段就必须真有 N 段明细；没声明分段就不该有分段数组",
        )

    return {
        "status": "pass" if all(c["pass"] for c in checks) else "fail",
        "checks": checks,
    }


def build_monthly_facts(
    calculation: dict[str, Any] | None,
    target_year: int,
    normalized_input: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """构建目标年份的 12 个流月坐标。

    ``calculation`` 只用于把结果绑回命盘（本命年柱等）；边界与干支完全由
    ``target_year`` 决定，因此传 ``None`` 也能算出同样的坐标。
    传入 ``calculation`` 时会顺带做四层关系审计（见 ``attach_relations``）。
    """
    year = _coerce_year(target_year)
    if year is None:
        # 2026.9 被 int() 截成 2026 会悄悄返回一个"看起来正常"的年份包，
        # 调用方却以为自己要的是别的年份。宁可显式拒绝。
        return {
            "schema_version": SCHEMA_VERSION,
            "system": "bazi",
            "scope": "monthly",
            "target_year": None,
            "status": "unsupported",
            "reason": f"目标年份必须是整数，收到 {target_year!r}",
            "months": [],
            "half_years": {},
            "validation": {"status": "fail", "checks": []},
        }
    if not (MIN_TARGET_YEAR <= year <= MAX_TARGET_YEAR):
        return {
            "schema_version": SCHEMA_VERSION,
            "system": "bazi",
            "scope": "monthly",
            "target_year": year,
            "status": "unsupported",
            "reason": f"目标年份超出引擎定气覆盖范围 {MIN_TARGET_YEAR}–{MAX_TARGET_YEAR}",
            "months": [],
            "half_years": {},
            "validation": {"status": "fail", "checks": []},
        }

    annual_gz = engine.liunian_gz(year)
    annual_gan, annual_zhi = annual_gz[0], annual_gz[1]
    annual_gan_index = engine.GAN.index(annual_gan)
    yin_stem = engine.YUE_GAN_YIN[annual_gan_index]

    edges = _boundaries(year)
    months: list[dict[str, Any]] = []

    for i in range(MONTH_COUNT):
        head = edges[i]
        tail = edges[i + 1]
        zhi_index = head["zhi_index"]
        zhi = engine.ZHI[zhi_index]
        gan = engine.GAN[(yin_stem + i) % 10]
        start_dt: datetime = head["at"]
        end_dt: datetime = tail["at"]

        months.append(
            {
                "index": i + 1,
                # 寅月为正月，月支来自节的定义，不按公历推算
                "label": MONTH_LABELS[i],
                "gan": gan,
                "zhi": zhi,
                "ganzhi": gan + zhi,
                "jie": head["jie"],
                "jie_longitude": head["longitude"],
                "start": _fmt_instant(start_dt),
                "end": _fmt_instant(end_dt),
                "start_utc_offset": "+08:00",
                "duration_days": round((end_dt - start_dt).total_seconds() / 86400.0, 4),
                "boundary_source": "solar_term_apparent_longitude",
                "evidence_id": f"monthly.months[{i}]",
                # RFC 6901：数组下标用斜杠分段，不是 [i]
                "json_pointer": f"/months/{i}",
                "status": "ok",
            }
        )

    first_half = months[:6]
    second_half = months[6:]

    # 每个月的终点就是下个月的起点节气；丑月的终点回到次年立春。
    for position, month in enumerate(months):
        month["next_jie"] = (
            months[position + 1]["jie"] if position + 1 < len(months) else "立春"
        )

    def summarize(group: list[dict[str, Any]]) -> dict[str, Any]:
        return {
            "months": [m["index"] for m in group],
            "start": group[0]["start"],
            "end": group[-1]["end"],
            "first_ganzhi": group[0]["ganzhi"],
            "last_ganzhi": group[-1]["ganzhi"],
            "evidence_ids": [m["evidence_id"] for m in group],
        }

    pillars = (calculation or {}).get("pillars") if isinstance(calculation, dict) else None

    facts = {
        "schema_version": SCHEMA_VERSION,
        "system": "bazi",
        "scope": "monthly",
        "target_year": year,
        "status": "ok",
        "annual": {"year": year, "gan": annual_gan, "zhi": annual_zhi, "ganzhi": annual_gz},
        "coordinate": {
            "year_boundary": "exact_lichun",
            "month_boundary": "twelve_jie",
            "timezone": "UTC+08:00",
            "interval": "half_open[start,end)",
            "instant_resolution": "1us",
            "instant_note": "引擎给出带微秒的节气时刻，事实包按秒级四舍五入发布；"
                            "相邻月共用同一字符串，故无缝隙无重叠，边界位置误差 ≤0.5 秒。",
            "engine": "pai_pan.solar_term_beijing(apparent_solar_longitude)",
        },
        "birth_pillars": (
            {name: pillars.get(name) for name in ("year", "month", "day", "hour")}
            if isinstance(pillars, dict)
            else None
        ),
        "months": months,
        "half_years": {
            "first_half": summarize(first_half),
            "second_half": summarize(second_half),
        },
        # 边界内容指纹：装配层会复算并比对，防止上游通过后边界被改动仍蒙混过关
        "validation": _validation(months, year),
    }

    if isinstance(calculation, dict):
        attach_relations(facts, calculation, normalized_input)
    else:
        # 没有命盘资料时不走 attach_relations，但 months 与半年汇总照样带
        # evidence_id；这里补一份月份索引，避免消费方拿到无法解析的引用。
        index: dict[str, str] = {}
        for month in facts.get("months") or []:
            pointer = month.get("json_pointer") or f"/months/{month['index'] - 1}"
            month.setdefault("json_pointer", pointer)
            evidence_id = month.get("evidence_id")
            if evidence_id:
                index[evidence_id] = pointer
        facts["evidence_index"] = index

    # 关系审计会往每个月里写 relation_scope / relation_segments，
    # 所以「作用域自洽」这类检查必须在审计之后再跑一遍；否则看到的是空的 scope。
    facts["validation"] = _validation(facts["months"], year)
    # 指纹要覆盖内容：先给每个月算一份关系摘要，
    # 只哈希计数不够——参与者/类型/成化状态变了而计数不变时会被漏掉。
    for month in facts["months"]:
        month["relations_digest"] = _relations_digest(month.get("relations") or [])
    facts["fingerprint"] = month_fingerprint(facts["months"])

    return facts


# ---------------------------------------------------------------------------
# 四层关系审计（原局 / 大运 / 流年 / 流月）
# ---------------------------------------------------------------------------


def _add_months(moment: datetime, months: int) -> datetime:
    """按月推移，日取原值并在月末截断（足够比较运限边界）。

    不用「逐个递减 day 重试」那套：年份越界（如 9999 年 + 12 月）时递减永远修不好，
    会死循环。这里直接算目标年月，再用 calendar 取该月最后一天做夹取。
    """
    total = moment.month - 1 + months
    year = moment.year + total // 12
    month = total % 12 + 1
    if not (1 <= year <= 9999):
        raise ValueError(f"月份推移超出可表示范围：{moment.isoformat()} + {months} 月")
    day = min(moment.day, calendar.monthrange(year, month)[1])
    return moment.replace(year=year, month=month, day=day)


_DATE_TEXT = re.compile(r"^(\d{4})-(\d{1,2})-(\d{1,2})$")
_TIME_TEXT = re.compile(r"^(\d{1,2}):(\d{2})$")

# 出生时刻精度只有这三种口径（与 bazi.normalize 的校验一致）。
# 只有 minute 才允许信任 value，只有 branch 才允许信任 branch——
# 精度未知时手上那个字符串不代表任何已确认的东西，不能拿去定换运点。
_PRECISION_MINUTE = "minute"
_PRECISION_BRANCH = "branch"

# 只知时辰时，我们取的是窗口中点；真实时刻落在中点前后各半个窗口内。
BIRTH_BRANCH_TOLERANCE = timedelta(hours=1)          # 两小时窗口
BIRTH_ZISHI_TOLERANCE = timedelta(minutes=30)        # 子时按早/晚拆开后只有一小时窗口
# 但「只知子时」无法确定是早子还是晚子（上游日柱也是按早子取的，不能反过来当证据），
# 两者相差约 23 小时，所以不确定度要放大到能同时覆盖两种可能。
BIRTH_ZISHI_AMBIGUITY = timedelta(hours=12)
# 起运年龄是从出生时刻到节气的距离按「三日折一年」算出来的，
# 所以**任何**出生时刻的偏差都会等比例放大成换运点的漂移：
#   出生每偏 1 天 → 起运偏 1/3 年（约 121.75 天）
# 只知时辰（±1 小时）就要多算约 5 天，只知子时（±12 小时）要多算约 61 天。
QIYUN_PER_BIRTH_DAY = 365.25 / 3


def _upstream_qiyun_gap(normalized_input: dict[str, Any] | None) -> timedelta | None:
    """真实出生时刻与**上游起运基准时刻**之间最多差多少。

    上游 `pai_pan.SHICHEN_MID` 只知时辰时按固定代表点算起运：子＝00:00、其余＝偶数点。
    所以：
      - 分钟精度：与基准一致，差 0；
      - 其它时辰：真实时刻在窗口内，离基准最远 1 小时；
      - 子时：基准是 00:00，真实可能是当晚 23:30，最远 23.5 小时。
    这个差值会按「三日折一年」放大成换运点漂移，必须单独算，不能拿 instantaneous 容差顶替。
    """
    profile = ((normalized_input or {}).get("profile") or {})
    time_block = profile.get("time") or {}
    precision = time_block.get("precision")
    if precision == _PRECISION_MINUTE:
        return timedelta(0)
    if precision != _PRECISION_BRANCH:
        return None
    if time_block.get("branch") == "子":
        # 晚子窗口是 [23:00, 24:00)，最晚可到 23:59:59 —— 与 00:00 基准相差接近整整 24 小时。
        # 早先写 23.5 小时是按「中点 23:30」算的，少计了半小时的起运敏感度（约 2.5 天）。
        return timedelta(hours=24)
    return BIRTH_BRANCH_TOLERANCE


def _qiyun_sensitivity(birth_tolerance: timedelta) -> timedelta:
    """出生时刻不确定度换算成换运点漂移。"""
    return birth_tolerance * QIYUN_PER_BIRTH_DAY


def _jie_straddling_birth(
    birth: datetime, window: timedelta
) -> datetime | None:
    """出生时刻窗口里是否卡着一个「节」。

    起运年龄是从出生**到最近那个节**的距离算的。窗口一旦跨过节，
    上游按代表时刻选的节就会换成相邻的那一节，起运年龄可能整整差出一运（约十年）——
    这已经不是"漂移几天"能覆盖的量级，必须整体判为不确定。
    """
    if window <= timedelta(0):
        return None
    # 边界日期（如 9999-12-31）加减窗口会溢出，夹到 datetime 能表示的范围
    try:
        low = birth - window
    except OverflowError:
        low = datetime.min.replace(tzinfo=birth.tzinfo)
    try:
        high = birth + window
    except OverflowError:
        high = datetime.max.replace(tzinfo=birth.tzinfo)
    # 只看前后各一年内的节，足够覆盖任何现实出生日期；年份夹进可计算范围
    first = max(low.year - 1, 1)
    last = min(high.year, 9998)
    for owner_year in range(first, last + 1):
        for entry in _boundaries(owner_year):
            moment = entry["at"]
            if low <= moment <= high:
                return moment
    return None


def _birth_time_tolerance(
    normalized_input: dict[str, Any] | None,
) -> timedelta | None:
    """出生时刻的不确定度。None 表示「连精度都不知道」，此时一切时刻都不可信。"""
    profile = ((normalized_input or {}).get("profile") or {})
    time_block = profile.get("time") or {}
    precision = time_block.get("precision")
    if precision == _PRECISION_MINUTE:
        return timedelta(0)
    if precision != _PRECISION_BRANCH:
        return None

    if time_block.get("branch") == "子":
        # 子时跨日界：早子（D 00:30 附近）与晚子（D 23:30 附近）相差约 23 小时。
        # 估算点取两者中点 12:00，配 ±12 小时正好覆盖两种可能。
        # 不能用上游日柱定夺——上游在「只知子时」时本身就按早子取日柱，属于循环论证。
        parsed = _parse_solar_date(profile.get("solar_date"))
        if parsed is None:
            return None
        return BIRTH_ZISHI_AMBIGUITY
    return BIRTH_BRANCH_TOLERANCE


def _parse_solar_date(value: Any) -> tuple[int, int, int] | None:
    """严格解析公历日期。格式不合法或不是真实日期返回 None，不抛异常。

    ``2024-02-30`` 能通过整数拆分，但构造 datetime 会抛 ValueError；
    这种输入必须在进入排盘前就被判为「没有可用日期」，而不是把调用打崩。
    """
    if not isinstance(value, str):
        return None
    match = _DATE_TEXT.match(value.strip())
    if not match:
        return None
    year, month, day = (int(part) for part in match.groups())
    try:
        datetime(year, month, day)  # 只借它校验真实性，不用返回值
    except ValueError:
        return None
    return year, month, day


def _parse_minute_time(value: Any) -> tuple[int, int] | None:
    """严格解析 HH:MM。多出来的秒段、非法小时/分钟一律拒绝。

    旧实现用 ``split(":")[:2]``，``12:30:99`` 会被截成 ``12:30`` 静默接受，
    等于把一个非法输入当成合法时刻去定换运边界。
    """
    if not isinstance(value, str):
        return None
    match = _TIME_TEXT.match(value.strip())
    if not match:
        return None
    hour, minute = int(match.group(1)), int(match.group(2))
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        return None
    return hour, minute


def _classify_boundaries(
    start_at: datetime | None,
    end_at: datetime | None,
    boundaries: list[datetime],
    tolerance: timedelta | None,
) -> dict[str, Any]:
    """判定本月与换运点的关系：single（整月一运）/ split（月内换运）/ ambiguous（贴着月界）。

    ``tolerance`` 是出生时刻的不确定度：
      - ``None`` 表示连精度都不知道 → ``kind="unknown"``，任何归属都不能声称；
      - 换运点落在月界 ±tolerance 之内 → 无法确定它在本月还是邻月，整月归属都不确定；
      - 换运点严格落在月内且距两端都超过 tolerance → 切在哪一侧是确定的，可以拆；
      - 其余 → 本月没有换运点。
    纯函数，便于用构造出来的时刻直接验证，不必靠扫描真实历法去撞一个 ±1 小时的巧合。
    """
    if start_at is None or end_at is None:
        return {"kind": "single", "split": [], "ambiguous": []}


    # 精度未知时不能退化成「精确」：`None or timedelta(0)` 会悄悄把
    # 「什么都不知道」变成「误差为零」，那是这套逻辑里最危险的一种默认值。
    if tolerance is None:
        return {"kind": "unknown", "split": [], "ambiguous": []}

    tol = tolerance or timedelta(0)

    # 精确到分钟时没有不确定度：按半开区间 [start, end) 判，
    # 恰好落在月初的换运点整月归新运（单一大运），落在月末的不属于本月。
    if tol == timedelta(0):
        strict = _boundaries_within(start_at, end_at, boundaries)
        return (
            {"kind": "split", "split": strict, "ambiguous": []}
            if strict
            else {"kind": "single", "split": [], "ambiguous": []}
        )

    # 容差带必须两端都闭合：估算点恰好落在 start±tol 或 end±tol 时，
    # 真实点仍可能跨进月内，判成 single 会给整月绑死一个错误的大运。
    near = [
        moment for moment in boundaries
        if (start_at - tol <= moment <= start_at + tol)
        or (end_at - tol <= moment <= end_at + tol)
    ]
    if near:
        return {"kind": "ambiguous", "split": [], "ambiguous": near}

    # 收缩容差后再判「严格落在月内」，复用同一份半开区间语义
    strict = _boundaries_within(start_at + tol, end_at - tol, boundaries)
    if strict:
        return {"kind": "split", "split": strict, "ambiguous": []}

    return {"kind": "single", "split": [], "ambiguous": []}


def _zishi_instant(year: int, month: int, day: int) -> datetime:
    """子时的代表时刻：早子 00:30 与晚子 23:30 之间的**中点** 12:00。

    为什么不是 00:30：只知子时无法判断是早子还是晚子，两者相差约 23 小时。
    取其一作为估算点，配上对称的容差带就盖不住另一侧（±12 小时只到 12:30）。
    取两者中点，再配 ±12 小时，正好把两种可能都覆盖进来。

    也**不能**用上游日柱来定夺：上游在「只知子时」时本身就按早子取日柱，
    拿它反推等于用结论证明前提。
    """
    return datetime(year, month, day, 12, 0, tzinfo=engine.BJ)


def _birth_datetime(
    normalized_input: dict[str, Any] | None,
) -> datetime | None:
    """出生时刻。精度决定能信任哪一部分输入。

    - ``precision == "minute"``：用 ``value`` 的时分，严格校验 HH:MM
    - ``precision == "branch"``：取该时辰窗口的中点；子时取早/晚子的中点 12:00
    - 其余（``unknown``、缺失、非法）：返回 None —— 起运与换运边界无从确定，
      调用方必须标 unavailable，不能用一个假定时刻算出看起来确定的大运。
    """
    profile = ((normalized_input or {}).get("profile") or {})
    parsed_date = _parse_solar_date(profile.get("solar_date"))
    if parsed_date is None:
        return None
    year, month, day = parsed_date

    time_block = profile.get("time") or {}
    precision = time_block.get("precision")

    if precision == _PRECISION_MINUTE:
        parsed_time = _parse_minute_time(time_block.get("value"))
        if parsed_time is None:
            return None
        hour, minute = parsed_time
    elif precision == _PRECISION_BRANCH:
        branch = time_block.get("branch")
        if not isinstance(branch, str) or branch not in engine.ZHI:
            return None
        if branch == "子":
            return _zishi_instant(year, month, day)
        # 时辰中点：丑时 01:00–03:00 中点 02:00，即 hour = index*2，整点、无分钟偏移。
        hour = (engine.ZHI.index(branch) * 2) % 24
        minute = 0
    else:
        return None

    return datetime(year, month, day, hour, minute, tzinfo=engine.BJ)


def _real_cycles(calculation: dict[str, Any] | None) -> list[dict[str, Any]]:
    """筛出真正的大运周期。

    「起运前 0岁-7岁3个月」是小运行，不是大运；
    这里额外要求：年龄区间形如 N-M岁、干支是合法两字、序号可解析，
    并按序号排序，避免把起运前记录当第一个十年周期导致整体后移。
    """
    cycles = ((calculation or {}).get("luck_cycles") or {}).get("cycles") or []
    real: list[dict[str, Any]] = []
    for cycle in cycles:
        if not _AGE_RANGE.match(str(cycle.get("age_range", ""))):
            continue
        gan_zhi = str(cycle.get("ganzhi", ""))
        if len(gan_zhi) != 2 or gan_zhi[0] not in engine.GAN or gan_zhi[1] not in engine.ZHI:
            continue
        try:
            sequence = int(str(cycle.get("sequence")))
        except (TypeError, ValueError):
            continue
        real.append({**cycle, "_sequence": sequence})
    real.sort(key=lambda item: item["_sequence"])
    return real


_ABSENT = object()


def _int_or_absent(value: Any) -> Any:
    """解析成 int；读不懂返回 None。

    **显式 None 视为「给了但读不懂」**，不是「没给」——「哪一年未知」和「没有这一年」
    是两件事，把前者当 0 会凭空造出一个确定的起运年龄。
    「没给」由调用方按 key 是否存在判断（见 ``_qiyun_offset``）。

    浮点也要当心：``int(7.9)`` 会静默截断成 7，``int(inf)`` 直接抛异常。
    """
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        if not math.isfinite(value) or not value.is_integer():
            return None
        return int(value)
    if isinstance(value, str):
        text = value.strip()
        if not re.fullmatch(r"[+-]?\d+", text):
            return None
        try:
            return int(text)
        except (TypeError, ValueError, OverflowError):
            return None
    return None


def _coerce_year(value: Any) -> int | None:
    """目标年份必须是真正的整数。``int(2026.9)`` 会静默截成 2026，不许这样蒙混。"""
    parsed = _int_or_absent(value)
    if parsed is _ABSENT or parsed is None:
        return None
    return parsed


def _qiyun_offset(start: Any) -> tuple[int, int] | None:
    """把起运数据读成 (总月数, 天数)。缺数据返回 None，绝不当成 0 岁起运。

    ``precision`` 声称到什么粒度，就必须真的给到那个粒度：
    写着 ``precision="days"`` 却没有有效 ``days``，把那天当成 0 会把带天数的
    换运点算成整月，进而被当成"精确"去切月。字段存在但读不懂时一律判不可用。
    """
    if not isinstance(start, dict) or not start:
        return None
    if not ({"years", "months", "days"} & set(start)):
        return None

    precision = str(start.get("precision") or "months")
    # 「字段不存在」才是缺省；「字段存在但是 null」是给了但读不懂，必须整条判不可用
    def take(key: str) -> Any:
        return _ABSENT if key not in start else _int_or_absent(start[key])

    years = take("years")
    months = take("months")
    days = take("days")

    # 给了但读不懂 → 数据有误，不要用剩下的字段凑一个结论
    if None in (years, months, days):
        return None

    # 年起运、月起运都必须给到位：缺哪个都不能按 0 补。
    # 缺年份最多少算十几年，缺月份最多少算 11 个月——两者都远超容差，
    # 足以把换运点算到别的年份。上游 pai_pan 总是给全 {years, months, days}，
    # 所以这条严格口径不会误伤真实数据。
    if years is _ABSENT or months is _ABSENT:
        return None
    if precision == "days" and days is _ABSENT:
        return None

    years_value = 0 if years is _ABSENT else years
    months_value = 0 if months is _ABSENT else months
    days_value = 0 if days is _ABSENT else days
    if years_value < 0 or months_value < 0 or days_value < 0:
        return None
    return years_value * 12 + months_value, days_value


def resolve_dayun_at(
    calculation: dict[str, Any] | None,
    normalized_input: dict[str, Any] | None,
    moment: datetime | None,
) -> dict[str, Any]:
    """定位某一时刻所处的大运。

    大运每十年一换，换运点可能落在目标年内部，所以**必须按时刻逐个定位**，
    不能整年共用一个。换运点 = 出生时刻 + 起运（年+月）+ k×10 年。
    """
    if moment is None:
        return {"status": "unavailable", "reason": "缺少可比对的时刻"}
    if not isinstance(moment, datetime):
        return {
            "status": "unavailable",
            "reason": f"时刻必须是 datetime，收到 {type(moment).__name__}",
        }
    # 统一到北京时间再比：naive datetime 与带时区的时刻直接比较会抛 TypeError
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=engine.BJ)
    else:
        moment = moment.astimezone(engine.BJ)

    birth = _birth_datetime(normalized_input)
    if birth is None:
        return {"status": "unavailable", "reason": "缺少出生公历日期，无法换算运限"}

    cycles = _real_cycles(calculation)
    if not cycles:
        return {"status": "unavailable", "reason": "没有可用的大运排布"}

    start = ((calculation or {}).get("luck_cycles") or {}).get("start")
    offset = _qiyun_offset(start)
    if offset is None:
        # 有周期但没有起运数据：不能把起运当成 0 岁，
        # 那等于宣称「出生即起运」，会产出一套看起来确定、实际无依据的换运时刻。
        return {
            "status": "unavailable",
            "reason": "缺少起运数据（years/months/days），无法确定换运时刻",
        }
    qiyun_months, qiyun_days = offset
    try:
        base = _add_months(birth, qiyun_months) + timedelta(days=qiyun_days)
    except (ValueError, OverflowError) as error:
        # 起运偏移把时刻推出可表示范围（例如出生 9999 年 + 1 年）：
        # 这不是"算出个近似值"的场景，必须显式说不可用，不能把异常抛给调用方。
        return {"status": "unavailable", "reason": f"起运时刻超出可表示范围：{error}"}

    if moment < base:
        return {
            "status": "before_start",
            "reason": "该时刻尚未起运，属小运阶段",
            "at": moment.isoformat(),
        }

    for cycle in cycles:
        # 用周期自己的 sequence 定位十年区间，不能用筛选后数组的下标：
        # _real_cycles 会丢掉非法行，一旦中间缺一条，按下标排会把后面每一运都提前十年。
        try:
            sequence = int(cycle["_sequence"])
        except (KeyError, TypeError, ValueError):
            continue
        if sequence < 1:
            continue
        try:
            lower = _add_months(base, (sequence - 1) * 120)
            upper = _add_months(base, sequence * 120)
        except (ValueError, OverflowError):
            continue        # 该十年超出可表示范围，跳过而不是崩掉整年
        if lower <= moment < upper:
            gan_zhi = str(cycle.get("ganzhi", ""))
            return {
                "status": "ok",
                "sequence": cycle.get("sequence"),
                "age_range": cycle.get("age_range"),
                "ganzhi": gan_zhi,
                "gan": gan_zhi[0] if len(gan_zhi) >= 2 else None,
                "zhi": gan_zhi[1] if len(gan_zhi) >= 2 else None,
                "from": lower.isoformat(),
                "to": upper.isoformat(),
                "at": moment.isoformat(),
            }

    return {
        "status": "unavailable",
        "reason": "该时刻超出已排大运范围",
        "at": moment.isoformat(),
    }


def _dayun_boundaries(
    calculation: dict[str, Any] | None,
    normalized_input: dict[str, Any] | None,
) -> list[datetime]:
    """所有换运时刻（不含出生）。用于判断某个月是否被换运点切开。"""
    birth = _birth_datetime(normalized_input)
    cycles = _real_cycles(calculation)
    if birth is None or not cycles:
        return []
    start = ((calculation or {}).get("luck_cycles") or {}).get("start")
    offset = _qiyun_offset(start)
    if offset is None:
        return []   # 缺起运数据就没有可信的换运时刻，不能假设 0 岁起运
    qiyun_months, qiyun_days = offset
    try:
        base = _add_months(birth, qiyun_months) + timedelta(days=qiyun_days)
    except (ValueError, OverflowError):
        # 同样：算不出可信的换运时刻就没有边界，不能让异常冒到 build_monthly_facts
        return []
    # 换运点同样按周期自己的 sequence 推：漏掉一条时不能把后面整体前移。
    # 每运的**起点与终点**都要列进来——中间缺一条时（如序号 1、3 缺 2），
    # 第 1 运的结束时刻本身就是一个覆盖变化点，漏掉它会让那个月不被拆分。
    sequences = sorted(
        {
            int(cycle["_sequence"])
            for cycle in cycles
            if isinstance(cycle.get("_sequence"), int) and cycle["_sequence"] >= 1
        }
    )
    if not sequences:
        return []
    boundaries = {base}      # 起运时刻本身就是一次切换：之前是 before_start，之后才进第一运
    for sequence in sequences:
        try:
            boundaries.add(_add_months(base, (sequence - 1) * 120))
            boundaries.add(_add_months(base, sequence * 120))
        except (ValueError, OverflowError):
            continue        # 该序列的边界超出可表示范围，跳过而不是崩掉整年
    return sorted(boundaries)


def _parse_instant(text: Any) -> datetime | None:
    if not isinstance(text, str) or not text:
        return None
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        return None


def _boundaries_within(
    start_at: datetime | None,
    end_at: datetime | None,
    boundaries: list[datetime],
) -> list[datetime]:
    """半开区间 [start, end) 内的换运点。

    换运时刻**恰好等于 start** 时不算跨界：从这一刻起整月都属于新大运。
    只有严格落在区间内部（start < b < end）才需要拆分或标记。
    """
    if start_at is None or end_at is None:
        return []
    return [boundary for boundary in boundaries if start_at < boundary < end_at]


def _month_midpoint(month: dict[str, Any]) -> datetime | None:
    start = _parse_instant(month.get("start"))
    end = _parse_instant(month.get("end"))
    if start is None or end is None:
        return None
    return start + (end - start) / 2


def resolve_dayun(
    calculation: dict[str, Any] | None,
    normalized_input: dict[str, Any] | None,
    target_year: int,
) -> dict[str, Any]:
    """按**年中**定位大运的便捷入口。

    只适合「整年不变运」的场景。跨运年请用 ``resolve_dayun_at`` 逐月定位，
    否则换运前后的月份会绑定同一个大运。
    """
    year = _coerce_year(target_year)
    if year is None:
        return {
            "status": "unavailable",
            "reason": f"目标年份必须是整数，收到 {target_year!r}",
            "scope": "mid-year",
        }
    if not (1 <= year <= 9999):
        # datetime 只到 9999 年；直接构造会在这一层抛 ValueError 而不是给出"不可用"
        return {
            "status": "unavailable",
            "reason": f"目标年份超出可表示范围：{year}",
            "scope": "mid-year",
        }
    moment = datetime(year, 7, 1, 12, 0, tzinfo=engine.BJ)
    resolved = resolve_dayun_at(calculation, normalized_input, moment)
    resolved["scope"] = "mid-year"
    return resolved


def _transit_pillar(stem: str, branch: str) -> dict[str, Any]:
    """流运参与柱（流年/流月/大运）也要带隐藏天干。

    成化审计按 ``hidden["element"]`` 统计藏干支持，所以形状必须与上游原局柱一致：
    ``[{"stem": ..., "element": ...}]``。给裸字符串会直接 TypeError。
    """
    return {
        "stem": stem,
        "branch": branch,
        "hidden_stems": [
            {"stem": hidden, "element": relations_lib.STEM_ELEMENT[hidden]}
            for hidden in relations_lib.HIDDEN_STEMS.get(branch, ())
        ],
    }


# 纯原局关系在 _relation_facts 里被跳过；用 ContextVar 收集，
# 不必给每个调用点加参数。
_NATAL_RELATION_SINK: ContextVar[list[dict[str, Any]] | None] = ContextVar(
    "_NATAL_RELATION_SINK", default=None
)


def _omit_luck_suggestion(segments: list[dict[str, Any]], cause: str) -> str:
    """按**实际原因**说明为什么某些段没有大运层。

    省略大运可能是两件完全不同的事：
      - 起运前的子区间：本来就没有大运可绑，属正常；
      - 换运点 ±容差的不确定带：归属说不清，带期满/提高精度才能确定。
    原先无论哪种都写成「起运前」，会把不确定带误导成起运前阶段。
    """
    before_start = any(
        "起运前" in str((segment.get("luck") or {}).get("reason") or "")
        for segment in segments
    )
    in_band = any(segment.get("uncertain_band") for segment in segments)
    if before_start and in_band:
        return (
            f"本月既有起运前的子区间，也有换运点附近的带（{cause}）；"
            "前者需等到起运后，后者需更高精度才能确定归属。"
        )
    if in_band:
        return f"换运点附近的不确定带（{cause}）不绑定大运；提高输入精度可收窄该带。"
    return "起运前的子区间没有大运可绑定，属正常情况；若要大运全覆盖，需等到起运后。"


def _relation_facts(
    month_index: int, pillars: dict[str, Any], suffix: str = "",
) -> list[dict[str, Any]]:
    """对一组参与柱跑关系审计，重写证据路径并补层标签。

    ``month_index`` 是 1 起的月序，但 ``months`` 是零基数组，所以证据路径必须用
    ``month_index - 1``，否则每条关系都会指到下一个月份。
    ``suffix`` 用于同一个月被切成多段时区分证据 ID（如 ``.seg2``）。
    纯原局之间的关系已经被 ``bazi_facts`` 收录，这里跳过，避免两处重复。
    """
    zero_based = month_index - 1
    all_facts = list(relations_lib._pair_relations(pillars))
    # 阻断条件必须从**全部**关系里找（含纯原局冲突）。若只在已保留的跨层事实里找，
    # 「原局甲庚冲、流月己与年柱甲合」这类组合会被误判为结构完整。
    conflicts_all = [fact for fact in all_facts if fact["kind"] in _CONFLICT_KINDS]
    # 成化条件审计直接复用上游实现（月令、透干、藏支），不自己另写一套静态文案。
    annotated = {
        fact["evidence_id"]: fact
        for fact in relations_lib._annotate_transformation_reviews(pillars, all_facts)
    }

    facts: list[dict[str, Any]] = []
    # 上游审计与阻断引用都用**原始** evidence_id；输出改用月度 ID，
    # 所以必须留一张原始→月度 的映射，否则查不到审计结果、也判断不了可寻址。
    rewrite_map: dict[str, str] = {}
    # 纯原局关系也要**先**编号：它们最终写在 facts['natal_relations'] 里，
    # 但阻断条件在本函数内就要生成 ref/addressable，晚一步就全成了 false。
    natal_only = [
        fact for fact in all_facts
        if all(_LAYER_OF.get(p) == LAYER_NATAL for p in fact["participants"])
    ]
    natal_only.sort(key=lambda item: item["evidence_id"])
    for position, fact in enumerate(natal_only):
        rewrite_map[fact["evidence_id"]] = f"/natal_relations/{position}"

    for fact in all_facts:
        participants = fact["participants"]
        if all(_LAYER_OF.get(p) == LAYER_NATAL for p in participants):
            # 纯原局关系不进每月 relations（12 份重复太贵），
            # 但仍要可寻址：单独收进 _NATAL_RELATION_SINK，由调用方汇总成
            # 一次性块并登记进 evidence_index。
            sink = _NATAL_RELATION_SINK.get()
            if sink is not None:
                sink.append(dict(fact))
            continue

        kind = fact["kind"]
        channel = "stem" if kind.startswith("stem") else "branch"
        # 三合/三会里同一个支可能出现于多个柱位（如年柱与大运同为申），
        # participants 会比唯一支值多。所以逐柱给出 binding，保证「柱位→层→取值」一一对应；
        # 组合本身所需的唯一支值另放 required_values，不与 participants 强绑长度。
        bindings = [
            {
                "participant": name,
                "layer": _LAYER_OF.get(name, "unknown"),
                "channel": channel,
                "value": (pillars.get(name) or {}).get(channel),
            }
            for name in participants
        ]
        original_id = fact["evidence_id"]
        monthly_id = f"monthly.months[{zero_based}].relation{suffix}.{kind}.{'.'.join(participants)}"
        rewrite_map[original_id] = monthly_id
        item: dict[str, Any] = {
            "evidence_id": monthly_id,
            "original_evidence_id": original_id,
            "kind": kind,
            "participants": participants,
            "layers": [binding["layer"] for binding in bindings],
            "bindings": bindings,
            "required_values": fact["values"],
        }
        # hidden_stem_pairs 必须透传：否则 månedlich 暗合只剩"有暗合"三个字，
        # 消费者无法核对甲己/丙辛/戊癸这些藏干来源
        for key in ("result_element", "subtype", "hidden_stem_pairs", "group_element", "note"):
            if key in fact:
                item[key] = fact[key]
        facts.append(item)

    # 第二遍：给组合类事实补上成立结构、支持条件与阻断条件。
    # 阻断只看**同一通道**的冲突：天干合只被天干冲阻断，
    # 地支组合只被地支冲/害/破/刑阻断。跨通道互不影响。
    stem_conflicts = frozenset({"stem-clash"})
    branch_conflicts = frozenset({"branch-six-clash", "branch-harm", "branch-break", "branch-punishment"})

    for item in facts:
        if item["kind"] not in _COMBINE_KINDS:
            continue
        # 阻断条件照常算（对新关系也有意义），但**成化审查**只对上游审过的四类回填。
        attach_transformation = item["kind"] in _TRANSFORMATION_AUDITED_KINDS
        # 三朋是三柱天干同字，属天干通道：只能被天干冲阻断。
        # 落进地支分支的话，「子午冲」这种不相关的地支冲突会误伤三朋。
        stem_kinds = frozenset({"stem-combine", "stem-three-combine"})
        blockers_kinds = stem_conflicts if item["kind"] in stem_kinds else branch_conflicts
        involved = set(item["participants"])
        blockers = [
            conflict
            for conflict in conflicts_all
            if conflict["kind"] in blockers_kinds and involved & set(conflict["participants"])
        ]
        # 阻断证据自带完整数据，不再引用包外 ID：纯原局冲突本身不会作为月度关系输出，
        # 若只写它的原始 evidence_id，包内无从解析。
        blocking_conditions = [
            {
                "kind": conflict["kind"],
                "participants": conflict["participants"],
                "layers": [_LAYER_OF.get(name, "unknown") for name in conflict["participants"]],
                "values": conflict["values"],
                "ref": rewrite_map.get(conflict["evidence_id"]),
                "addressable": conflict["evidence_id"] in rewrite_map,
            }
            for conflict in blockers
        ]
        # 用原始 ID 查上游审计结果，月度 ID 只是输出用的重写名
        review = (annotated.get(item["original_evidence_id"]) or {}).get("transformation_review") or {}
        # 本层的冲突集合比上游更宽（冲/害/破/刑），所以状态必须以本层阻断结果为准重算，
        # 不能一边写着 blocked 的条件、一边给 supported 的状态。
        status = review.get("status", "pending-candidate")
        if blocking_conditions:
            status = "blocked-candidate"
        elif status == "blocked-candidate":
            status = "pending-candidate"
        if not attach_transformation:
            # 这些是新增关系：上游没有对应成化审查，就不回填，
            # 免得消费者把"没审过"当成"审过但条件不足"。
            continue
        item["transformation"] = {
            "profile": review.get("profile", "combination-condition-audit-v1"),
            "status": status,
            "target_element": review.get("target_element", item.get("result_element")),
            "season_support": review.get("season_support", False),
            "visible_support_count": review.get("visible_support_count", 0),
            "hidden_support_count": review.get("hidden_support_count", 0),
            "required_structure": "组合所需干支在参与柱中齐备",
            "supporting_conditions": review.get("supporting_conditions", ["组合结构完整"]),
            "blocking_conditions": blocking_conditions,
            "structure_intact": not blockers,
            "note": "复用上游成化条件审计（月令/透干/藏支）；即使条件较齐也不改写原局五行。",
        }

    return facts


def attach_relations(
    facts: dict[str, Any],
    calculation: dict[str, Any],
    normalized_input: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """给 ``build_monthly_facts`` 的结果补上四层关系审计（就地修改并返回）。"""
    if facts.get("status") != "ok":
        return facts

    pillars = calculation.get("pillars") or {}
    natal = {name: pillars[name] for name in ("year", "month", "day", "hour") if pillars.get(name)}
    # 成化审计要读 pillars["month"]["branch"]（月令），缺月柱时直接调用会 KeyError。
    # 这类"资料缺失"必须走降级状态，而不是让整包构建抛异常。
    if not natal or not pillars.get("month"):
        facts["relation_audit"] = {
            "status": "unavailable",
            "reason": "缺少原局四柱" if not natal else "缺少月柱，无法判定月令",
        }
        # 仍然要建 evidence_index：月份与半年汇总都带 evidence_id，
        # 提前返回会让这些引用全部落空（悬空证据）。
        index: dict[str, str] = {}
        for month in facts.get("months") or []:
            pointer = month.get("json_pointer") or f"/months/{month['index'] - 1}"
            month.setdefault("json_pointer", pointer)
            evidence_id = month.get("evidence_id")
            if evidence_id:
                index[evidence_id] = pointer
        facts["evidence_index"] = index
        return facts
    # 四柱不全（例如时辰未知就没有时柱）时仍然可以审计——只是**不能声称原局层完整**。
    # 逐月 relation_scope 会带上 natal_complete=false 与原因，年度状态也不会是 ok。
    missing_pillars = [name for name in ("year", "month", "day", "hour") if not pillars.get(name)]
    natal_complete = not missing_pillars

    natal_sink: list[dict[str, Any]] = []
    token = _NATAL_RELATION_SINK.set(natal_sink)
    boundaries = _dayun_boundaries(calculation, normalized_input)
    # 出生时刻精度：只有精确到分钟时，换运点落在月内才能确定落在哪一侧
    start = ((calculation or {}).get("luck_cycles") or {}).get("start") or {}
    # start 可能是脏数据（字符串、列表…）：后面要 .get("precision")，先夹成 dict，
    # 否则一个 "unknown" 字符串就能让整包构建抛 AttributeError。
    if not isinstance(start, dict):
        start = {}
    # 起运精度决定换运点的可信程度：只有明确到「天」才敢当成精确时刻。
    # 写成 unknown / 缺失 / 任何没见过的值时，都必须走保守的 ±1 月容差——
    # 否则一个自称"未知精度"的起运数据会被当成能精确切月，凭空造出确定归属。
    qiyun_precision = str(start.get("precision") or "unknown")
    # 「精度到天」并不等于「时刻确定」：起运年龄只精确到天时，
    # 真实交运时刻在当天内的哪一刻是未知的，仍有 ±12 小时的不确定度。
    # 所以 days 也必须带半日容差，只有在容差带外才敢声称精确切点；
    # 否则换运点贴近月界时会把不确定归属当成确定事实。
    coarse_qiyun = qiyun_precision != "days"
    # 起运年龄只精确到天时，天内准确交运时刻未知 → ±12 小时不确定带。
    # plan-qiyun.json 裁定的产品口径：这是口径假设，不是 days 字段可证的数学结论。
    qiyun_day_tolerance = (
        timedelta(hours=12) if qiyun_precision == "days" else timedelta(0)
    )
    # 出生时刻精度同样决定换运点可信度：只到时辰时，我们用的是两小时区间的中点，
    # 真实时刻可能在中点前后各 1 小时。把这个不确定度显式带进拆分判定，
    # 否则会在换运点贴近月界时把它当成精确时刻，切出错误的月份归属。
    birth_tolerance = _birth_time_tolerance(normalized_input)
    # 不确定度的来源可能不止一个：出生时刻精度、起运精度到天。文案必须如实反映，
    # 否则会告诉消费者「提供分钟级出生就能确定」，而实际问题在起运精度上。
    _cause_parts: list[str] = []
    if birth_tolerance is not None and birth_tolerance > timedelta(0):
        _cause_parts.append("出生时刻精度不足")
    if qiyun_day_tolerance > timedelta(0):
        _cause_parts.append("起运年龄只精确到天（±12 小时）")
    tolerance_cause = "、".join(_cause_parts) or "输入精度不足"
    tolerance_suggestion = (
        "需要同时提高出生时刻精度与起运精度（到时辰/分钟），才能确定归属。"
        if len(_cause_parts) > 1
        else (
            "上游若能提供精确到分钟的出生时刻，即可确定归属。"
            if birth_tolerance is not None and birth_tolerance > timedelta(0)
            else "上游若能提供精确的起运时刻（而非只到天），即可确定归属。"
        )
    )
    # 未知（None）保持未知，不能被半日容差变成"有界"
    time_tolerance = (
        None if birth_tolerance is None else birth_tolerance + qiyun_day_tolerance
    )
    # 只知子时：早子/晚子相差约 23 小时，无法确定，需在输出里明说
    zishi_ambiguous = (
        ((normalized_input or {}).get("profile") or {}).get("time") or {}
    ).get("precision") == _PRECISION_BRANCH and (
        ((normalized_input or {}).get("profile") or {}).get("time") or {}
    ).get("branch") == "子"
    # 起运年龄本身也是从出生时刻到节气的距离算的（三日折一年），
    # 所以任何出生时刻的不确定度都会等比例放大成换运点漂移：
    # 只知时辰 ±1h → 多约 5 天；只知子时 ±12h → 多约 61 天。
    # 不叠加这一层，就会把「实际可能跨运」的月份当成单一大运。
    # 出生时刻**本身**的误差：不含起运精度带来的半日不确定带。
    # 起运精度的影响只体现在总容差里，不能算进「出生时间误差」这一项。
    birth_tolerance_raw = birth_tolerance
    if time_tolerance is not None:
        # 换运点容差 = 出生时刻的 ±误差 + 起运年龄被带动的漂移。
        # 漂移要按「真实出生时刻与上游起运基准的最大差」算，不能用 ± 误差顶替：
        # 子时的基准是 00:00 而真实可能是 23:30，差 23.5 小时 ≈ 119 天。
        gap = _upstream_qiyun_gap(normalized_input) or timedelta(0)
        time_tolerance = time_tolerance + _qiyun_sensitivity(gap)

    # 最狠的一种情形：出生窗口**跨过了一个节**。那样上游用来算起运的「最近那个节」
    # 会整体切换，起运年龄可能差出整整一运（约十年）—— 不是放大容差能兜住的，
    # 只能整体判为不确定。
    straddled = None
    birth_moment = _birth_datetime(normalized_input)
    if birth_moment is not None and time_tolerance is not None:
        straddled = _jie_straddling_birth(birth_moment, birth_tolerance_raw or timedelta(0))

    # 年中定位也要吃同一份不确定度：如果换运点落在 7-01 附近的容差带里，
    # 年中那一刻究竟属旧运还是新运是说不清的，不能给出一个"确定"的干支。
    mid_moment = datetime(int(facts["target_year"]), 7, 1, 12, 0, tzinfo=engine.BJ)
    mid_window = (BOUNDARY_TOLERANCE if coarse_qiyun else timedelta(0)) + (time_tolerance or timedelta(0))
    mid_uncertain = [
        boundary for boundary in boundaries
        if abs(boundary - mid_moment) <= mid_window
    ] if mid_window > timedelta(0) else []
    if straddled is not None:
        # 跨节时连"哪一年起运"都说不准，年中的确定干支自然也不能给
        dayun_overview = {
            "status": "indeterminate",
            "reason": "出生时刻窗口跨过节气，起运所用的节气会切换，年中大运无法确定",
            "straddled_jie": straddled.isoformat(),
            "boundaries": [],
            "at": mid_moment.isoformat(),
            "time_precision": qiyun_precision,
        }
    elif mid_uncertain:
        dayun_overview = {
            "status": "indeterminate",
            "reason": "年中附近有换运点，受起运/出生时刻精度限制无法确定归属",
            "boundaries": [value.isoformat() for value in mid_uncertain],
            "at": mid_moment.isoformat(),
            "time_precision": qiyun_precision,
        }
    else:
        dayun_overview = resolve_dayun(calculation, normalized_input, facts["target_year"])
    facts["layers"] = {"luck": dayun_overview}
    annual_pillar = _transit_pillar(facts["annual"]["gan"], facts["annual"]["zhi"])
    used: list[str] = []
    crossed: list[int] = []

    for position, month in enumerate(facts["months"], start=1):
        start_at = _parse_instant(month.get("start"))
        end_at = _parse_instant(month.get("end"))
        moment = _month_midpoint(month) or start_at

        # 换运点落在本月区间内时，整月不能绑定单一大运——前后分属不同运。
        # 恰好等于月初的换运点不算跨界：半开区间内整月已属新运。
        dayun = resolve_dayun_at(calculation, normalized_input, moment)

        # 出生时刻的不确定度要把「估算点在月外但真实点可能落在月内」也算进来：
        # 只检查已落在月内的换运点，会漏掉贴在任何一侧月界上的那种。
        birth_tol = time_tolerance or timedelta(0)
        relation = _classify_boundaries(start_at, end_at, boundaries, time_tolerance)
        split = list(relation["split"])
        edge_ambiguous = list(relation["ambiguous"])

        # 出生窗口跨节：起运基准整体切换，任何大运归属都不能声称确定
        if straddled is not None:
            month["luck"] = {
                "status": "indeterminate",
                "reason": "出生时刻窗口跨过节气，起运所用的节气会切换，本月大运归属无法确定",
                "straddled_jie": straddled.isoformat(),
                "boundaries": [],
                "time_precision": qiyun_precision,
                "tolerance_seconds": int((time_tolerance or timedelta(0)).total_seconds()),
            }
            combined_wo_luck = dict(natal)
            combined_wo_luck["liunian"] = annual_pillar
            combined_wo_luck["liuyue"] = _transit_pillar(month["gan"], month["zhi"])
            month["relations"] = _relation_facts(month["index"], combined_wo_luck)
            month["relation_count"], month["confirmed_count"], month["candidate_count"] = _count_relations(month["relations"])
            month["relation_scope"] = {
                "computed_layers": [LAYER_NATAL, LAYER_ANNUAL, LAYER_MONTHLY],
                "omitted_layers": [LAYER_LUCK],
                "reason": "出生时刻窗口跨过节气，大运层整体不可信；"
                          "原局年柱/月柱也可能因跨节而不同",
                "boundaries": [],
                "segments": 0,
                "natal_complete": natal_complete,
                # 跨节时连原局都可能变，不能让人以为 natal 是板上钉钉
                "natal_uncertain": True,
            }
            crossed.append(month["index"])
            continue

        # 精度未知：连「差多少」都不知道，任何大运归属都不能声称
        if relation["kind"] == "unknown":
            month["luck"] = {
                "status": "indeterminate",
                "reason": "出生时刻精度未知，无法判断换运点落在本月的哪一侧",
                "boundaries": [],
                "time_precision": qiyun_precision,
            }
            combined_wo_luck = dict(natal)
            combined_wo_luck["liunian"] = annual_pillar
            combined_wo_luck["liuyue"] = _transit_pillar(month["gan"], month["zhi"])
            month["relations"] = _relation_facts(month["index"], combined_wo_luck)
            month["relation_count"], month["confirmed_count"], month["candidate_count"] = _count_relations(month["relations"])
            month["relation_scope"] = {
                "computed_layers": [LAYER_NATAL, LAYER_ANNUAL, LAYER_MONTHLY],
                "omitted_layers": [LAYER_LUCK],
                "reason": "出生时刻精度未知，大运层无法归属到本月",
                "boundaries": [],
                "segments": 0,
                "suggestion": "上游若给出 time.precision（minute/branch），即可确定归属。",
            }
            crossed.append(month["index"])
            continue

        # 起运精度只到「月」（bazi.py 的 start.precision="months"），
        # 所以换运时刻本身有约 ±1 个月的不确定度。
        # 只要换运点可能落在本月内或紧邻本月，就无法确定本月归属，
        # 一律标 indeterminate 并把大运层排除在本月关系之外——
        # 不按一个可能有 ±1 月误差的时刻去硬拆月。
        uncertain = []
        if coarse_qiyun:
            # 起运只到月：换运点在 ±1 个月内都可能，无法确定归属。
            # 出生时刻的不确定度要叠加进来，否则「估算点在月初前 31 天 30 分钟」
            # 这种刚好被挤出去的情况会被漏掉，最终给整月绑死一个错误的大运。
            window = BOUNDARY_TOLERANCE + birth_tol
            uncertain = [
                boundary for boundary in boundaries
                if start_at is not None and end_at is not None
                and start_at - window <= boundary <= end_at + window
            ]
        if uncertain:
            month["luck"] = {
                "status": "indeterminate",
                "reason": "起运精度仅到月，换运点可能落在本月附近（±1 个月），无法确定归属",
                "boundaries": [value.isoformat() for value in uncertain],
                "time_precision": qiyun_precision,
            }
            combined_wo_luck = dict(natal)
            combined_wo_luck["liunian"] = annual_pillar
            combined_wo_luck["liuyue"] = _transit_pillar(month["gan"], month["zhi"])
            month["relations"] = _relation_facts(month["index"], combined_wo_luck)
            month["relation_count"], month["confirmed_count"], month["candidate_count"] = _count_relations(month["relations"])
            month["relation_scope"] = {
                "computed_layers": [LAYER_NATAL, LAYER_ANNUAL, LAYER_MONTHLY],
                "omitted_layers": [LAYER_LUCK],
                "reason": "换运点在 ±1 个月不确定区间内，大运层无法确定归属",
                "boundaries": [value.isoformat() for value in uncertain],
                "segments": 0,
                "suggestion": "若上游能提供起运天数，可据此收窄不确定区间。",
            }
            crossed.append(month["index"])
            continue

        if edge_ambiguous:
            # 估算换运点贴着月界：真实换运点可能落在另一侧，整月归属都不确定
            month["luck"] = {
                "status": "indeterminate",
                "reason": f"{tolerance_cause}，换运点贴着月界，无法确定本月归属",
                "boundaries": [value.isoformat() for value in edge_ambiguous],
                "time_precision": qiyun_precision,
                # 三个数分开写清楚：出生时刻本身的误差、它带动的起运漂移、以及实际用的总容差
                "birth_time_tolerance_seconds": int(
                    (birth_tolerance_raw or timedelta(0)).total_seconds()
                ),
                "qiyun_sensitivity_seconds": int(
                    _qiyun_sensitivity(_upstream_qiyun_gap(normalized_input) or timedelta(0)).total_seconds()
                ),
                "tolerance_seconds": int((time_tolerance or timedelta(0)).total_seconds()),
            }
            combined_wo_luck = dict(natal)
            combined_wo_luck["liunian"] = annual_pillar
            combined_wo_luck["liuyue"] = _transit_pillar(month["gan"], month["zhi"])
            month["relations"] = _relation_facts(month["index"], combined_wo_luck)
            month["relation_count"], month["confirmed_count"], month["candidate_count"] = _count_relations(month["relations"])
            month["relation_scope"] = {
                "computed_layers": [LAYER_NATAL, LAYER_ANNUAL, LAYER_MONTHLY],
                "omitted_layers": [LAYER_LUCK],
                "reason": f"换运点贴着月界，受{tolerance_cause}限制无法确定归属",
                "boundaries": [value.isoformat() for value in edge_ambiguous],
                "segments": 0,
                "suggestion": tolerance_suggestion,
            }
            crossed.append(month["index"])
            continue

        if split:
            # 切点本身有 ±tol 的抖动，所以不能只在估算点处一刀切开：
            # 把每个切点展开成 [cut-tol, cut+tol] 的不确定带，
            # 带外的区间按各自大运计算关系，带内区间单独标 indeterminate 且不绑大运。
            # 只在估算点切一刀的话，切点附近那一小段会被当成"确定的另一运"，
            # 而真实换运点可能根本还没到。
            edges = [start_at]
            bands: list[tuple[datetime, datetime]] = []
            for cut in split:
                if birth_tol > timedelta(0):
                    lo = max(start_at, cut - birth_tol)
                    hi = min(end_at, cut + birth_tol)
                    bands.append((lo, hi))
                    edges.extend([lo, hi])
                else:
                    edges.append(cut)
            edges.append(end_at)
            edges = sorted(set(edges))

            segments: list[dict[str, Any]] = []
            merged: list[dict[str, Any]] = []

            for order, (seg_start, seg_end) in enumerate(
                zip(edges, edges[1:]), start=1
            ):
                in_band = any(lo <= seg_start and seg_end <= hi for lo, hi in bands)
                if in_band:
                    # 落在不确定带里：这段属于哪个大运说不了，只能不给大运层
                    seg_luck = {
                        "status": "indeterminate",
                        "reason": f"该段落在换运点的不确定区间内（{tolerance_cause}）",
                        "at": (seg_start + (seg_end - seg_start) / 2).isoformat(),
                    }
                else:
                    seg_moment = seg_start + (seg_end - seg_start) / 2
                    seg_luck = resolve_dayun_at(calculation, normalized_input, seg_moment)
                segment = {
                    "segment": order,
                    "start": seg_start.isoformat(),
                    "end": seg_end.isoformat(),
                    "uncertain_band": in_band,
                    "luck": seg_luck,
                    "relations": [],
                }
                # 段内大运不可用（如起运前 before_start）时仍然要算原局/流年/流月关系，
                # 只是不含大运层。整段跳过关系会让这一段的合冲刑害凭空消失，
                # 而月级 relation_scope 又会声称四层都算过。
                luck_ok = seg_luck.get("status") == "ok"
                combined_seg = dict(natal)
                combined_seg["liunian"] = annual_pillar
                combined_seg["liuyue"] = _transit_pillar(month["gan"], month["zhi"])
                if luck_ok:
                    combined_seg["dayun"] = _transit_pillar(seg_luck["gan"], seg_luck["zhi"])
                    if seg_luck["ganzhi"] not in used:
                        used.append(seg_luck["ganzhi"])
                relations = _relation_facts(
                    month["index"], combined_seg, suffix=f".seg{order}"
                )
                for relation in relations:
                    relation["segment"] = order
                segment["relations"] = relations
                segment["relation_scope"] = {
                    "computed_layers": (
                        [LAYER_NATAL, LAYER_ANNUAL, LAYER_MONTHLY]
                        + ([LAYER_LUCK] if luck_ok else [])
                    ),
                    "omitted_layers": [] if luck_ok else [LAYER_LUCK],
                    "reason": None if luck_ok else seg_luck.get("reason"),
                }
                # 合并数组里放**浅拷贝**：否则分段与合并指向同一批 dict，
                # setdefault 只会写一次，分段关系就会拿到合并数组的指针。
                merged.extend(dict(relation) for relation in relations)
                segments.append(segment)

            month["relation_segments"] = segments
            month["relations"] = merged
            month["relation_count"], month["confirmed_count"], month["candidate_count"] = _count_relations(merged)
            month["luck"] = {
                "status": "split",
                "reason": (
                    "本月区间内含换运点，已按换运时刻拆分为子区间分别审计"
                    if not bands
                    else f"本月区间内含换运点；切点受{tolerance_cause}限制，"
                         "切点两侧各留出不确定带，带内不绑定大运"
                ),
                "boundaries": [value.isoformat() for value in split],
                # 切点本身受出生时刻精度限制，有 ±tol 的抖动；下游要据此判断可信度
                "boundary_uncertainty_seconds": int(birth_tol.total_seconds()),
                "boundary_precision": (
                    "exact" if birth_tol == timedelta(0) else "birth-time-approximate"
                ),
                "ambiguous_windows": [
                    [lo.isoformat(), hi.isoformat()] for lo, hi in bands
                ],
                "segments": [
                    {
                        "segment": seg["segment"],
                        "start": seg["start"],
                        "end": seg["end"],
                        "uncertain_band": seg["uncertain_band"],
                        "ganzhi": seg["luck"].get("ganzhi"),
                        "gan": seg["luck"].get("gan"),
                        "zhi": seg["luck"].get("zhi"),
                    }
                    for seg in segments
                ],
            }
            crossed.append(month["index"])
            # 月级 scope 只声明「每一段都算过」的层；有一段缺大运时不能声称四层齐全。
            base_layers = [LAYER_NATAL, LAYER_ANNUAL, LAYER_MONTHLY]
            computed_everywhere = [
                layer for layer in (base_layers + [LAYER_LUCK])
                if all(layer in seg["relation_scope"]["computed_layers"] for seg in segments)
            ]
            omitted_anywhere = [
                layer for layer in (base_layers + [LAYER_LUCK])
                if any(layer in seg["relation_scope"]["omitted_layers"] for seg in segments)
            ]
            month["relation_scope"] = {
                "computed_layers": computed_everywhere,
                "omitted_layers": omitted_anywhere,
                "reason": (
                    None if not omitted_anywhere
                    else "本月被换运点切开，部分子区间缺少大运层（见各段 relation_scope）"
                ),
                "boundaries": [value.isoformat() for value in split],
                "segments": len(segments),
                "suggestion": (
                    None if not omitted_anywhere
                    else _omit_luck_suggestion(segments, tolerance_cause)
                ),
                "boundary_precision": (
                    "exact" if birth_tol == timedelta(0) else "birth-time-approximate"
                ),
            }
            continue

        month["luck"] = dayun
        combined = dict(natal)
        combined["liunian"] = annual_pillar
        combined["liuyue"] = _transit_pillar(month["gan"], month["zhi"])
        if dayun.get("status") == "ok":
            combined["dayun"] = _transit_pillar(dayun["gan"], dayun["zhi"])
            if dayun["ganzhi"] not in used:
                used.append(dayun["ganzhi"])
        month["relations"] = _relation_facts(month["index"], combined)
        month["relation_count"], month["confirmed_count"], month["candidate_count"] = _count_relations(month["relations"])
        month["relation_scope"] = {
            "computed_layers": [LAYER_NATAL, LAYER_ANNUAL, LAYER_MONTHLY] + (
                [LAYER_LUCK] if dayun.get("status") == "ok" else []
            ),
            "omitted_layers": [] if dayun.get("status") == "ok" else [LAYER_LUCK],
            "reason": None if dayun.get("status") == "ok" else dayun.get("reason"),
            "boundaries": [],
            "segments": 1,
            "suggestion": None,
        }

    # 每条证据都要有可解析路径：除了月级指针，关系与分段关系也各给一个。
    # 只给月级指针的话，"每个证据都能解到"这句话对关系并不成立。
    # 同时建 evidence_index：消费者拿到 evidence_id 要能直接找到规范位置，
    # 并且真实重复的 ID 必须在构建期就报错，而不是留给下游猜。
    index: dict[str, str] = {}
    for month in facts["months"]:
        base = month.get("json_pointer") or f"/months/{month['index'] - 1}"
        month.setdefault("json_pointer", base)
        # 月份自己也有 evidence_id，半年汇总会引用它们；
        # 不登记的话 monthly.months[0] 之类的引用在索引里查不到。
        month_evidence_id = month.get("evidence_id")
        if month_evidence_id:
            previous = index.get(month_evidence_id)
            if previous is not None and previous != base:
                raise ValueError(
                    f"evidence_id 冲突：{month_evidence_id} 同时出现在 {previous} 与 {base}"
                )
            index[month_evidence_id] = base
        for index_pos, relation in enumerate(month.get("relations") or []):
            pointer = f"{base}/relations/{index_pos}"
            relation.setdefault("json_pointer", pointer)
            evidence_id = relation.get("evidence_id")
            if not evidence_id:
                continue
            previous = index.get(evidence_id)
            if previous is not None and previous != pointer:
                raise ValueError(
                    f"evidence_id 冲突：{evidence_id} 同时出现在 {previous} 与 {pointer}"
                )
            index[evidence_id] = pointer
        # 分段副本与合并数组共享同一 evidence_id 是设计内的（合并数组是规范位置），
        # 但分段内部的**真实**重复必须报错。
        for segment_index, segment in enumerate(month.get("relation_segments") or []):
            seen_in_segment: dict[str, str] = {}
            for index_pos, relation in enumerate(segment.get("relations") or []):
                pointer = f"{base}/relation_segments/{segment_index}/relations/{index_pos}"
                relation.setdefault("json_pointer", pointer)
                evidence_id = relation.get("evidence_id")
                if not evidence_id:
                    continue
                if evidence_id in seen_in_segment:
                    raise ValueError(
                        f"同一分段内 evidence_id 重复：{evidence_id} "
                        f"（{seen_in_segment[evidence_id]} 与 {pointer}）"
                    )
                seen_in_segment[evidence_id] = pointer
                index.setdefault(evidence_id, pointer)
    facts["evidence_index"] = index

    luck_available = bool(used)
    # 原局四柱不全时，逐月 scope 要如实标注，年度状态也不能是 ok
    if not natal_complete:
        for month in facts["months"]:
            scope = month.get("relation_scope")
            if not isinstance(scope, dict):
                continue
            scope["natal_complete"] = False
            if not scope.get("reason"):
                scope["reason"] = (
                    f"原局四柱不全（缺少 {'、'.join(missing_pillars)}），"
                    "本层只基于已有柱审计"
                )
    else:
        for month in facts["months"]:
            scope = month.get("relation_scope")
            if isinstance(scope, dict):
                scope["natal_complete"] = True

    # 大运覆盖不是「有就 ok」：有的月份被换运不确定排除掉了，
    # 汇总就必须标 partial，否则读的人会以为全年十二个月都算上了大运层。
    months_with_luck = [
        month["index"] for month in facts["months"]
        if LAYER_LUCK in ((month.get("relation_scope") or {}).get("computed_layers") or [])
    ]
    months_without_luck = [
        month["index"] for month in facts["months"]
        if month["index"] not in months_with_luck
    ]
    full_coverage = luck_available and not months_without_luck

    facts["layers"]["luck"] = {
        # 年中定位只代表 7 月 1 日那一刻：干支、区间、序号都不属于全年，
        # 全部收进 mid_year，顶层只留年度汇总，避免「status=unavailable 却带着一个具体干支」。
        "status": "ok" if luck_available else "unavailable",
        "mid_year": {
            "scope": "mid-year",
            "status": dayun_overview.get("status"),
            "reason": dayun_overview.get("reason"),
            "sequence": dayun_overview.get("sequence"),
            "ganzhi": dayun_overview.get("ganzhi"),
            "from": dayun_overview.get("from"),
            "to": dayun_overview.get("to"),
            "at": dayun_overview.get("at"),
            # 判定为不确定时，把判定依据一并带出来，免得消费方只看到一个 status
            **(
                {
                    "boundaries": dayun_overview.get("boundaries") or [],
                    "time_precision": dayun_overview.get("time_precision"),
                    **(
                        {"straddled_jie": dayun_overview["straddled_jie"]}
                        if dayun_overview.get("straddled_jie")
                        else {}
                    ),
                }
                if dayun_overview.get("status") == "indeterminate"
                else {}
            ),
        },
        "resolved_per_month": True,
        "cycles_used": used,
        "crossed_months": crossed,
        "months_with_luck": months_with_luck,
        "months_without_luck": months_without_luck,
        "note": "大运按每月中点分别定位；跨运年的月份可能分属不同大运，"
                "若换运点落在某月区间内，该月标 crosses_boundary 且不绑定单一大运。",
        **(
            {
                "birth_time_ambiguity": {
                    "reason": "只知子时，无法确定早子还是晚子；上游日柱亦按早子取得，"
                              "不能反过来作为证据。两种可能相差约 23 小时。",
                    "candidates": ["早子 D 00:30 附近", "晚子 D 23:30 附近"],
                    "delta_hours": 23.5,
                    "qiyun_sensitivity_days": round(
                        _qiyun_sensitivity(
                            _upstream_qiyun_gap(normalized_input) or timedelta(0)
                        ).total_seconds() / 86400,
                        1,
                    ),
                    # 生效的不确定度 = 出生时刻的 ±12 小时 + 起运年龄被带动的漂移
                    "tolerance_seconds": int((time_tolerance or timedelta(0)).total_seconds()),
                }
            }
            if zishi_ambiguous
            else {}
        ),
    }

    # 跨节时原局年柱/月柱可能不同，整体状态不能是 ok。
    # 子时同样算：早子与晚子的日柱差一天，时柱也会跟着变，原局不是板上钉钉。
    natal_uncertain = straddled is not None or zishi_ambiguous
    if straddled is not None:
        natal_uncertain_reason = f"出生窗口跨过 {straddled.isoformat()}，原局年柱/月柱可能不同"
    elif zishi_ambiguous:
        natal_uncertain_reason = "只知子时，早子与晚子的日柱差一天，时柱也随之不同"
    else:
        natal_uncertain_reason = None
    for month in facts["months"]:
        scope = month.get("relation_scope")
        if isinstance(scope, dict) and natal_uncertain:
            scope.setdefault("natal_uncertain", True)
            if scope.get("natal_complete") and not scope.get("reason"):
                scope["reason"] = natal_uncertain_reason

    facts["relation_audit"] = {
        "status": "ok" if (full_coverage and natal_complete and not natal_uncertain) else "partial",
        "natal": {
            "complete": natal_complete,
            "uncertain": natal_uncertain,
            "present": sorted(natal),
            "missing": missing_pillars,
            **(
                {"uncertain_reason": natal_uncertain_reason}
                if natal_uncertain and natal_uncertain_reason
                else {}
            ),
        },
        "layers": ([LAYER_NATAL, LAYER_ANNUAL, LAYER_MONTHLY] + [LAYER_LUCK])
        if luck_available
        else [LAYER_NATAL, LAYER_ANNUAL, LAYER_MONTHLY],
        "note": (
            None if (full_coverage and natal_complete)
            else "；".join(
                item for item in (
                    f"原局四柱不全，缺少 {'、'.join(missing_pillars)}" if not natal_complete else None,
                    "大运层不可用，本次只审计原局/流年/流月" if not luck_available else None,
                    f"部分月份未绑定大运层（第 {months_without_luck} 月），本次大运覆盖为部分覆盖"
                    if luck_available and months_without_luck else None,
                ) if item
            )
        ),
        "luck_coverage": {
            "coverage": "full" if full_coverage else "partial",
            "months_with_luck": months_with_luck,
            "months_without_luck": months_without_luck,
        },
        "supported": sorted(_COMBINE_KINDS | _CONFLICT_KINDS | _CANDIDATE_KINDS),
        "unsupported": list(UNSUPPORTED_RELATION_KINDS),
        # unsupported 为空时要说"已覆盖"，不能照搬"未实现这些类型"的说法
        "unsupported_note": (
            "上游关系表未实现这些类型，本层不做推断，也不假装已覆盖。"
            if UNSUPPORTED_RELATION_KINDS
            else "已覆盖全部已登记的关系类型，没有未实现项。"
        ),
    }
    # 纯原局关系一次性块：不重复进 12 个月，但必须可寻址。
    # 去重（同一个 evidence_id 可能因多个月份审计被收集多次）。
    seen: dict[str, dict[str, Any]] = {}
    for relation in natal_sink:
        evidence_id = relation.get("evidence_id")
        if evidence_id and evidence_id not in seen:
            seen[evidence_id] = relation
    natal_relations: list[dict[str, Any]] = []
    for position, relation in enumerate(sorted(seen.values(), key=lambda item: item["evidence_id"])):
        relation = dict(relation)
        relation["json_pointer"] = f"/natal_relations/{position}"
        natal_relations.append(relation)
        index = facts.setdefault("evidence_index", {})
        index[relation["evidence_id"]] = relation["json_pointer"]
    facts["natal_relations"] = natal_relations
    _NATAL_RELATION_SINK.reset(token)
    return facts
