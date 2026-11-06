"""规划验收标准（.pair/plan.json 的 7 条）的可执行映射。

每个用例名都带 ``acNN``，与 ``.pair/plan.json`` 里 ``acceptance_criteria`` 的序号一一对应，
这样「是否达到规划要求」不需要靠读代码判断，跑一遍就有结论。

配套：``tests/acceptance_frontend.test.cjs`` 覆盖页面侧的 8 条（ac08–ac15）。
"""

from __future__ import annotations

import copy
import re
import unittest
from datetime import datetime, timedelta
from typing import Any
from unittest import mock

from scripts import pai_pan as engine
from mingli_tool import bazi_months
from mingli_tool.bazi import calculate
from mingli_tool.bazi_months import (
    _birth_datetime,
    _birth_time_tolerance,
    _classify_boundaries,
    build_monthly_facts,
)

# 覆盖引擎定气范围的两端 + 几个常见年份
SUPPORTED_YEARS = (1900, 1950, 1984, 2024, 2026, 2099)

# 参与四层关系审计的柱位名，与 _LAYER_OF 的键一致
KNOWN_PARTICIPANTS = frozenset(
    {"year", "month", "day", "hour", "dayun", "liunian", "liuyue"}
)
# 全部合作类关系（含新增六种）
COMBINE_KINDS = frozenset({
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
    "branch-hidden-stem-combine-candidate",
})

# 上游 _annotate_transformation_reviews 只审这四类；其余关系没有成化审查，
# 因此**不该**带 transformation 字段（没审过不能装成"审过但条件不足"）。
TRANSFORMATION_AUDITED_KINDS = frozenset({
    "stem-combine",
    "branch-six-combine",
    "branch-three-harmony",
    "branch-three-meeting",
})


def request_payload(date: str = "1990-05-15", through: int = 2026) -> dict[str, Any]:
    return {
        "schema_version": "1.0",
        "profile": {
            "display_name": None,
            "calendar": "solar",
            "date": date,
            "is_leap_month": False,
            "time": {"precision": "minute", "value": "12:30"},
            "timezone": "Asia/Shanghai",
            "sex_for_calculation": "male",
            "birthplace": {"label": None, "longitude": None, "latitude": None},
        },
        "rules": {"profile_id": "engine-default-v1", "true_solar_time": False},
        "options": {"save_history": False, "annual_cycles_through": through},
    }


def resolve_pointer(document: Any, pointer: str) -> Any:
    """RFC 6901 JSON Pointer 解析。解不到就抛，绝不返回「看起来还行」的默认值。

    严格按规范：空串才是根指针；`"/"` 指向键名为空字符串的成员，
    不是根。数组下标必须是 `0` 或非零开头的十进制数，不接受 `-1`。
    """
    if pointer == "":
        return document
    if not pointer.startswith("/"):
        raise ValueError(f"{pointer!r} 不是合法 JSON Pointer")
    current = document
    for raw in pointer[1:].split("/"):
        # 转义只认 ~0 与 ~1；出现别的 ~x 就是非法指针
        if re.search(r"~(?![01])", raw) or raw.endswith("~"):
            raise ValueError(f"{pointer} 含非法转义 {raw!r}")
        token = raw.replace("~1", "/").replace("~0", "~")
        if isinstance(current, list):
            # 只认 ASCII 数字：str.isdigit() 会把 '١'（阿拉伯-印度数字）也算进来
            if not re.fullmatch(r"0|[1-9][0-9]*", token):
                raise KeyError(f"{pointer} 的数组下标 {token!r} 不合法")
            index = int(token)
            if index >= len(current):
                raise KeyError(f"{pointer} 下标 {index} 越界（长度 {len(current)}）")
            current = current[index]
        elif isinstance(current, dict):
            if token not in current:
                raise KeyError(f"{pointer} 指向不存在的键 {token!r}")
            current = current[token]
        else:
            raise KeyError(f"{pointer} 在 {type(current).__name__} 处断链")
    return current


PARTICIPANT_LAYER = {
    "year": "natal",
    "month": "natal",
    "day": "natal",
    "hour": "natal",
    "liunian": "annual",
    "liuyue": "monthly",
    "dayun": "luck",
}


def iter_evidence_objects(node: Any, path: str = "$"):
    """递归找出包里**所有**带 evidence_id 的对象。

    不写死"月 + 关系"：将来多一类证据，这里自动覆盖到，
    否则"每条证据都有可解析路径"的断言会悄悄失效。
    """
    if isinstance(node, dict):
        if "evidence_id" in node:
            yield node, path
        for key, value in node.items():
            yield from iter_evidence_objects(value, f"{path}.{key}")
    elif isinstance(node, list):
        for index, item in enumerate(node):
            yield from iter_evidence_objects(item, f"{path}[{index}]")


def iter_relations(month: dict):
    """月级关系 + 每个分段自己的关系。两处都要查，否则分段里的错配会漏掉。"""
    for relation in month.get("relations") or []:
        yield relation, None
    for segment in month.get("relation_segments") or []:
        for relation in segment.get("relations") or []:
            yield relation, segment


def collect_evidence_ids(node: Any, found: set[str] | None = None) -> set[str]:
    """递归收集包里所有 evidence_id 的值。"""
    found = set() if found is None else found
    if isinstance(node, dict):
        for key, value in node.items():
            if key == "evidence_id" and isinstance(value, str):
                found.add(value)
            collect_evidence_ids(value, found)
    elif isinstance(node, list):
        for item in node:
            collect_evidence_ids(item, found)
    return found


def iter_pointers(node: Any, path: str = ""):
    """递归找出包里所有 JSON Pointer 字段。

    ``json_pointer`` 出现但值不是字符串（null、缺省后被写成 None）时直接报错：
    静默跳过会让"每个证据都有可解析路径"这句话落空。
    """
    if isinstance(node, dict):
        for key, value in node.items():
            if key == "json_pointer":
                if not isinstance(value, str) or not value:
                    raise AssertionError(f"{path} 的 json_pointer 非法：{value!r}")
                yield value
            else:
                yield from iter_pointers(value, f"{path}.{key}")
    elif isinstance(node, list):
        for index, item in enumerate(node):
            yield from iter_pointers(item, f"{path}[{index}]")


def _effective_tolerance(birth_tolerance, gap=None):
    """出生时刻不确定度 → 实际用于换运判定的容差（含起运年龄被带动的漂移）。"""
    return birth_tolerance + bazi_months._qiyun_sensitivity(
        birth_tolerance if gap is None else gap
    )


def check_binding_values(facts: dict, pillars: dict) -> int:
    """校验每条关系绑定值确实等于该 participant 的真实干支。返回检查过的绑定数。

    抽成函数是为了能对**篡改过的包**再跑一遍，证明这个检查真的会失败。
    """
    annual = facts["annual"]

    def expected(month: dict, relation: dict, binding: dict, segment: dict | None = None) -> str | None:
        participant = binding["participant"]
        channel = binding["channel"]
        if participant in ("year", "month", "day", "hour"):
            pillar = pillars.get(participant) or {}
            return pillar.get("stem" if channel == "stem" else "branch")
        if participant == "liunian":
            return annual["gan"] if channel == "stem" else annual["zhi"]
        if participant == "liuyue":
            return month["gan"] if channel == "stem" else month["zhi"]
        if participant == "dayun":
            if segment is not None:
                # 分段关系用自己的那一段干支，不能拿整月的或别段的
                gan_zhi = (segment.get("luck") or {}).get("ganzhi")
            else:
                segment_index = relation.get("segment")
                if segment_index:
                    segments = month.get("relation_segments") or []
                    if not (1 <= segment_index <= len(segments)):
                        return None
                    gan_zhi = (segments[segment_index - 1].get("luck") or {}).get("ganzhi")
                else:
                    gan_zhi = month["luck"].get("ganzhi")
            if not (isinstance(gan_zhi, str) and len(gan_zhi) == 2):
                return None
            return gan_zhi[0] if channel == "stem" else gan_zhi[1]
        return None

    checked = 0
    for month in facts["months"]:
        for relation, segment in iter_relations(month):
            for binding in relation["bindings"]:
                want = expected(month, relation, binding, segment)
                if want is None:
                    raise AssertionError(
                        f"{relation['evidence_id']} 的 {binding['participant']} 无法解析到具体干支"
                    )
                if binding["value"] != want:
                    raise AssertionError(
                        f"{relation['evidence_id']} 的 {binding['participant']}"
                        f"（{binding['channel']}）绑定值 {binding['value']} != 应为 {want}"
                    )
                checked += 1
    return checked


class AcceptanceBackendTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.result = calculate(request_payload())
        cls.calculation = cls.result["calculation"]
        cls.normalized = cls.result["normalized_input"]

    # ---------------------------------------------------------------- ac1
    def test_ac01_twelve_months_cover_index_1_to_12_for_supported_years(self):
        """ac1：每个受支持年份都有 12 个月，且索引恰为 1..12 各一次。"""
        for year in SUPPORTED_YEARS:
            with self.subTest(year=year):
                facts = build_monthly_facts(None, year)
                self.assertEqual(facts["status"], "ok")
                months = facts["months"]
                self.assertEqual(len(months), 12)
                self.assertEqual([m["index"] for m in months], list(range(1, 13)))

    # ---------------------------------------------------------------- ac2
    def test_ac02_boundaries_are_contiguous_ordered_and_labelled(self):
        """ac2：相邻月首尾相接、每月 start < end、边界来源与时区齐全。"""
        for year in SUPPORTED_YEARS:
            with self.subTest(year=year):
                months = build_monthly_facts(None, year)["months"]
                for i in range(len(months) - 1):
                    self.assertEqual(
                        months[i]["end"], months[i + 1]["start"],
                        f"{year} 第 {i + 1} 与第 {i + 2} 月之间有缝或重叠",
                    )
                for month in months:
                    self.assertLess(month["start"], month["end"])
                    self.assertEqual(month["start_utc_offset"], "+08:00")
                    self.assertTrue(month["boundary_source"])
                    self.assertIn("T", month["start"])

    # ---------------------------------------------------------------- ac3
    def test_ac03_boundary_instants_fall_into_different_months(self):
        """ac3：任一节月边界两侧的瞬间分属不同流月干支柱。"""
        for year in (2023, 2024, 2026):
            with self.subTest(year=year):
                months = build_monthly_facts(None, year)["months"]
                annual_gan_index = engine.GAN.index(build_monthly_facts(None, year)["annual"]["gan"])
                for i in range(len(months) - 1):
                    boundary = datetime.fromisoformat(months[i]["end"])
                    before = boundary - timedelta(seconds=1)
                    after = boundary + timedelta(seconds=1)
                    g_before, z_before, *_ = engine.resolve_month_pillar(before, annual_gan_index)
                    g_after, z_after, *_ = engine.resolve_month_pillar(after, annual_gan_index)
                    self.assertNotEqual(
                        (g_before, z_before), (g_after, z_after),
                        f"{year} 边界 {months[i]['end']} 两侧干支相同，说明边界没落在换月点",
                    )
                    self.assertEqual(g_before + z_before, months[i]["ganzhi"])
                    self.assertEqual(g_after + z_after, months[i + 1]["ganzhi"])

    def test_ac03b_month_ganzhi_matches_engine_at_midpoint(self):
        """ac3（续）：整月干支与固定引擎在同一时刻的定月结果一致。"""
        for year in SUPPORTED_YEARS:
            with self.subTest(year=year):
                facts = build_monthly_facts(None, year)
                annual_gan_index = engine.GAN.index(facts["annual"]["gan"])
                for month in facts["months"]:
                    start = datetime.fromisoformat(month["start"])
                    end = datetime.fromisoformat(month["end"])
                    probe = start + (end - start) / 2
                    gan, zhi, jie_name, *_ = engine.resolve_month_pillar(probe, annual_gan_index)
                    self.assertEqual(gan + zhi, month["ganzhi"])
                    self.assertEqual(jie_name, month["jie"])

                    # 边界两侧必须换柱：全范围扫一遍，别只抽查两三年
                    if month["index"] == 12:
                        continue
                    before = end - timedelta(seconds=1)
                    after = end + timedelta(seconds=1)
                    gan_b, zhi_b, _, *_ = engine.resolve_month_pillar(before, annual_gan_index)
                    gan_a, zhi_a, _, *_ = engine.resolve_month_pillar(after, annual_gan_index)
                    self.assertNotEqual(
                        (gan_b + zhi_b), (gan_a + zhi_a),
                        f"{year} 第 {month['index']} 月边界两侧柱相同，边界位置可能不对",
                    )
                    self.assertEqual(gan_b + zhi_b, month["ganzhi"], f"{year} 边界前的柱不符")
                    self.assertEqual(
                        gan_a + zhi_a, facts["months"][month["index"]]["ganzhi"],
                        f"{year} 边界后的柱不符",
                    )

    def test_ac03c_lichun_switches_year_pillar(self):
        """ac3（续）：立春两侧的年柱不同，且落在不同流月。"""
        previous_facts = build_monthly_facts(None, 2023)
        following_facts = build_monthly_facts(None, 2024)
        previous = previous_facts["months"][-1]
        following = following_facts["months"][0]

        self.assertEqual(previous["end"], following["start"])
        self.assertEqual(following["jie"], "立春")
        self.assertEqual(
            following["start"],
            _fmt(engine.solar_term_beijing(2024, 315.0)),
        )
        # 年柱必须真的换：立春前属上一年，立春后属下一年
        self.assertEqual(previous_facts["annual"]["ganzhi"], engine.liunian_gz(2023))
        self.assertEqual(following_facts["annual"]["ganzhi"], engine.liunian_gz(2024))
        self.assertNotEqual(
            previous_facts["annual"]["ganzhi"], following_facts["annual"]["ganzhi"]
        )
        self.assertNotEqual(previous["ganzhi"], following["ganzhi"])
        # 立春前一刻仍在上一年份的包里，立春后一刻已在下一年份的包里
        boundary = datetime.fromisoformat(following["start"])
        self.assertLess(
            datetime.fromisoformat(previous["start"]), boundary - timedelta(days=1)
        )
        self.assertGreater(
            datetime.fromisoformat(following["end"]), boundary + timedelta(days=1)
        )

    # ---------------------------------------------------------------- ac4
    def test_ac04_relation_participants_and_transformation_fields(self):
        """ac4：每条关系参与者都能落到四层输入上，成化候选含状态/支持/阻断字段。"""
        facts = build_monthly_facts(self.calculation, 2026, self.normalized)
        seen_combine = 0
        for month in facts["months"]:
            # 月级关系与每个分段自己的关系都要查，否则分段里的参与者错配会漏掉
            for relation, _segment in iter_relations(month):
                self.assertTrue(
                    set(relation["participants"]) <= KNOWN_PARTICIPANTS,
                    relation["participants"],
                )
                # 参与者与绑定必须逐项对应：只比长度会放过「写着 year/month、
                # 实际绑的是 day/hour」这种张冠李戴。
                self.assertEqual(
                    [binding["participant"] for binding in relation["bindings"]],
                    list(relation["participants"]),
                    f"{relation['evidence_id']} 的参与者与绑定顺序/内容不一致",
                )
                self.assertEqual(len(relation["layers"]), len(relation["participants"]))
                for binding in relation["bindings"]:
                    self.assertIn(binding["layer"], {"natal", "luck", "annual", "monthly"})
                    # 通道只能是 stem / branch：写成别的值会让值校验变成"按地支比对"
                    self.assertIn(
                        binding["channel"], {"stem", "branch"},
                        f"{relation['evidence_id']} 的通道 {binding['channel']!r} 非法",
                    )
                    self.assertIsNotNone(binding["value"], relation["evidence_id"])
                # 层与参与者必须对得上：把 dayun 的层写成 natal 这种错配要被抓到
                for binding in relation["bindings"]:
                    self.assertEqual(
                        binding["layer"],
                        PARTICIPANT_LAYER[binding["participant"]],
                        f"{relation['evidence_id']} 的 {binding['participant']} 层标错了",
                    )
                self.assertEqual(
                    set(relation["layers"]),
                    {PARTICIPANT_LAYER[b["participant"]] for b in relation["bindings"]},
                    f"{relation['evidence_id']} 的 layers 与绑定层不一致",
                )
                if relation["kind"] not in TRANSFORMATION_AUDITED_KINDS:
                    self.assertNotIn(
                        "transformation", relation,
                        f"{relation['kind']} 上游没有成化审查，不该带 transformation",
                    )
                    continue
                seen_combine += 1
                transformation = relation["transformation"]
                for field in (
                    "status",
                    "supporting_conditions",
                    "blocking_conditions",
                    "structure_intact",
                ):
                    self.assertIn(field, transformation, relation["evidence_id"])
                self.assertIn(
                    transformation["status"],
                    {"supported-candidate", "pending-candidate", "blocked-candidate"},
                )
                self.assertIsInstance(transformation["supporting_conditions"], list)
                self.assertIsInstance(transformation["blocking_conditions"], list)
        self.assertGreater(seen_combine, 0, "2026 年应至少出现一条合会候选")

    def test_ac04b_split_segments_keep_relations_and_scope_is_honest(self):
        """ac4（续）：被换运点切开的月份，每一段都要有关系，且月级 scope 不许谎称四层齐全。"""
        # 用起运天数把换运点推进月内，制造 split
        calculation = copy.deepcopy(self.calculation)
        luck = calculation.setdefault("luck_cycles", {})
        start = dict(luck.get("start") or {})
        start["precision"] = "days"
        start["days"] = int(start.get("days") or 0) + 180
        luck["start"] = start

        found_split = False
        for year in (2026, 2027, 2028):
            facts = build_monthly_facts(calculation, year, self.normalized)
            for month in facts["months"]:
                if month["luck"]["status"] != "split":
                    continue
                found_split = True
                segments = month["relation_segments"]
                self.assertGreaterEqual(len(segments), 2, "split 月份至少要切成两段")
                for segment in segments:
                    self.assertIn("relation_scope", segment)
                    self.assertIsInstance(segment["relations"], list)
                    # 每段都要带完整作用域声明，不能留空让上层猜
                    self.assertIn("computed_layers", segment["relation_scope"])
                    self.assertIn("omitted_layers", segment["relation_scope"])

                computed = month["relation_scope"]["computed_layers"]
                omitted = month["relation_scope"]["omitted_layers"]
                # 只要有一段缺大运，月级就不能声称大运层已算
                seg_all_have_luck = all(
                    "luck" in seg["relation_scope"]["computed_layers"] for seg in segments
                )
                if seg_all_have_luck:
                    self.assertIn("luck", computed)
                    self.assertNotIn("luck", omitted)
                else:
                    self.assertNotIn("luck", computed, "有段缺大运时月级不许声称已算")
                    self.assertIn("luck", omitted)
                    self.assertTrue(month["relation_scope"]["reason"])
                # 原局/流年/流月三层与大运无关，任何情况下都不能从月级 scope 里消失
                for layer in ("natal", "annual", "monthly"):
                    self.assertIn(layer, computed)
        self.assertTrue(found_split, "夹具没能造出被换运点切开的月份，这条断言没有区分力")

    def test_ac04c_missing_qiyun_is_unavailable_not_zero(self):
        """ac4（续）：有周期但缺起运数据时，不能默认「出生即起运」。"""
        calculation = copy.deepcopy(self.calculation)
        luck = calculation.setdefault("luck_cycles", {})
        luck.pop("start", None)

        facts = build_monthly_facts(calculation, 2026, self.normalized)
        self.assertEqual(facts["relation_audit"]["status"], "partial")
        self.assertEqual(facts["relation_audit"]["luck_coverage"]["coverage"], "partial")
        # 原因要真的说明「缺起运数据」，不能是一句空话（旧写法 `+ "luck"` 让它恒真）
        luck_layer = facts["layers"]["luck"]
        self.assertEqual(luck_layer["status"], "unavailable")
        self.assertIn("起运", luck_layer["mid_year"].get("reason") or "")
        for month in facts["months"]:
            self.assertNotIn("luck", month["relation_scope"]["computed_layers"])
            self.assertIn("luck", month["relation_scope"]["omitted_layers"])

        # 直接问单个时刻也必须给出「缺起运数据」，而不是假装能算
        resolved = bazi_months.resolve_dayun_at(
            calculation, self.normalized, datetime(2026, 7, 1, 12, 0, tzinfo=engine.BJ)
        )
        self.assertEqual(resolved["status"], "unavailable")
        self.assertIn("起运数据", resolved["reason"])

    def test_ac04d_partial_luck_coverage_is_reported(self):
        """ac4（续）：只有部分月份绑上大运时，relation_audit 必须标 partial 并列出缺哪几个月。"""
        coarse = copy.deepcopy(self.normalized)
        coarse["profile"]["time"] = {"precision": "branch", "branch": "午"}

        calculation = copy.deepcopy(self.calculation)
        luck = calculation.setdefault("luck_cycles", {})
        start = dict(luck.get("start") or {})
        start["precision"] = "days"
        luck["start"] = start

        # 把换运点压到年中，制造「上半年有运、下半年没运」的混合覆盖
        anchor = build_monthly_facts(calculation, 2026, coarse)["months"][6]
        edge = datetime.fromisoformat(anchor["start"]) - timedelta(minutes=30)
        with mock.patch.object(bazi_months, "_dayun_boundaries", return_value=[edge]):
            patched = bazi_months.build_monthly_facts(calculation, 2026, coarse)

        coverage = patched["relation_audit"]["luck_coverage"]
        self.assertEqual(patched["relation_audit"]["status"], "partial")
        self.assertEqual(coverage["coverage"], "partial")
        self.assertTrue(coverage["months_without_luck"], "应列出被排除大运的月份")
        self.assertTrue(coverage["months_with_luck"], "应列出成功绑定大运的月份")
        self.assertEqual(
            sorted(coverage["months_with_luck"] + coverage["months_without_luck"]),
            list(range(1, 13)),
        )
        self.assertIn("部分月份未绑定大运层", patched["relation_audit"]["note"])

    def test_ac03o_birth_window_straddling_a_jie_invalidates_luck(self):
        """ac3 的前置：出生窗口跨过节气时，起运所用的节会切换，整年大运都不可信。

        2024-03-05 巳时：窗口 [10:00, 12:00)，惊蛰约 10:15 —— 正好跨在里面。
        """
        normalized = copy.deepcopy(self.normalized)
        normalized["profile"]["solar_date"] = "2024-03-05"
        normalized["profile"]["time"] = {"precision": "branch", "branch": "巳"}

        calculation = copy.deepcopy(self.calculation)
        facts = bazi_months.build_monthly_facts(calculation, 2026, normalized)

        self.assertEqual(facts["layers"]["luck"]["status"], "unavailable")
        for month in facts["months"]:
            self.assertEqual(month["luck"]["status"], "indeterminate")
            self.assertIn("跨过节气", month["luck"]["reason"])
            self.assertIn("straddled_jie", month["luck"])
            self.assertIn("luck", month["relation_scope"]["omitted_layers"])
            self.assertNotIn("luck", month["relation_scope"]["computed_layers"])

        # 不跨节的日期不受影响
        normal = copy.deepcopy(self.normalized)
        normal["profile"]["solar_date"] = "1990-05-15"
        normal["profile"]["time"] = {"precision": "branch", "branch": "午"}
        ok_facts = bazi_months.build_monthly_facts(self.calculation, 2026, normal)
        self.assertEqual(ok_facts["layers"]["luck"]["status"], "ok")
        self.assertNotIn("straddled_jie", ok_facts["months"][0]["luck"])

    def test_ac03q_lichun_straddle_marks_natal_uncertain(self):
        """ac3 的前置：跨立春时年柱/月柱都可能不同，原局层也要标不确定。

        2024-02-04 申时：窗口 [16:00, 18:00)，立春约 16:27 —— 正好跨在里面。
        """
        normalized = copy.deepcopy(self.normalized)
        normalized["profile"]["solar_date"] = "2024-02-04"
        normalized["profile"]["time"] = {"precision": "branch", "branch": "申"}

        facts = bazi_months.build_monthly_facts(self.calculation, 2026, normalized)
        audit = facts["relation_audit"]

        self.assertEqual(audit["status"], "partial", "跨节时整体状态不能是 ok")
        self.assertTrue(audit["natal"]["uncertain"])
        self.assertIn("uncertain_reason", audit["natal"])
        self.assertTrue(facts["layers"]["luck"]["mid_year"].get("straddled_jie"))
        for month in facts["months"]:
            self.assertIs(month["relation_scope"].get("natal_uncertain"), True)

        # 不跨节时反过来必须是 False 且状态 ok
        normal = copy.deepcopy(self.normalized)
        normal["profile"]["solar_date"] = "1990-05-15"
        normal["profile"]["time"] = {"precision": "minute", "value": "12:30"}
        clean = bazi_months.build_monthly_facts(self.calculation, 2026, normal)
        self.assertFalse(clean["relation_audit"]["natal"]["uncertain"])
        self.assertEqual(clean["relation_audit"]["status"], "ok")

    # ---------------------------------------------------------------- ac6
    def test_ac04e_year_summary_does_not_inherit_mid_year_status(self):
        """ac4（续）：年度大运汇总不能把年中那一刻的 status/干支当成全年结论。"""
        # 起运推到 30 年后：7 月 1 日尚未起运，2026 年整年也都在起运前
        calculation = copy.deepcopy(self.calculation)
        luck = calculation.setdefault("luck_cycles", {})
        start = dict(luck.get("start") or {})
        start["precision"] = "days"
        start["days"] = 365 * 30
        luck["start"] = start

        facts = build_monthly_facts(calculation, 2026, self.normalized)
        summary = facts["layers"]["luck"]

        # 先证明夹具真的制造了「年中未起运」这个前提，否则后面全是空转
        self.assertEqual(summary["mid_year"]["scope"], "mid-year")
        self.assertEqual(summary["mid_year"]["status"], "before_start")
        self.assertIn("尚未起运", summary["mid_year"]["reason"] or "")

        # 年度汇总：整年都没绑上大运 → unavailable，且不能带任何年中干支
        self.assertEqual(summary["status"], "unavailable")
        self.assertEqual(summary["months_with_luck"], [])
        self.assertEqual(
            summary["months_without_luck"], list(range(1, 13))
        )
        for leaked in ("ganzhi", "gan", "zhi", "from", "to", "at", "sequence", "reason"):
            self.assertNotIn(leaked, summary, f"年度汇总不应泄漏年中字段 {leaked}")
        self.assertEqual(facts["relation_audit"]["status"], "partial")
        self.assertEqual(facts["relation_audit"]["luck_coverage"]["coverage"], "partial")

        # 再看一个「年中可定位、但年间跨运」的场景：顶层不能只报年中那一运
        crossing = copy.deepcopy(self.calculation)
        luck2 = crossing.setdefault("luck_cycles", {})
        start2 = dict(luck2.get("start") or {})
        start2["precision"] = "days"
        start2["days"] = 0
        luck2["start"] = start2
        facts2 = build_monthly_facts(crossing, 2050, self.normalized)   # 已进入第 3 运
        summary2 = facts2["layers"]["luck"]
        self.assertIn(summary2["mid_year"]["status"], {"ok", "before_start", "unavailable"})
        self.assertNotIn("ganzhi", summary2)
        self.assertEqual(
            sorted(summary2["months_with_luck"] + summary2["months_without_luck"]),
            list(range(1, 13)),
        )

    def test_ac04f_cycle_gap_does_not_shift_later_cycles(self):
        """ac4（续）：周期数组中间缺一条时，后面的运不能整体提前。

        定位必须用周期自己的 sequence，而不是「筛选后数组的下标」。
        """
        calculation = copy.deepcopy(self.calculation)
        cycles = calculation["luck_cycles"]["cycles"]
        kept = [c for c in cycles if str(c.get("sequence")) != "1"]
        self.assertLess(len(kept), len(cycles), "夹具里没有 sequence=1 的周期，无法验证")
        calculation["luck_cycles"]["cycles"] = kept

        boundaries = bazi_months._dayun_boundaries(calculation, self.normalized)
        self.assertTrue(boundaries, "缺一条周期后不该一个换运点都没有")

        # 第一段十年（原本属于 sequence=1）现在没有周期可用，必须明确说不可用
        base = boundaries[0]
        early = base + timedelta(days=30)
        resolved_early = bazi_months.resolve_dayun_at(calculation, self.normalized, early)
        self.assertEqual(
            resolved_early["status"], "unavailable",
            f"缺了 sequence=1 却仍绑上了某条运：{resolved_early}",
        )
        self.assertIn("超出", resolved_early["reason"])

        # 起运点之前则是「起运前」，与「缺周期」是两回事
        before = bazi_months.resolve_dayun_at(
            calculation, self.normalized, base - timedelta(days=30)
        )
        self.assertEqual(before["status"], "before_start")

        # 第二段十年应落在 sequence=2 上（而不是被提前成"第一运"）
        late = bazi_months._add_months(base, 120) + timedelta(days=30)
        resolved_late = bazi_months.resolve_dayun_at(calculation, self.normalized, late)
        self.assertEqual(resolved_late["status"], "ok")
        self.assertEqual(int(resolved_late["sequence"]), 2)

    def test_ac04g_qiyun_precision_must_be_backed_by_data(self):
        """ac4（续）：起运精度声称到天就必须给 days，缺了不能当 0。"""
        self.assertIsNone(bazi_months._qiyun_offset({"years": 7, "precision": "days"}))
        # 键存在但值为 null，同样等于没给
        self.assertIsNone(
            bazi_months._qiyun_offset({"years": 7, "months": 3, "days": None, "precision": "days"})
        )
        self.assertIsNone(
            bazi_months._qiyun_offset({"years": 7, "months": 3, "days": "x", "precision": "days"})
        )
        # 没写 precision 时按"月"口径读，days 缺省为 0 是合理的
        self.assertEqual(bazi_months._qiyun_offset({"years": 7, "months": 3}), (87, 0))
        self.assertEqual(
            bazi_months._qiyun_offset({"years": 7, "months": 3, "days": 0, "precision": "days"}),
            (87, 0),
        )
        self.assertEqual(
            bazi_months._qiyun_offset({"years": 7, "months": 3, "days": 12, "precision": "days"}),
            (87, 12),
        )
        # 月精度：days 缺省为 0 是合理口径
        self.assertEqual(
            bazi_months._qiyun_offset({"years": 7, "months": 3, "precision": "months"}),
            (87, 0),
        )
        # 浮点必须整数值，`int(7.9)` 那种静默截断不接受；非有限浮点也不能炸
        self.assertIsNone(
            bazi_months._qiyun_offset({"years": 7.9, "months": 3, "days": 0, "precision": "days"})
        )
        self.assertEqual(
            bazi_months._qiyun_offset({"years": 7.0, "months": 3, "days": 0, "precision": "days"}),
            (87, 0),
        )
        for bad in (float("inf"), float("-inf"), float("nan")):
            self.assertIsNone(
                bazi_months._qiyun_offset({"years": bad, "months": 3, "days": 0, "precision": "days"}),
                bad,
            )

        for junk in (None, {}, {"precision": "days"}, {"precision": "months"},
                     {"years": -1, "months": 0}, {"years": True}):
            self.assertIsNone(bazi_months._qiyun_offset(junk), junk)

        # 某个字段给了但读不懂时，不能用剩下的字段凑一个结论
        for broken in (
            {"years": True, "months": 3, "precision": "months"},
            {"years": "x", "months": 3, "precision": "months"},
            {"years": 7, "months": [], "precision": "months"},
            {"years": 7, "months": 3, "days": "abc", "precision": "days"},
        ):
            self.assertIsNone(bazi_months._qiyun_offset(broken), broken)
        # 数字字符串是可解析的，按数字用；缺 days 在月精度下仍可用
        self.assertEqual(
            bazi_months._qiyun_offset({"years": 7, "months": 3, "days": "0", "precision": "days"}),
            (87, 0),
        )
        # 但「没给」与「给错」要区分开：缺 days 在月精度下仍可用
        # 精度声称到「月」却只给年：月份其实是未知的，不能当 0
        self.assertIsNone(
            bazi_months._qiyun_offset({"years": 7, "precision": "months"})
        )
        self.assertIsNone(
            bazi_months._qiyun_offset({"years": 7, "precision": "days"})
        )
        # 年起运、月起运缺任一都不可用（缺年最多差十几年，缺月最多差 11 个月）
        self.assertIsNone(bazi_months._qiyun_offset({"months": 3}))
        for precision in ("months", "days", "years", "unknown", None):
            payload = {"years": 7}
            if precision is not None:
                payload["precision"] = precision
            with self.subTest(precision=precision):
                self.assertIsNone(bazi_months._qiyun_offset(payload))

    def test_ac04i_unknown_qiyun_precision_is_treated_as_coarse(self):
        """ac4（续）：起运精度写成 unknown 时，不能当成能精确切月。"""
        calculation = copy.deepcopy(self.calculation)
        start = dict(calculation["luck_cycles"]["start"])
        start["precision"] = "unknown"
        calculation["luck_cycles"]["start"] = start

        facts = build_monthly_facts(calculation, 2027, self.normalized)
        statuses = [month["luck"]["status"] for month in facts["months"]]
        self.assertNotIn("split", statuses, "精度未知时不许按精确时刻把月份切开")
        self.assertIn("indeterminate", statuses, "换运点附近的月份必须标不确定")

        for month in facts["months"]:
            if month["luck"]["status"] == "indeterminate":
                self.assertIn("起运精度仅到月", month["luck"]["reason"])
                self.assertIn("luck", month["relation_scope"]["omitted_layers"])

    def test_ac04h_cycle_end_is_a_boundary_even_with_gaps(self):
        """ac4（续）：序号缺一条时，前一运的**终点**也必须是换运点。"""
        calculation = copy.deepcopy(self.calculation)
        cycles = calculation["luck_cycles"]["cycles"]
        kept = [c for c in cycles if str(c.get("sequence")) != "2"]
        self.assertLess(len(kept), len(cycles), "夹具里没有 sequence=2 的周期")
        calculation["luck_cycles"]["cycles"] = kept

        boundaries = bazi_months._dayun_boundaries(calculation, self.normalized)
        self.assertGreaterEqual(len(boundaries), 2)

        # 缺了第 2 运，第 1 运的终点（= 第 2 运本该开始的时刻）必须仍在边界集合里，
        # 否则跨越该时刻的月份不会被识别为"覆盖发生变化"。
        resolved_just_before = bazi_months.resolve_dayun_at(
            calculation, self.normalized, boundaries[1] - timedelta(days=1)
        )
        resolved_just_after = bazi_months.resolve_dayun_at(
            calculation, self.normalized, boundaries[1] + timedelta(days=1)
        )
        self.assertEqual(resolved_just_before["status"], "ok")
        self.assertEqual(int(resolved_just_before["sequence"]), 1)
        # 第 2 运不存在，所以之后应落进第 3 运或明确不可用，不能还是第 1 运
        self.assertNotEqual(
            resolved_just_after.get("sequence"), 1,
            "过了第 1 运终点之后仍绑在第 1 运上",
        )

    def test_ac04j_binding_values_resolve_to_real_pillar_values(self):
        """ac4（续）：绑定值必须真的是那一层的干支，而不只是一个非空值。

        「参与者能解析到输入」有两层意思：名字对得上，**值也要对得上**。
        只验非空的话，绑定成任意别的柱也能通过。
        """
        facts = build_monthly_facts(self.calculation, 2026, self.normalized)
        checked = check_binding_values(facts, self.calculation["pillars"])
        self.assertGreater(checked, 0, "没有任何关系绑定被检查到")

    def test_ac04j2_binding_value_check_catches_wrong_values(self):
        """证明 ac04j 不是摆设：三种篡改都必须被抓到。"""
        facts = build_monthly_facts(self.calculation, 2026, self.normalized)
        pillars = self.calculation["pillars"]
        check_binding_values(facts, pillars)     # 原始数据应通过

        def first_binding(mutate):
            tampered = copy.deepcopy(facts)
            for month in tampered["months"]:
                for relation in month["relations"]:
                    for binding in relation["bindings"]:
                        if mutate(month, relation, binding, tampered):
                            return tampered
            return None

        # (a) 完全不属于任何柱的字
        hit = first_binding(lambda m, r, b, t: (b.update(value="〇"), True)[1])
        self.assertIsNotNone(hit, "没有可篡改的绑定")
        with self.assertRaises(AssertionError):
            check_binding_values(hit, pillars)

        # (b) 值属于"整层"，但不属于该 participant —— 旧检查会放过，新检查必须抓到
        day_stem = pillars["day"]["stem"]
        year_stem = pillars["year"]["stem"]
        if day_stem != year_stem:
            hit = first_binding(
                lambda m, r, b, t: (
                    b["participant"] == "year" and b["channel"] == "stem" and b.update(value=day_stem) is None
                )
            )
            if hit is not None:
                with self.assertRaises(AssertionError):
                    check_binding_values(hit, pillars)

        # (c) 大运绑定取用别的周期的干支 —— 旧检查（合并全年集合）同样会放过
        cycles = [gz for gz in facts["layers"]["luck"].get("cycles_used") or [] if len(gz) == 2]
        if len(cycles) >= 2:
            other_stem = cycles[0][0] if cycles[0][0] != cycles[1][0] else None
            if other_stem:
                def swap(month, relation, binding, _t):
                    if binding["participant"] != "dayun" or binding["channel"] != "stem":
                        return False
                    current = binding["value"]
                    if current == other_stem:
                        return False
                    binding["value"] = other_stem
                    return True

                hit = first_binding(swap)
                if hit is not None:
                    with self.assertRaises(AssertionError):
                        check_binding_values(hit, pillars)

    def test_ac04k_unsupported_relation_kinds_are_declared_not_faked(self):
        """ac4（续）：未实现的关系类型必须显式声明，且绝不能出现在产出里。

        对应 plan.json 的假设「关系类型和审计范围应复用现有规则，并明确记录尚未实现的
        组合类型，不能将现有原局审计当成全层覆盖」。
        """
        facts = build_monthly_facts(self.calculation, 2026, self.normalized)
        audit = facts["relation_audit"]

        supported = list(audit["supported"])
        unsupported = list(audit["unsupported"])
        self.assertTrue(supported, "supported 不能为空")
        self.assertEqual(set(supported) & set(unsupported), set(), "同一类型不能既支持又不支持")
        # 关系表已补全十种。unsupported 允许为空，但必须**真的**覆盖全部已知类型：
        # 少一种却没声明，才算"声称全层已覆盖"。这条比"unsupported 不能为空"更准。
        expected_kinds = {
            "stem-combine",
            "stem-clash",
            "stem-three-combine",
            "branch-six-combine",
            "branch-six-clash",
            "branch-harm",
            "branch-break",
            "branch-punishment",
            "branch-three-harmony",
            "branch-three-meeting",
            "branch-half-harmony",
            "branch-arch-harmony",
            "branch-half-meeting",
            "branch-arch-meeting",
            "branch-hidden-combine",
            "branch-hidden-stem-combine-candidate",
        }
        self.assertEqual(
            set(supported) | set(unsupported),
            expected_kinds,
            "支持与未支持合起来必须等于全部已知关系类型，不能有静默缺口",
        )
        self.assertTrue(audit.get("unsupported_note"), "未支持类型必须给出说明")
        # 新增的十种里，能在本月产出的必须真的出现
        for kind in ("branch-half-harmony", "branch-arch-harmony",
                     "branch-half-meeting", "branch-arch-meeting",
                     "stem-three-combine", "branch-hidden-combine"):
            self.assertIn(kind, supported, f"{kind} 应已实现")

        emitted = {
            relation["kind"]
            for month in facts["months"]
            for relation, _segment in iter_relations(month)
        }
        self.assertTrue(emitted, "夹具应产出至少一条关系")
        self.assertEqual(
            emitted - set(supported), set(),
            f"产出了不在 supported 里的类型：{emitted - set(supported)}",
        )
        self.assertEqual(
            emitted & set(unsupported), set(),
            f"产出了已声明未实现的类型：{emitted & set(unsupported)}",
        )

    def test_ac04l_mid_year_respects_boundary_uncertainty(self):
        """ac4（续）：换运点贴着 7-01 时，年中干支不能给出确定结论。"""
        calculation = copy.deepcopy(self.calculation)
        start = dict(calculation["luck_cycles"]["start"])
        start["precision"] = "months"          # 起运只到月 → ±31 天容差
        calculation["luck_cycles"]["start"] = start

        mid = datetime(2026, 7, 1, 12, 0, tzinfo=engine.BJ)
        # 把一个换运点放到 7-01 前 10 天（落在 ±31 天容差内）
        boundary = mid - timedelta(days=10)
        with mock.patch.object(bazi_months, "_dayun_boundaries", return_value=[boundary]):
            facts = bazi_months.build_monthly_facts(calculation, 2026, self.normalized)

        mid_year = facts["layers"]["luck"]["mid_year"]
        self.assertEqual(mid_year["status"], "indeterminate", mid_year)
        self.assertIn("无法确定归属", mid_year["reason"])
        self.assertIsNone(mid_year.get("ganzhi"), "不确定时不能给确定干支")
        self.assertEqual(mid_year["boundaries"], [boundary.isoformat()])

        # 换运点离年中足够远时，仍应给出确定结论
        far = mid - timedelta(days=200)
        with mock.patch.object(bazi_months, "_dayun_boundaries", return_value=[far]):
            facts_far = bazi_months.build_monthly_facts(calculation, 2026, self.normalized)
        self.assertNotEqual(facts_far["layers"]["luck"]["mid_year"]["status"], "indeterminate")

    def test_ac04m_incomplete_pillars_are_flagged_not_hidden(self):
        """ac4（续）：四柱不全时要如实标注，而不是让人以为原局层已完整审计。

        真实场景就是「已知日不知时辰」——只有时柱缺失。上游关系表至少要年月日，
        所以能审计；但原局层必须标成不完整。
        """
        calculation = copy.deepcopy(self.calculation)
        calculation["pillars"] = {
            name: calculation["pillars"][name] for name in ("year", "month", "day")
        }

        facts = bazi_months.build_monthly_facts(calculation, 2026, self.normalized)
        audit = facts["relation_audit"]

        self.assertEqual(audit["status"], "partial", "四柱不全时状态不能是 ok")
        self.assertFalse(audit["natal"]["complete"])
        self.assertEqual(sorted(audit["natal"]["present"]), ["day", "month", "year"])
        self.assertEqual(audit["natal"]["missing"], ["hour"])
        self.assertIn("四柱不全", audit["note"])

        for month in facts["months"]:
            scope = month.get("relation_scope")
            self.assertIsNotNone(scope, f"第 {month['index']} 月缺 relation_scope")
            self.assertIs(scope.get("natal_complete"), False)
            self.assertIn("四柱不全", scope.get("reason") or "")

        # 完整四柱时反过来必须是 True 且状态回到 ok
        full = bazi_months.build_monthly_facts(self.calculation, 2026, self.normalized)
        self.assertTrue(full["relation_audit"]["natal"]["complete"])
        self.assertEqual(full["relation_audit"]["status"], "ok")
        for month in full["months"]:
            self.assertIs(month["relation_scope"].get("natal_complete"), True)

    def test_ac04n_qiyun_overflow_is_unavailable_not_crash(self):
        """ac4（续）：起运偏移把时刻推出可表示范围时，返回不可用而不是抛异常。"""
        normalized = copy.deepcopy(self.normalized)
        normalized["profile"]["solar_date"] = "9999-01-01"

        calculation = copy.deepcopy(self.calculation)
        calculation["luck_cycles"]["start"] = {"years": 1, "months": 0, "days": 0, "precision": "months"}

        # 不抛异常是底线
        facts = bazi_months.build_monthly_facts(calculation, 2026, normalized)
        self.assertEqual(facts["status"], "ok")
        self.assertEqual(facts["layers"]["luck"]["status"], "unavailable")
        self.assertEqual(bazi_months._dayun_boundaries(calculation, normalized), [])

        resolved = bazi_months.resolve_dayun_at(
            calculation, normalized, datetime(2026, 7, 1, 12, 0, tzinfo=engine.BJ)
        )
        self.assertEqual(resolved["status"], "unavailable")
        self.assertIn("超出可表示范围", resolved["reason"])

    def test_ac04o_absurd_cycle_sequence_does_not_crash(self):
        """ac4（续）：周期序号大到边界越界时，跳过该序列而不是抛异常。"""
        normalized = copy.deepcopy(self.normalized)
        normalized["profile"]["solar_date"] = "2000-01-01"

        calculation = copy.deepcopy(self.calculation)
        calculation["luck_cycles"]["start"] = {"years": 0, "months": 0, "days": 0, "precision": "days"}
        cycles = calculation["luck_cycles"]["cycles"]
        cycles.append({**cycles[-1], "sequence": 1000, "age_range": "9990-9999岁"})

        # 关键是不抛
        boundaries = bazi_months._dayun_boundaries(calculation, normalized)
        self.assertIsInstance(boundaries, list)
        facts = bazi_months.build_monthly_facts(calculation, 2026, normalized)
        self.assertEqual(facts["status"], "ok")

    def test_ac04p_explicit_null_qiyun_field_is_not_zero(self):
        """ac4（续）：`years: null` 是「给了但不知道」，不能当成 0 年。"""
        self.assertIsNone(bazi_months._qiyun_offset({"years": None, "months": 3, "precision": "months"}))
        self.assertIsNone(bazi_months._qiyun_offset({"years": 7, "months": None}))
        self.assertIsNone(bazi_months._qiyun_offset({"months": 3, "days": None, "precision": "days"}))
        # 只有月份、没有年份：年份未知，不能当 0
        self.assertIsNone(bazi_months._qiyun_offset({"months": 3}))
        # 年月都给齐才算数
        self.assertEqual(bazi_months._qiyun_offset({"years": 0, "months": 3}), (3, 0))
        # 只有 days 没有年/月：起运年龄本身没给，不能读成"出生即起运"
        self.assertIsNone(bazi_months._qiyun_offset({"precision": "days", "days": 0}))
        self.assertIsNone(bazi_months._qiyun_offset({"precision": "days", "days": 12}))

    def test_ac04q_mid_year_out_of_range_is_unavailable(self):
        """ac4（续）：年份超出 datetime 可表示范围时，返回不可用而不是抛异常。"""
        for year in (10000, -1, 0):
            with self.subTest(year=year):
                resolved = bazi_months.resolve_dayun(self.calculation, self.normalized, year)
                self.assertEqual(resolved["status"], "unavailable")
                self.assertIn("超出可表示范围", resolved["reason"])
        # 覆盖范围内仍应正常
        ok = bazi_months.resolve_dayun(self.calculation, self.normalized, 2026)
        self.assertIn(ok["status"], {"ok", "before_start", "unavailable"})
        self.assertEqual(ok["scope"], "mid-year")

    def test_ac04r_dirty_qiyun_container_does_not_crash(self):
        """ac4（续）：luck_cycles.start 是脏类型时不能把整包构建打崩。"""
        for dirty in ("unknown", [], 7, [1, 2]):
            with self.subTest(start=dirty):
                calculation = copy.deepcopy(self.calculation)
                calculation["luck_cycles"]["start"] = dirty
                facts = bazi_months.build_monthly_facts(calculation, 2026, self.normalized)
                self.assertEqual(facts["status"], "ok")
                self.assertEqual(facts["layers"]["luck"]["status"], "unavailable")
                # 十二个月全部没有大运层
                self.assertEqual(
                    facts["relation_audit"]["luck_coverage"]["months_without_luck"],
                    list(range(1, 13)),
                )

    def test_ac04s_awareness_mismatch_is_normalised(self):
        """ac4（续）：naive / 非北京时区的 moment 不能把比较打崩。"""
        aware = bazi_months.resolve_dayun_at(
            self.calculation, self.normalized, datetime(2026, 7, 1, 12, 0, tzinfo=engine.BJ)
        )
        naive = bazi_months.resolve_dayun_at(
            self.calculation, self.normalized, datetime(2026, 7, 1, 12, 0)
        )
        self.assertEqual(naive["status"], aware["status"])
        if aware["status"] == "ok":
            self.assertEqual(naive["ganzhi"], aware["ganzhi"])

        # 其它时区先换算到北京时间，同一瞬间应判到同一运
        from datetime import timezone as _tz

        utc_same_instant = datetime(2026, 7, 1, 4, 0, tzinfo=_tz.utc)   # = 北京 12:00
        resolved = bazi_months.resolve_dayun_at(self.calculation, self.normalized, utc_same_instant)
        self.assertEqual(resolved["status"], aware["status"])
        if aware["status"] == "ok":
            self.assertEqual(resolved["ganzhi"], aware["ganzhi"])

        # 脏类型不能崩
        self.assertEqual(
            bazi_months.resolve_dayun_at(self.calculation, self.normalized, "2026-07-01")["status"],
            "unavailable",
        )

    def test_ac03m_sichen_qiyun_sensitivity_is_applied(self):
        """ac3 的前置：只知时辰时的 ±1 小时也要放大成换运点漂移（约 5 天）。

        起运年龄 = 出生到节气的距离 × (1 年 / 3 天)，所以出生偏 1 天 → 起运偏约 122 天。
        """
        coarse = copy.deepcopy(self.normalized)
        coarse["profile"]["time"] = {"precision": "branch", "branch": "午"}

        calculation = copy.deepcopy(self.calculation)
        start = dict(calculation["luck_cycles"]["start"])
        start["precision"] = "days"          # 否则会被 ±31 天的月度容差先拦住
        calculation["luck_cycles"]["start"] = start

        baseline = build_monthly_facts(calculation, 2026, coarse)
        anchor = baseline["months"][4]
        month_start = datetime.fromisoformat(anchor["start"])
        # 估算换运点在月初前 2 天：只有把 ±1h 放大成 ~5 天才会被判为不确定
        boundary = month_start - timedelta(days=2)

        with mock.patch.object(bazi_months, "_dayun_boundaries", return_value=[boundary]):
            patched = bazi_months.build_monthly_facts(calculation, 2026, coarse)

        month = patched["months"][4]
        self.assertEqual(
            month["luck"]["status"], "indeterminate",
            "月初前 2 天的换运点在 ±1h 放大后应落在不确定带内",
        )
        self.assertIn("luck", month["relation_scope"]["omitted_layers"])

    def test_ac03n_zishi_tolerance_breakdown_is_consistent(self):
        """ac3 的前置：输出的分项必须与实际采用的总容差自洽。

        子时：总容差 = 出生误差 ±12 小时 + 起运漂移（上游基准 00:00 到 23:59:59 的 24 小时）。
        """
        zi = copy.deepcopy(self.normalized)
        zi["profile"]["time"] = {"precision": "branch", "branch": "子"}

        facts = build_monthly_facts(self.calculation, 2026, zi)
        ambiguity = facts["layers"]["luck"]["birth_time_ambiguity"]
        expected_drift = bazi_months._qiyun_sensitivity(timedelta(hours=24))
        self.assertEqual(
            ambiguity["tolerance_seconds"],
            int((timedelta(hours=12) + expected_drift).total_seconds()),
            "总容差必须等于出生误差 + 起运漂移",
        )
        self.assertEqual(
            ambiguity["qiyun_sensitivity_days"], round(expected_drift.total_seconds() / 86400, 1)
        )
        self.assertGreaterEqual(ambiguity["qiyun_sensitivity_days"], 121.0)
        # 上游基准差取 24 小时而非 23.5：晚子最晚到 23:59:59
        self.assertEqual(bazi_months._upstream_qiyun_gap(zi), timedelta(hours=24))
        # 子时的日柱本身就不确定（早子 D / 晚子 D+1），原局层必须标不确定
        self.assertTrue(facts["relation_audit"]["natal"]["uncertain"])
        self.assertIn("早子", facts["relation_audit"]["natal"]["uncertain_reason"])
        self.assertEqual(facts["relation_audit"]["status"], "partial")

    def test_ac03p_boundary_birth_date_does_not_overflow(self):
        """ac3 的前置：9999-12-31 子时加窗口会溢出，必须夹到可表示范围而不是崩。"""
        extreme = copy.deepcopy(self.normalized)
        extreme["profile"]["solar_date"] = "9999-12-31"
        extreme["profile"]["time"] = {"precision": "branch", "branch": "子"}

        facts = bazi_months.build_monthly_facts(self.calculation, 2026, extreme)
        self.assertEqual(facts["status"], "ok")
        self.assertEqual(facts["layers"]["luck"]["status"], "unavailable")

        # 同理 0001-01-01 也不许溢出
        early = copy.deepcopy(self.normalized)
        early["profile"]["solar_date"] = "0001-01-01"
        early["profile"]["time"] = {"precision": "branch", "branch": "子"}
        self.assertEqual(
            bazi_months.build_monthly_facts(self.calculation, 2026, early)["status"], "ok"
        )
    def assert_evidence_paths(self, facts: dict, label: str) -> None:
        """包里每个带 evidence_id 的对象都必须有 json_pointer，且指回它自己。"""
        evidence_objects = list(iter_evidence_objects(facts))
        self.assertGreater(len(evidence_objects), 0, f"{label} 没有证据对象")
        for evidence, path in evidence_objects:
            pointer = evidence.get("json_pointer")
            self.assertTrue(pointer, f"{label} {path}（{evidence['evidence_id']}）缺 json_pointer")
            self.assertIs(
                resolve_pointer(facts, pointer), evidence,
                f"{label} 的 {pointer} 没有指向 {evidence['evidence_id']} 本身",
            )
        self.assertGreaterEqual(
            len(list(iter_pointers(facts))), len(evidence_objects),
            f"{label} 的指针总数没覆盖每个证据对象",
        )

    def test_ac06_half_years_and_every_pointer_resolves(self):
        """ac6：上下半年各 6 个月；包内每个 JSON Pointer 都能解到非缺失值。"""
        # 两类包都要验：纯坐标包，以及**带分段**的关系审计包——
        # 只验前者的话，分段/关系里的指针断链不会被发现。
        audited: dict[int, Any] = {}
        for year in SUPPORTED_YEARS:
            with self.subTest(year=year):
                facts = build_monthly_facts(None, year)
                first = facts["half_years"]["first_half"]
                second = facts["half_years"]["second_half"]
                self.assertEqual(first["months"], [1, 2, 3, 4, 5, 6])
                self.assertEqual(second["months"], [7, 8, 9, 10, 11, 12])
                self.assertEqual(len(first["evidence_ids"]), 6)
                self.assertEqual(len(second["evidence_ids"]), 6)

                for month in facts["months"]:
                    value = resolve_pointer(facts, month["json_pointer"])
                    self.assertIsNotNone(value)
                    self.assertEqual(value["index"], month["index"])
                    self.assertNotIn(value["ganzhi"], ("", None))

                # 包里**任何位置**出现的 JSON Pointer 都必须真的能解到东西，
                # 不能只验 monthly 那一个（别处断链同样要被抓到）
                for pointer in iter_pointers(facts):
                    self.assertIsNotNone(resolve_pointer(facts, pointer), pointer)

                # 纯坐标包同样要满足「每个证据对象都有指回自己的指针」
                self.assert_evidence_paths(facts, f"坐标包 {year}")

                # 半年汇总的证据 ID 必须正好是那六个月自己的证据，不能张冠李戴
                for half, expected_months in (
                    (first, [1, 2, 3, 4, 5, 6]),
                    (second, [7, 8, 9, 10, 11, 12]),
                ):
                    from_months = [
                        resolve_pointer(facts, facts["months"][index - 1]["json_pointer"])["evidence_id"]
                        for index in expected_months
                    ]
                    self.assertEqual(
                        half["evidence_ids"], from_months,
                        f"半年汇总的证据顺序/内容与该六个月不一致（{expected_months}）",
                    )

        # 带关系审计的包：必须有分段（否则分段里的指针根本没被检查到）
        coarse = copy.deepcopy(self.normalized)
        coarse["profile"]["time"] = {"precision": "branch", "branch": "午"}
        calculation = copy.deepcopy(self.calculation)
        start = dict(calculation["luck_cycles"]["start"])
        start["precision"] = "days"
        calculation["luck_cycles"]["start"] = start
        baseline = build_monthly_facts(calculation, 2026, coarse)
        anchor = datetime.fromisoformat(baseline["months"][5]["start"])
        cut = anchor + timedelta(days=15)
        with mock.patch.object(bazi_months, "_dayun_boundaries", return_value=[cut]):
            audited[2027] = bazi_months.build_monthly_facts(calculation, 2026, coarse)

        for year, facts in audited.items():
            with self.subTest(audited=year):
                pointers = list(iter_pointers(facts))
                self.assertGreaterEqual(len(pointers), 12, "审计包里的指针数量异常")
                for pointer in pointers:
                    self.assertIsNotNone(resolve_pointer(facts, pointer), pointer)
                # 该样本必须真的含分段关系，否则"分段指针也验过"是空话
                segmented = [
                    month for month in facts["months"] if month.get("relation_segments")
                ]
                self.assertTrue(segmented, f"{year} 的审计包没有分段，分段指针未被覆盖")
                segment_relations = 0
                for month in segmented:
                    for segment in month["relation_segments"]:
                        self.assertTrue(
                            segment.get("relations") is not None,
                            "分段必须带自己的关系数组",
                        )
                        segment_relations += len(segment.get("relations") or [])
                self.assertGreater(
                    segment_relations, 0,
                    "分段关系整体为空：切段功能等于没生效",
                )

                # 每条证据都要**有**指针，而且指针要指回它自己（不是随便指个月）。
                # 用通用遍历，不写死"月 + 关系"。
                self.assert_evidence_paths(facts, f"审计包 {year}")

    def test_ac06c_pointer_resolver_rejects_malformed_forms(self):
        """ac6（续）：解析器本身要严格，否则"能解到"这件事没有说服力。"""
        document = {"a": [1, 2, 3], "": "empty-key", "b/c": "slash", "t~x": "tilde"}
        self.assertEqual(resolve_pointer(document, ""), document)
        self.assertEqual(resolve_pointer(document, "/a/0"), 1)
        self.assertEqual(resolve_pointer(document, "/b~1c"), "slash")
        self.assertEqual(resolve_pointer(document, "/t~0x"), "tilde")

        # "/" 指向空字符串键，不是根
        self.assertEqual(resolve_pointer(document, "/"), "empty-key")
        for bad in ("/a/-1", "/a/01", "/a/+1", "/a/3", "a/0", "/nope"):
            with self.subTest(pointer=bad):
                with self.assertRaises((KeyError, ValueError)):
                    resolve_pointer(document, bad)

    # ---------------------------------------------------------------- ac7
    def test_ac07_package_year_binding_is_independent_of_array_order(self):
        """ac7：包内 year 与每月流年事实年份一致，且选年不依赖年度数组最后一项。

        不能只比对 ``facts["annual"]["year"]``——那只是把入参抄回去，同义反复。
        这里走真实装配路径：拿一个``annual_cycles`` 尾项与目标年不同的 calculation，
        验证包内年份、年干五虎遁、以及跨年差异都由**入参 year** 决定。
        """
        packages = {}
        for year in (2026, 2027, 2030):
            with self.subTest(year=year):
                facts = build_monthly_facts(self.calculation, year, self.normalized)
                packages[year] = facts

                self.assertEqual(facts["target_year"], year)
                self.assertEqual(facts["annual"]["year"], year)
                self.assertEqual(facts["annual"]["ganzhi"], engine.liunian_gz(year))

                annual_gan_index = engine.GAN.index(facts["annual"]["gan"])
                yin_stem = engine.YUE_GAN_YIN[annual_gan_index]
                for position, month in enumerate(facts["months"]):
                    expected_gan = engine.GAN[(yin_stem + position) % 10]
                    self.assertEqual(
                        month["gan"], expected_gan,
                        f"{year} 第 {position + 1} 月天干不是对目标年干起五虎遁",
                    )

        # 装配输入里的年度数组尾项 != 我们要的年份：选年若依赖「最后一项」立刻露馅
        cycles = self.calculation.get("annual_cycles") or []
        tail_year = cycles[-1].get("year") if cycles else None
        if isinstance(tail_year, int):
            probe_year = 2029 if tail_year != 2029 else 2028
            probed = build_monthly_facts(self.calculation, probe_year, self.normalized)
            self.assertEqual(probed["target_year"], probe_year)
            self.assertEqual(probed["annual"]["year"], probe_year)
            self.assertNotEqual(probed["annual"]["year"], tail_year)
            self.assertEqual(probed["annual"]["ganzhi"], engine.liunian_gz(probe_year))
            self.assertNotEqual(
                probed["annual"]["ganzhi"], engine.liunian_gz(tail_year),
                "包内年柱等于年度数组尾项的年柱，说明选年没走目标年份",
            )

        self.assertNotEqual(
            packages[2026]["months"][0]["ganzhi"],
            packages[2027]["months"][0]["ganzhi"],
        )
        self.assertNotEqual(packages[2026]["fingerprint"], packages[2027]["fingerprint"])
        self.assertNotEqual(
            packages[2026]["annual"]["ganzhi"], packages[2027]["annual"]["ganzhi"]
        )

    # ---------------------------------------------------------------- 边界输入
    def test_ac03d_birth_datetime_rejects_impossible_inputs(self):
        """ac3 的前置：非法日期/非法时刻必须判为「无从确定」，不能崩也不能猜。"""

        def with_date(solar_date, **time_block):
            return {
                "profile": {
                    "solar_date": solar_date,
                    "time": time_block or {"precision": "minute", "value": "12:30"},
                }
            }

        # 日期放在 profile.solar_date 上，不能被 time 里的同名参数顶掉
        self.assertIsNone(_birth_datetime(with_date("2024-02-30")))
        self.assertIsNone(_birth_datetime(with_date("2024-13-01")))
        self.assertIsNone(_birth_datetime(with_date("2024-00-10")))
        self.assertIsNone(_birth_datetime(with_date("not-a-date")))
        self.assertIsNone(_birth_datetime(with_date("")))
        # 合法日期对照：这些必须能算出来，否则上一条可能只是「整体不可用」而非日期校验
        self.assertIsNotNone(_birth_datetime(with_date("2024-02-29")))
        self.assertIsNotNone(_birth_datetime(with_date("2023-02-28")))

        # 时刻校验
        self.assertIsNone(_birth_datetime(with_date("1990-05-15", precision="minute", value="12:30:99")))
        self.assertIsNone(_birth_datetime(with_date("1990-05-15", precision="minute", value="25:00")))
        self.assertIsNone(_birth_datetime(with_date("1990-05-15", precision="minute", value="12:70")))
        self.assertIsNone(_birth_datetime(with_date("1990-05-15", precision="minute", value="1230")))
        self.assertIsNone(_birth_datetime(with_date("1990-05-15", precision="unknown", value="12:30")))
        # 精度缺失但 value 看起来合法，也不能被采信
        self.assertIsNone(_birth_datetime({"profile": {"solar_date": "1990-05-15", "time": {"value": "12:30"}}}))
        self.assertIsNone(_birth_datetime({"profile": {"solar_date": "1990-05-15"}}))
        self.assertIsNone(_birth_datetime(None))

    def test_ac03e_birth_datetime_sichen_midpoints(self):
        """ac3 的前置：时辰取窗口中点；子时取早/晚子的中点 12:00。

        不能用上游日柱区分早/晚子——上游在「只知子时」时本身就按早子取日柱，
        拿它反推是循环论证。
        """
        # 非子时：窗口 [k*2, k*2+2)，中点就是 k*2
        for branch, expected_hour in (("丑", 2), ("午", 12), ("亥", 22)):
            block = {"profile": {"solar_date": "1990-05-15", "time": {"precision": "branch", "branch": branch}}}
            moment = _birth_datetime(block)
            self.assertIsNotNone(moment)
            self.assertEqual((moment.hour, moment.minute), (expected_hour, 0), branch)

        # 子时：早子 00:30 与晚子 23:30 相差约 23 小时，估算点取两者中点 12:00
        zi_block = {"profile": {"solar_date": "1990-05-15", "time": {"precision": "branch", "branch": "子"}}}
        moment = _birth_datetime(zi_block)
        self.assertIsNotNone(moment)
        self.assertEqual((moment.hour, moment.minute), (12, 0))

        tolerance = _birth_time_tolerance(zi_block)
        self.assertEqual(tolerance, timedelta(hours=12))
        # 配 ±12 小时后，两个候选都必须落在不确定带内
        early = moment.replace(hour=0, minute=30)
        late = moment.replace(hour=23, minute=30)
        self.assertLessEqual(abs(early - moment), tolerance, "早子候选未被覆盖")
        self.assertLessEqual(abs(late - moment), tolerance, "晚子候选未被覆盖")

    def test_ac03f_time_tolerance_is_explicit(self):
        """ac3 的前置：出生时刻不确定度必须显式，不能当成 0。"""
        self.assertEqual(
            _birth_time_tolerance({"profile": {"time": {"precision": "minute", "value": "12:30"}}}),
            timedelta(0),
        )
        self.assertEqual(
            _birth_time_tolerance({"profile": {"time": {"precision": "branch", "branch": "午"}}}),
            timedelta(hours=1),
        )
        self.assertIsNone(_birth_time_tolerance({"profile": {"time": {"precision": "unknown"}}}))
        self.assertIsNone(_birth_time_tolerance(None))

        # 子时跨日界：日柱是上游按早子取的，不能反过来当证据，所以不确定度放宽到 ±12 小时
        zi = {"profile": {"solar_date": "1990-05-15", "time": {"precision": "branch", "branch": "子"}}}
        self.assertEqual(
            _birth_time_tolerance(zi), timedelta(hours=12),
            "只知子时时早/晚子相差约 23 小时，容差必须覆盖两种可能",
        )
        # 缺日期时连子时也无从估计
        self.assertIsNone(
            _birth_time_tolerance({"profile": {"time": {"precision": "branch", "branch": "子"}}})
        )

    def test_ac03g_boundary_classification_is_tolerance_aware(self):
        """ac3 的前置：月界外/贴界/月内三种换运点必须被分别判对。

        直接用构造时刻测判定函数，而不是靠扫描真实历法去撞一个 ±1 小时的巧合——
        那样既慢又可能一次都不命中，断言会空转通过。
        """
        tol = timedelta(hours=1)
        start = datetime(2026, 3, 1, 0, 0)
        end = datetime(2026, 4, 1, 0, 0)

        # 估算点在月外 30 分钟：真实点可能落进月内 → 整月归属不确定
        outside_but_near = _classify_boundaries(start, end, [start - timedelta(minutes=30)], tol)
        self.assertEqual(outside_but_near["kind"], "ambiguous")
        self.assertTrue(outside_but_near["ambiguous"])
        self.assertEqual(outside_but_near["split"], [])

        # 贴本月起点 30 分钟 → 同样不确定
        self.assertEqual(
            _classify_boundaries(start, end, [start + timedelta(minutes=30)], tol)["kind"],
            "ambiguous",
        )
        # 贴本月终点 30 分钟 → 同样不确定
        self.assertEqual(
            _classify_boundaries(start, end, [end - timedelta(minutes=30)], tol)["kind"],
            "ambiguous",
        )

        # 月内但离两端都超过 1 小时 → 可以拆，且切点带不确定度
        inside = _classify_boundaries(start, end, [start + timedelta(days=10)], tol)
        self.assertEqual(inside["kind"], "split")
        self.assertEqual(len(inside["split"]), 1)

        # 离两端正好 59 分钟 → 仍在容差内，不许拆
        self.assertEqual(
            _classify_boundaries(start, end, [start + timedelta(minutes=59)], tol)["kind"],
            "ambiguous",
        )
        # 离两端正好 61 分钟 → 超出容差，可以拆
        self.assertEqual(
            _classify_boundaries(start, end, [start + timedelta(minutes=61)], tol)["kind"],
            "split",
        )
        # 容差带两端闭合：正好落在 start+tol / end-tol 上仍属不确定
        self.assertEqual(
            _classify_boundaries(start, end, [start + tol], tol)["kind"],
            "ambiguous",
            "正好落在容差带边缘时，真实点仍可能跨进月内",
        )
        self.assertEqual(
            _classify_boundaries(start, end, [end - tol], tol)["kind"],
            "ambiguous",
        )
        # 带内紧邻边缘一点也要判不确定
        self.assertEqual(
            _classify_boundaries(start, end, [start + tol - timedelta(seconds=1)], tol)["kind"],
            "ambiguous",
        )

        # 月内没有换运点
        self.assertEqual(_classify_boundaries(start, end, [], tol)["kind"], "single")

        # 精度未知（tolerance=None）不能被当成「误差为零」
        self.assertEqual(
            _classify_boundaries(start, end, [start + timedelta(days=10)], None)["kind"],
            "unknown",
            "tolerance=None 表示精度未知，不能退化成精确判定",
        )
        self.assertEqual(
            _classify_boundaries(start, end, [], None)["kind"],
            "unknown",
        )

        # 精确到分钟（容差 0）时，按半开区间：月初换运整月归新运，月末换运不属于本月
        self.assertEqual(
            _classify_boundaries(start, end, [start + timedelta(minutes=1)], timedelta(0))["kind"],
            "split",
        )
        self.assertEqual(
            _classify_boundaries(start, end, [start], timedelta(0))["kind"],
            "single",
            "精确换运点恰好落在月初时，整月已属新运，不该判成不确定",
        )
        self.assertEqual(
            _classify_boundaries(start, end, [end], timedelta(0))["kind"],
            "single",
            "精确换运点落在月末时不属于本月",
        )

    def test_ac03i_coarse_window_includes_birth_tolerance(self):
        """ac3 的前置：起运只到月时，±1 月窗口必须叠加出生时刻的 ±1 小时。"""
        coarse = copy.deepcopy(self.normalized)
        coarse["profile"]["time"] = {"precision": "branch", "branch": "午"}

        baseline = build_monthly_facts(self.calculation, 2026, coarse)
        anchor = baseline["months"][4]
        month_start = datetime.fromisoformat(anchor["start"])
        # 刚好比「月界前 31 天」再远 30 分钟：只有叠加 ±1 小时才能捕获
        boundary = month_start - timedelta(days=31, minutes=30)

        with mock.patch.object(bazi_months, "_dayun_boundaries", return_value=[boundary]):
            patched = bazi_months.build_monthly_facts(self.calculation, 2026, coarse)

        month = patched["months"][4]
        self.assertEqual(month["luck"]["status"], "indeterminate")
        self.assertIn("起运精度仅到月", month["luck"]["reason"])
        self.assertIn("luck", month["relation_scope"]["omitted_layers"])

    def test_ac03g2_real_charts_respect_the_tolerance(self):
        """ac3 的前置：真实命盘里，被切开的月份切点也从未落进容差带。"""
        coarse = copy.deepcopy(self.normalized)
        coarse["profile"]["time"] = {"precision": "branch", "branch": "午"}
        tolerance = _birth_time_tolerance(coarse)
        self.assertEqual(tolerance, timedelta(hours=1))

        split_seen = 0
        for offset in (0, 37, 120, 400, 900):
            calculation = copy.deepcopy(self.calculation)
            luck = calculation.setdefault("luck_cycles", {})
            start = dict(luck.get("start") or {})
            start["precision"] = "days"
            start["days"] = offset
            luck["start"] = start

            for year in (2026, 2027):
                for month in build_monthly_facts(calculation, year, coarse)["months"]:
                    if month["luck"]["status"] != "split":
                        continue
                    split_seen += 1
                    start_at = datetime.fromisoformat(month["start"])
                    end_at = datetime.fromisoformat(month["end"])
                    self.assertEqual(month["luck"]["boundary_precision"], "birth-time-approximate")
                    self.assertEqual(
                        month["luck"]["boundary_uncertainty_seconds"],
                        int((_effective_tolerance(timedelta(hours=1))
                            + timedelta(hours=12)).total_seconds()),
                    )
                    for boundary in month["luck"]["boundaries"]:
                        moment = datetime.fromisoformat(boundary)
                        # 切点必须落在**有效**容差带之外：这里用的是含起运漂移的容差，
                        # 不是出生误差本身。用 ±1 小时会放过距月界 2 小时的错误切分。
                        effective = _effective_tolerance(tolerance) + timedelta(hours=12)
                        self.assertGreater(
                            moment, start_at + effective,
                            f"{year} 第 {month['index']} 月切点 {moment} 落在有效容差带内却被判 split",
                        )
                        self.assertLess(moment, end_at - effective)
        self.assertGreater(split_seen, 0, "没有 split 月份，真实数据侧的不变式没被验证到")

    def test_ac03g3_edge_boundary_marks_month_indeterminate(self):
        """ac3 的前置：换运点贴着月界时，相邻两个月都必须判为 indeterminate。"""
        coarse = copy.deepcopy(self.normalized)
        coarse["profile"]["time"] = {"precision": "branch", "branch": "午"}

        # 起运精度设为 days，走的是「出生时刻精度」这条路径；
        # precision=months 会先被 ±1 月的容差拦住，测不到这里要验的逻辑。
        calculation = copy.deepcopy(self.calculation)
        luck = calculation.setdefault("luck_cycles", {})
        start = dict(luck.get("start") or {})
        start["precision"] = "days"
        luck["start"] = start

        baseline = build_monthly_facts(calculation, 2026, coarse)
        anchor = baseline["months"][3]
        edge = datetime.fromisoformat(anchor["start"]) - timedelta(minutes=30)

        with mock.patch.object(bazi_months, "_dayun_boundaries", return_value=[edge]):
            patched = bazi_months.build_monthly_facts(calculation, 2026, coarse)

        # 换运点在 3 月起点前 30 分钟：3 月（起点侧）与 2 月（终点侧）都无法确定归属
        for index in (2, 3):
            month = patched["months"][index]
            self.assertEqual(month["luck"]["status"], "indeterminate", f"第 {index + 1} 月应标不确定")
            self.assertIn("出生时刻精度不足", month["luck"]["reason"])
            self.assertEqual(
                month["luck"]["birth_time_tolerance_seconds"], 3600,
                "出生时刻本身的误差仍是 ±1 小时",
            )
            self.assertEqual(
                month["luck"]["tolerance_seconds"],
                int((_effective_tolerance(timedelta(hours=1))
                     + timedelta(hours=12)).total_seconds()),
                "实际判定用的总容差 = 出生误差 + 起运漂移 + 起运精度半日",
            )
            self.assertGreater(
                month["luck"]["qiyun_sensitivity_seconds"], 0,
                "必须记录起运被带动的漂移",
            )
            self.assertIn("luck", month["relation_scope"]["omitted_layers"])
            self.assertNotIn("luck", month["relation_scope"]["computed_layers"])

        # 其它月份不受影响：仍带大运层
        for index in (0, 5, 9):
            month = patched["months"][index]
            self.assertNotEqual(month["luck"]["status"], "indeterminate")
            self.assertIn("luck", month["relation_scope"]["computed_layers"])

    def test_ac03j_uncertain_band_segments_do_not_bind_luck(self):
        """ac3 的前置：切点两侧的不确定带必须单独成段，且不绑大运。"""
        coarse = copy.deepcopy(self.normalized)
        coarse["profile"]["time"] = {"precision": "branch", "branch": "午"}

        calculation = copy.deepcopy(self.calculation)
        luck = calculation.setdefault("luck_cycles", {})
        start = dict(luck.get("start") or {})
        start["precision"] = "days"
        luck["start"] = start

        baseline = build_monthly_facts(calculation, 2026, coarse)
        anchor = baseline["months"][5]
        month_start = datetime.fromisoformat(anchor["start"])
        # 切点放在月中：容差带（≈±5 天）要整段落在月内，带外才谈得上"可确定"
        cut = month_start + timedelta(days=15)

        with mock.patch.object(bazi_months, "_dayun_boundaries", return_value=[cut]):
            patched = bazi_months.build_monthly_facts(calculation, 2026, coarse)

        month = patched["months"][5]
        self.assertEqual(month["luck"]["status"], "split")
        self.assertEqual(month["luck"]["boundary_precision"], "birth-time-approximate")
        bands = month["luck"]["ambiguous_windows"]
        self.assertEqual(len(bands), 1)
        band_lo = datetime.fromisoformat(bands[0][0])
        band_hi = datetime.fromisoformat(bands[0][1])
        # days 精度额外追加 ±12 小时（加在放大之后）
        effective = _effective_tolerance(timedelta(hours=1)) + timedelta(hours=12)
        self.assertEqual(
            band_hi - band_lo, effective * 2, "不确定带宽度应为 2×有效容差"
        )

        segments = month["relation_segments"]
        in_band = [seg for seg in segments if seg["uncertain_band"]]
        out_band = [seg for seg in segments if not seg["uncertain_band"]]
        self.assertEqual(len(in_band), 1, "应恰好有一段落在不确定带内")
        self.assertTrue(out_band, "带外应仍有可确定归属的段")
        self.assertEqual(in_band[0]["luck"]["status"], "indeterminate")
        self.assertIn("luck", in_band[0]["relation_scope"]["omitted_layers"])
        # 带内段仍要算原局/流年/流月关系，不能整段消失
        self.assertIn("natal", in_band[0]["relation_scope"]["computed_layers"])
        for seg in out_band:
            self.assertIn("luck", seg["relation_scope"]["computed_layers"])
        # 月级只声明每段都算过的层：有带内段缺大运，月级就不能声称大运已算
        self.assertNotIn("luck", month["relation_scope"]["computed_layers"])
        self.assertIn("luck", month["relation_scope"]["omitted_layers"])

    def test_ac03k_zishi_estimate_covers_both_candidates(self):
        """ac3 的前置：子时的代表时刻与容差必须同时覆盖早子与晚子。

        早先想用上游日柱区分早/晚子，但上游在「只知子时」时本身就按早子取日柱，
        拿它反推是循环论证。现在改为取两者中点 + ±12 小时。
        """
        zi = {"profile": {"solar_date": "1990-05-15", "time": {"precision": "branch", "branch": "子"}}}
        estimate = _birth_datetime(zi)
        tolerance = _birth_time_tolerance(zi)
        self.assertIsNotNone(estimate)
        self.assertEqual(tolerance, timedelta(hours=12))
        for hour, minute, label in ((0, 30, "早子"), (23, 30, "晚子")):
            candidate = estimate.replace(hour=hour, minute=minute)
            self.assertLessEqual(
                abs(candidate - estimate), tolerance,
                f"{label}候选 {candidate.time()} 落在不确定带之外",
            )
        # 带子是连续的，覆盖 D 00:00 到 D+1 00:00 整整一天
        self.assertEqual(estimate - tolerance, estimate.replace(hour=0, minute=0))
        self.assertEqual(estimate + tolerance, estimate.replace(hour=12, minute=0) + timedelta(hours=12))

    def test_ac03l_unknown_precision_never_binds_luck(self):
        """ac3 的前置：time.precision 未知时，十二个月都不许绑大运，并给出精确原因。"""
        blank = copy.deepcopy(self.normalized)
        blank["profile"]["time"] = {"precision": "unknown"}

        facts = build_monthly_facts(self.calculation, 2026, blank)
        self.assertEqual(facts["layers"]["luck"]["status"], "unavailable")
        self.assertEqual(facts["relation_audit"]["status"], "partial")
        self.assertEqual(facts["relation_audit"]["luck_coverage"]["months_with_luck"], [])
        for month in facts["months"]:
            self.assertEqual(month["luck"]["status"], "indeterminate")
            self.assertIn("精度未知", month["luck"]["reason"])
            self.assertIn("luck", month["relation_scope"]["omitted_layers"])
            self.assertNotIn("luck", month["relation_scope"]["computed_layers"])
            # 关系仍要算：只是不含大运层。
            # relation_count 保持"等于数组条数"；强弱区分靠 confirmed/candidate 两个字段。
            self.assertEqual(month["relation_count"], len(month["relations"]))
            self.assertEqual(
                month["confirmed_count"] + month["candidate_count"],
                month["relation_count"],
            )

    def test_ac03h2_twelve_hour_tolerance_three_tiers(self):
        """12 小时容差的三个档位：恰好等于、略小于、略大于月界距离。

        恰好等于（等于容差）→ 落入不确定带，必须判 indeterminate；
        略小于（11h59m）  → 仍在带内；
        略大于（12h01m）  → 带外，可以判 split 且切点精确。
        """
        for offset, expected in (
            (timedelta(hours=12), "indeterminate"),
            (timedelta(hours=12) - timedelta(minutes=1), "indeterminate"),
            (timedelta(hours=12) + timedelta(minutes=1), "split"),
        ):
            with self.subTest(offset=str(offset)):
                calculation = copy.deepcopy(self.calculation)
                luck = calculation.setdefault("luck_cycles", {})
                start = dict(luck.get("start") or {})
                start["precision"] = "days"
                luck["start"] = start

                baseline = bazi_months.build_monthly_facts(calculation, 2026, self.normalized)
                anchor_month = baseline["months"][3]
                edge = datetime.fromisoformat(anchor_month["start"]) + offset

                with mock.patch.object(bazi_months, "_dayun_boundaries", return_value=[edge]):
                    patched = bazi_months.build_monthly_facts(
                        calculation, 2026, self.normalized
                    )

                month = patched["months"][3]
                self.assertEqual(
                    month["luck"]["status"], expected,
                    f"距月界 {offset} 的换运点应判 {expected}",
                )
                if expected == "indeterminate":
                    self.assertIn("起运年龄只精确到天", month["luck"]["reason"])

    def test_ac03h_minute_precision_with_day_qiyun_is_approximate(self):
        """分钟级出生只消除**出生时间**的容差，不消除**起运精度**的容差。

        `precision=days` 表示起运年龄只精确到天，天内准确交运时刻未知，
        因此切点附近的归属仍是近似的（±12 小时）。plan-qiyun.json 裁定采用此口径。
        """
        calculation = copy.deepcopy(self.calculation)
        luck = calculation.setdefault("luck_cycles", {})
        start = dict(luck.get("start") or {})
        start["precision"] = "days"
        start["days"] = 120
        luck["start"] = start

        found = False
        for year in (2026, 2027):
            for month in build_monthly_facts(calculation, year, self.normalized)["months"]:
                if month["luck"]["status"] != "split":
                    continue
                found = True
                self.assertEqual(month["luck"]["boundary_precision"], "birth-time-approximate")
                self.assertEqual(month["luck"]["boundary_uncertainty_seconds"], 12 * 3600)

                # 不确定窗口宽度必须恰好是 2×容差（左右各 12 小时）
                windows = month["luck"].get("ambiguous_windows") or []
                self.assertTrue(windows, "split 月份必须给出不确定窗口")
                for window in windows:
                    lo = datetime.fromisoformat(window[0])
                    hi = datetime.fromisoformat(window[1])
                    self.assertEqual(
                        hi - lo, timedelta(hours=24),
                        "窗口宽度应为 2×12 小时",
                    )
                    # 窗口必须**以切点为中心**：前后各 12 小时，
                    # 只查宽度 24h 会让「前 6h / 后 18h」这种偏移窗口混过去
                    boundary = datetime.fromisoformat(month["luck"]["boundaries"][0])
                    self.assertEqual(
                        boundary - lo, timedelta(hours=12),
                        "窗口起点应在切点前 12 小时",
                    )
                    self.assertEqual(
                        hi - boundary, timedelta(hours=12),
                        "窗口终点应在切点后 12 小时",
                    )

                # 带内分段不得绑定大运
                for segment in month.get("relation_segments") or []:
                    if not segment.get("uncertain_band"):
                        continue
                    self.assertEqual(
                        segment["luck"]["status"], "indeterminate",
                        "不确定带内的段不该给出确定大运",
                    )
                    self.assertIn(
                        "luck", segment["relation_scope"]["omitted_layers"],
                        "不确定带内的段必须声明省略大运层",
                    )
        self.assertTrue(found, "分钟精度下没找到 split 月份，用例无区分力")


def _fmt(value: datetime) -> str:
    """与产品同一套取整规则（秒级四舍五入），否则测试会在 ±1 秒上抖动。"""
    return bazi_months._fmt_instant(value)


if __name__ == "__main__":
    unittest.main()
