"""全范围不变式：对引擎声明支持的**每一个**年份都跑一遍。

`.pair/plan.json` 的第 1 条验收标准写的是「对每个受支持目标年份」，
原先只抽了 6 个年份做代表。抽样能发现明显错位，但漏掉整段区间（比如某个年代
太阳黄经插值退化、或节气跨年处理出错）时依然会显示全绿。这里把 1900–2099 全扫。

纯本地计算，不依赖 Codex，也不烧额度。
"""

from __future__ import annotations

import copy
import re
import unittest
from datetime import date, datetime, timedelta

from scripts import pai_pan as engine
from mingli_tool.bazi_months import (
    MAX_TARGET_YEAR,
    MIN_TARGET_YEAR,
    _validation,
    build_monthly_facts,
)

# 扫描范围**写死**，不从被测模块的常量推出来：
# 否则实现把范围缩成 1901–2098，测试会跟着缩，等于自己给自己放水。
SUPPORTED_YEARS = range(1900, 2100)

# 12 个节气的公历落点范围（视黄经定气，误差远小于这个窗口）
JIE_MONTH_WINDOW = {
    "立春": (2, 3, 2, 5),
    "惊蛰": (3, 4, 3, 7),
    "清明": (4, 4, 4, 6),
    "立夏": (5, 4, 5, 7),
    "芒种": (6, 4, 6, 7),
    "小暑": (7, 6, 7, 9),
    "立秋": (8, 6, 8, 9),
    "白露": (9, 6, 9, 9),
    "寒露": (10, 7, 10, 9),
    "立冬": (11, 6, 11, 8),
    "大雪": (12, 6, 12, 8),
    "小寒": (1, 4, 1, 7),
}


def resolve_pointer(document, pointer):
    """RFC 6901 严格解析：不认负下标，不把 "/" 当根，转义只认 ~0/~1。

    和 test_acceptance_backend 里的同名函数保持同一套严格性——
    两处各写一份就得同步收紧，否则全范围扫描用的还是宽松版本。
    """
    if pointer == "":
        return document
    if not pointer.startswith("/"):
        raise ValueError(f"{pointer!r} 不是合法 JSON Pointer")
    current = document
    for raw in pointer[1:].split("/"):
        if re.search(r"~(?![01])", raw) or raw.endswith("~"):
            raise ValueError(f"{pointer} 含非法转义 {raw!r}")
        token = raw.replace("~1", "/").replace("~0", "~")
        if isinstance(current, list):
            if not re.fullmatch(r"0|[1-9][0-9]*", token):
                raise KeyError(f"{pointer} 的数组下标 {token!r} 不合法")
            current = current[int(token)]
        else:
            current = current[token]
    return current


def iter_evidence_objects(node, path="$"):
    """递归找出所有带 evidence_id 的对象（不写死月/关系两类）。"""
    if isinstance(node, dict):
        if "evidence_id" in node:
            yield node, path
        for key, value in node.items():
            yield from iter_evidence_objects(value, f"{path}.{key}")
    elif isinstance(node, list):
        for index, item in enumerate(node):
            yield from iter_evidence_objects(item, f"{path}[{index}]")


class FullRangeMonthlyFactsTest(unittest.TestCase):
    def test_ac01_every_supported_year_has_twelve_ordered_months(self):
        """ac1：1900–2099 每一年都必须给出 12 个月，索引恰为 1..12 各一次。"""
        for year in SUPPORTED_YEARS:
            with self.subTest(year=year):
                facts = build_monthly_facts(None, year)
                self.assertEqual(facts["status"], "ok", facts.get("reason"))
                months = facts["months"]
                self.assertEqual(len(months), 12)
                self.assertEqual([m["index"] for m in months], list(range(1, 13)))

    def test_ac02_every_supported_year_is_contiguous_and_self_consistent(self):
        """ac2：全范围内相邻月首尾相接、start < end、校验全部通过。"""
        for year in SUPPORTED_YEARS:
            with self.subTest(year=year):
                facts = build_monthly_facts(None, year)
                months = facts["months"]
                for i in range(len(months) - 1):
                    self.assertEqual(
                        months[i]["end"], months[i + 1]["start"],
                        f"{year} 第 {i + 1}/{i + 2} 月之间不连续",
                    )
                for month in months:
                    self.assertLess(month["start"], month["end"])
                    self.assertGreater(month["duration_days"], 0)
                    self.assertEqual(month["start_utc_offset"], "+08:00")
                    self.assertEqual(month["boundary_source"], "solar_term_apparent_longitude")
                self.assertEqual(facts["validation"]["status"], "pass")
                self.assertTrue(all(c["pass"] for c in facts["validation"]["checks"]))

    def test_ac02b_every_jie_lands_in_its_calendar_window(self):
        """ac2（续）：节气落点必须落在公历合理窗口内；丑月起于**次年**小寒。"""
        for year in SUPPORTED_YEARS:
            with self.subTest(year=year):
                months = build_monthly_facts(None, year)["months"]
                for month in months:
                    jie = month["jie"]
                    self.assertIn(jie, JIE_MONTH_WINDOW, f"未知节气 {jie}")
                    low_m, low_d, high_m, high_d = JIE_MONTH_WINDOW[jie]
                    moment = datetime.fromisoformat(month["start"])
                    # 丑月的起始节气（小寒）本来就落在 Y+1：流月年按立春起算，
                    # 第 12 个月横跨公历年，这是设计而非错位。
                    expected_year = year if jie != "小寒" else year + 1
                    self.assertEqual(
                        moment.year, expected_year,
                        f"{year} 的 {jie} 应落在 {expected_year} 年，实际 {moment.year}",
                    )
                    self.assertEqual(moment.month, low_m, f"{year} {jie} 月份异常")
                    self.assertTrue(
                        low_d <= moment.day <= high_d,
                        f"{year} {jie} 落在 {moment.date()}，超出预期窗口 {low_d}-{high_d} 日",
                    )

    def test_ac07b_every_supported_year_uses_its_own_annual_pillar(self):
        """ac7（续）：全范围内包内年柱都取自目标年份，且寅月天干按该年年干五虎遁。"""
        previous = None
        for year in SUPPORTED_YEARS:
            with self.subTest(year=year):
                facts = build_monthly_facts(None, year)
                self.assertEqual(facts["annual"]["year"], year)
                self.assertEqual(facts["annual"]["ganzhi"], engine.liunian_gz(year))
                annual_gan_index = engine.GAN.index(facts["annual"]["gan"])
                yin_stem = engine.YUE_GAN_YIN[annual_gan_index]
                for position, month in enumerate(facts["months"]):
                    self.assertEqual(month["gan"], engine.GAN[(yin_stem + position) % 10])
                if previous is not None:
                    self.assertNotEqual(
                        facts["annual"]["ganzhi"], previous["annual"]["ganzhi"],
                        "相邻年份年柱不应相同",
                    )
                previous = facts

    def test_ac06b_every_supported_year_has_resolvable_pointers(self):
        """ac6（续）：全范围内上下半年各 6 个月，且每个 JSON Pointer 都能解到值。"""
        for year in SUPPORTED_YEARS:
            with self.subTest(year=year):
                facts = build_monthly_facts(None, year)
                self.assertEqual(facts["half_years"]["first_half"]["months"], [1, 2, 3, 4, 5, 6])
                self.assertEqual(facts["half_years"]["second_half"]["months"], [7, 8, 9, 10, 11, 12])
                for month in facts["months"]:
                    value = resolve_pointer(facts, month["json_pointer"])
                    self.assertEqual(value["index"], month["index"])
                    self.assertIsNotNone(value["ganzhi"])

    def test_instants_match_engine_to_the_microsecond(self):
        """边界必须**原样**等于引擎给出的节气时刻（微秒级），不能再取整。

        早期版本按秒四舍五入发布，导致「引擎 10:00:00.400、发布 10:00:00」这类偏差：
        0.4 秒内的输入按发布区间会归入新月，而引擎判旧月。
        """
        for year in (1900, 1950, 2000, 2026, 2050, 2099):
            with self.subTest(year=year):
                facts = build_monthly_facts(None, year)
                self.assertEqual(
                    facts["coordinate"]["instant_resolution"], "1us",
                    "发布精度声明必须与实际一致",
                )
                from mingli_tool.bazi_months import _parse_instant

                for month in facts["months"]:
                    self.assertIsNotNone(_parse_instant(month["start"]))
                    self.assertIsNotNone(_parse_instant(month["end"]))
                    # 与该月起始节气的引擎时刻必须完全相等（微秒级）
                    # 第 12 个月（丑月）的起始节气「小寒」落在次年
                    owner = year + 1 if month["jie"] == "小寒" else year
                    expected = engine.solar_term_beijing(owner, month["jie_longitude"])
                    self.assertEqual(
                        _parse_instant(month["start"]), expected,
                        f"{year}/{month['jie']} 起点与引擎时刻不一致",
                    )
    def test_add_months_never_loops_on_year_overflow(self):
        """年份越界时必须立刻报错，不能靠递减日重试（那会死循环）。"""
        from mingli_tool.bazi_months import _add_months

        with self.assertRaises(ValueError):
            _add_months(datetime(9999, 1, 1), 12)
        # 正常范围内仍要按月推移并在月末夹取
        self.assertEqual(_add_months(datetime(2026, 1, 31), 1).date(), date(2026, 2, 28))
        self.assertEqual(_add_months(datetime(2024, 1, 31), 1).date(), date(2024, 2, 29))

    def test_supported_range_matches_the_documented_bounds(self):
        """扫描范围是写死的 1900–2099；模块常量必须与它一致，不能被悄悄改窄。"""
        self.assertEqual(MIN_TARGET_YEAR, 1900)
        self.assertEqual(MAX_TARGET_YEAR, 2099)
        self.assertEqual(len(list(SUPPORTED_YEARS)), 200)

    def test_every_evidence_object_has_a_self_pointer_for_every_year(self):
        """1900–2099 全范围：每个带 evidence_id 的对象都要有指回自己的 json_pointer。

        只在若干抽样年份上验，其余年份少一个指针不会被发现。
        """
        for year in SUPPORTED_YEARS:
            with self.subTest(year=year):
                facts = build_monthly_facts(None, year)
                objects = list(iter_evidence_objects(facts))
                self.assertGreaterEqual(len(objects), 12, f"{year} 证据对象过少")
                for evidence, path in objects:
                    pointer = evidence.get("json_pointer")
                    self.assertTrue(
                        pointer, f"{year} 的 {path}（{evidence['evidence_id']}）缺 json_pointer"
                    )
                    self.assertIs(
                        resolve_pointer(facts, pointer), evidence,
                        f"{year} 的 {pointer} 没有指向 {evidence['evidence_id']} 本身",
                    )

    def test_boundary_sides_switch_pillar_for_every_year(self):
        """1900–2099 全范围：每个节气边界两侧必须换柱，且与包内干支一致。

        只抽查几个年份的话，某年边界算偏一天、干支没错也只是巧合，抓不出来。
        """
        from scripts import pai_pan as engine

        for year in SUPPORTED_YEARS:
            with self.subTest(year=year):
                facts = build_monthly_facts(None, year)
                # 2099 的下一月边界已超出支持范围，跨年那一段单独跳过
                next_facts = (
                    build_monthly_facts(None, year + 1)
                    if year < MAX_TARGET_YEAR
                    else None
                )
                annual_index = engine.GAN.index(facts["annual"]["gan"])
                next_annual_index = (
                    engine.GAN.index(next_facts["annual"]["gan"]) if next_facts else None
                )
                months = facts["months"]

                # 12 月末的边界就是下一年的立春：不能因为"没有下一个月"就跳过。
                # 注意立春之后已经换年，五虎遁要用**下一年**的年干。
                plan = []
                for index, month in enumerate(months, start=1):
                    if index < 12:
                        plan.append((month, months[index]["ganzhi"], annual_index))
                    elif next_facts is not None:
                        plan.append(
                            (month, next_facts["months"][0]["ganzhi"], next_annual_index)
                        )
                    # 2099 的 12 月末没有可比的下一包，跳过这一段
                for month, following_ganzhi, after_annual_index in plan:
                    boundary = datetime.fromisoformat(month["end"])
                    before = engine.resolve_month_pillar(
                        boundary - timedelta(seconds=1), annual_index
                    )
                    after = engine.resolve_month_pillar(
                        boundary + timedelta(seconds=1), after_annual_index
                    )
                    self.assertNotEqual(
                        (before[0] + before[1]), (after[0] + after[1]),
                        f"{year} 第 {month['index']} 月边界两侧同柱，边界位置可疑",
                    )
                    self.assertEqual(before[0] + before[1], month["ganzhi"])
                    self.assertEqual(after[0] + after[1], following_ganzhi)

                # 跨年也要首尾相接
                if next_facts is not None:
                    self.assertEqual(months[-1]["end"], next_facts["months"][0]["start"])

    def test_unsupported_years_are_explicit(self):
        """边界外必须显式 unsupported，不能悄悄给近似值。"""
        for year in (MIN_TARGET_YEAR - 1, MAX_TARGET_YEAR + 1):
            with self.subTest(year=year):
                facts = build_monthly_facts(None, year)
                self.assertEqual(facts["status"], "unsupported")
                self.assertEqual(facts["months"], [])
                self.assertTrue(facts["reason"])

    def test_non_integer_year_is_rejected_not_truncated(self):
        """年不是整数时必须显式拒绝：``int(2026.9)`` 截成 2026 会悄悄算错年份。"""
        for bad in (2026.9, "2026.9", None, True, float("inf"), [2026]):
            with self.subTest(year=bad):
                facts = build_monthly_facts(None, bad)
                self.assertEqual(facts["status"], "unsupported")
                self.assertEqual(facts["months"], [])
                self.assertIn("整数", facts["reason"])
                self.assertIsNone(facts["target_year"])

        for good in (2026, 2026.0, "2026"):
            with self.subTest(year=good):
                facts = build_monthly_facts(None, good)
                self.assertEqual(facts["status"], "ok")
                self.assertEqual(facts["target_year"], 2026)


class ScopeHonestyTest(unittest.TestCase):
    """作用域声明必须和实际算过的层一致，覆盖全部年份与四种出生精度。"""

    PRECISIONS = (
        {"precision": "minute", "value": "12:30"},
        {"precision": "branch", "branch": "午"},
        {"precision": "branch", "branch": "子"},
        {"precision": "unknown"},
    )

    def test_scope_matches_computed_layers_for_every_year_sample(self):
        from mingli_tool.bazi import calculate

        for time_block in self.PRECISIONS:
            payload = {
                "schema_version": "1.0",
                "profile": {
                    "display_name": None,
                    "calendar": "solar",
                    "date": "1990-05-15",
                    "is_leap_month": False,
                    "time": time_block,
                    "timezone": "Asia/Shanghai",
                    "sex_for_calculation": "male",
                    "birthplace": {"label": None, "longitude": None, "latitude": None},
                },
                "rules": {"profile_id": "engine-default-v1", "true_solar_time": False},
                "options": {"save_history": False, "annual_cycles_through": 2026},
            }
            result = calculate(payload)
            calculation = result["calculation"]
            normalized = result["normalized_input"]

            for year in range(1990, 2100, 10):
                with self.subTest(precision=time_block["precision"], year=year):
                    facts = build_monthly_facts(calculation, year, normalized)
                    for month in facts["months"]:
                        scope = month["relation_scope"]
                        computed = set(scope["computed_layers"])
                        omitted = set(scope["omitted_layers"])
                        self.assertFalse(
                            computed & omitted,
                            f"第 {month['index']} 月同时声称算了和没算：{computed & omitted}",
                        )
                        self.assertIn("natal", computed)
                        self.assertIn("annual", computed)
                        self.assertIn("monthly", computed)
                        if omitted:
                            self.assertTrue(scope["reason"], "有省略就必须给原因")
                        # 声明算了某层，关系里就必须真能找到该层
                        for relation in month["relations"]:
                            self.assertTrue(set(relation["layers"]) <= computed | omitted)
                        # 注意：**不能**要求"算了 luck 就至少有一条 luck 关系"——
                        # 该层干支未必与其他柱构成受支持的关系，没有任何关系也是正确结果。
                        # 反过来：只要**任何**一层（月级或某个分段）都没声称算过 luck，
                        # 就不许出现 luck 关系。注意不能只看月级 scope：
                        # 跨运月允许"不确定带省略、带外分段计算"，那是合法的。
                        luck_claimed = "luck" in computed or any(
                            "luck" in (segment.get("relation_scope") or {}).get("computed_layers", [])
                            for segment in month.get("relation_segments") or []
                        )
                        if not luck_claimed:
                            for relation in month["relations"]:
                                self.assertNotIn(
                                    "luck", relation["layers"],
                                    f"第 {month['index']} 月没算 luck，却输出了 luck 关系",
                                )
                                for binding in relation["bindings"]:
                                    self.assertNotEqual(
                                        binding["participant"], "dayun",                                        f"第 {month['index']} 月没算 luck，却绑定了大运",
                                    )
                            for segment in month.get("relation_segments") or []:
                                for relation in segment.get("relations") or []:
                                    self.assertNotIn(
                                        "luck", relation["layers"],
                                        f"第 {month['index']} 月的分段仍带 luck 关系",
                                    )

                        # 分段级别单独再查一遍：某段自己声明没算 luck，
                        # 就不许在**该段**里出现 luck 关系（哪怕别的段算了）
                        segments = month.get("relation_segments") or []
                        for segment in segments:
                            seg_scope = segment.get("relation_scope")
                            # 每个分段都必须声明自己的作用域：缺了就无从判断它算没算 luck，
                            # 跳过不查等于给"漏声明"开后门
                            self.assertIsInstance(
                                seg_scope, dict,
                                f"第 {month['index']} 月第 {segment.get('segment')} 段缺 relation_scope",
                            )
                            self.assertIn("computed_layers", seg_scope)
                            seg_computed = set(seg_scope.get("computed_layers") or [])
                            if "luck" in seg_computed:
                                continue
                            for relation in segment.get("relations") or []:
                                self.assertNotIn(
                                    "luck", relation["layers"],
                                    f"第 {month['index']} 月第 {segment.get('segment')} 段"
                                    "声明没算 luck，却输出了 luck 关系",
                                )
                                for binding in relation["bindings"]:
                                    self.assertNotEqual(
                                        binding["participant"], "dayun",
                                        f"第 {month['index']} 月第 {segment.get('segment')} 段"
                                        "声明没算 luck，却绑定了大运",
                                    )

                        # 月级关系若指向某一段，该段必须真的算过 luck；
                        # 「另一段算了」不能成为这条错配的挡箭牌
                        for relation in month["relations"]:
                            index_in_segments = relation.get("segment")
                            if index_in_segments is None:
                                # 不带 segment 的月级关系属于"整月"，月级 scope 就必须算过 luck
                                if "luck" in relation["layers"]:
                                    self.assertIn(
                                        "luck", computed,
                                        f"第 {month['index']} 月的月级 luck 关系，"
                                        "却没有在月级 scope 里声明算过 luck",
                                    )
                                continue
                            # segment 必须是 1..N 的正整数：0 会被 truthiness 跳过、
                            # 负数会被 Python 反向索引选错段、True 会被当成 1
                            self.assertFalse(
                                isinstance(index_in_segments, bool),
                                f"第 {month['index']} 月的 segment 是布尔值",
                            )
                            self.assertIsInstance(index_in_segments, int)
                            self.assertGreaterEqual(
                                index_in_segments, 1,
                                f"第 {month['index']} 月的 segment={index_in_segments} 不是正整数",
                            )
                            self.assertLessEqual(
                                index_in_segments, len(segments),
                                f"第 {month['index']} 月的关系指向不存在的分段 {index_in_segments}",
                            )
                            if "luck" not in relation["layers"]:
                                continue
                            target = segments[index_in_segments - 1]
                            target_scope = target.get("relation_scope") or {}
                            self.assertIn(
                                "luck", set(target_scope.get("computed_layers") or []),
                                f"第 {month['index']} 月的月级关系把大运绑到了"
                                f"第 {index_in_segments} 段，但那段没算 luck",
                            )


class SelfValidationTest(unittest.TestCase):
    """包内 validation.checks 必须真的能抓到矛盾，而不是永远绿。"""

    @classmethod
    def setUpClass(cls):
        from mingli_tool.bazi import calculate

        payload = {
            "schema_version": "1.0",
            "profile": {
                "display_name": None,
                "calendar": "solar",
                "date": "1990-05-15",
                "is_leap_month": False,
                "time": {"precision": "minute", "value": "12:30"},
                "timezone": "Asia/Shanghai",
                "sex_for_calculation": "male",
                "birthplace": {"label": None, "longitude": None, "latitude": None},
            },
            "rules": {"profile_id": "engine-default-v1", "true_solar_time": False},
            "options": {"save_history": False, "annual_cycles_through": 2026},
        }
        result = calculate(payload)
        cls.calculation = result["calculation"]
        cls.normalized = result["normalized_input"]

    def fresh(self):
        import copy as _copy

        return build_monthly_facts(
            _copy.deepcopy(self.calculation), 2026, self.normalized
        )

    def checks_of(self, facts):
        broken = _validation(facts["months"], 2026)
        return broken, {c["id"]: c["pass"] for c in broken["checks"]}

    def test_clean_package_passes_every_check(self):
        facts = self.fresh()
        self.assertEqual(facts["validation"]["status"], "pass")
        for check in facts["validation"]["checks"]:
            self.assertTrue(check["pass"], check)

    def test_scope_checks_catch_contradictions(self):
        # 1) 同一层既算过又声明没算
        facts = self.fresh()
        scope = dict(facts["months"][0]["relation_scope"])
        scope["omitted_layers"] = list(scope["omitted_layers"]) + ["luck"]
        facts["months"][0]["relation_scope"] = scope
        broken, checks = self.checks_of(facts)
        self.assertEqual(broken["status"], "fail")
        self.assertFalse(checks["months.relation_scope_disjoint"])

        # 2) 声明了没算的层却不给原因
        facts = self.fresh()
        facts["months"][3]["relation_scope"] = {
            **facts["months"][3]["relation_scope"],
            "omitted_layers": ["luck"],
            "reason": None,
        }
        broken, checks = self.checks_of(facts)
        self.assertFalse(checks["months.relation_scope_reason"])

        # 3) 声明切成 3 段但只有 1 段明细
        facts = self.fresh()
        month = facts["months"][5]
        month["relation_segments"] = [{"segment": 1, "relations": []}]
        month["relation_scope"] = {**month["relation_scope"], "segments": 3}
        broken, checks = self.checks_of(facts)
        self.assertFalse(checks["months.relation_segments"])

        # 3b) 声明 3 段但分段数组被整个删掉——不能因为"没有数组"就跳过这个月份
        facts = self.fresh()
        month = facts["months"][5]
        month.pop("relation_segments", None)
        month["relation_scope"] = {**month["relation_scope"], "segments": 3}
        broken, checks = self.checks_of(facts)
        self.assertFalse(
            checks["months.relation_segments"],
            "声明了 3 段却没有分段明细，必须判失败",
        )

        # 3c) 反过来：没声明分段却塞了分段数组，也算不一致
        facts = self.fresh()
        month = facts["months"][6]
        month["relation_segments"] = [{"segment": 1, "relations": []}]
        month["relation_scope"] = {**month["relation_scope"], "segments": 0}
        broken, checks = self.checks_of(facts)
        self.assertFalse(checks["months.relation_segments"])

        # 4) 缺 relation_scope
        facts = self.fresh()
        facts["months"][7].pop("relation_scope", None)
        broken, checks = self.checks_of(facts)
        self.assertFalse(checks["months.relation_scope_present"])

    def test_scope_checks_are_skipped_when_no_audit_ran(self):
        """不传 calculation 时不做关系审计，这类检查不该凭空判失败。"""
        facts = build_monthly_facts(None, 2026)
        self.assertEqual(facts["validation"]["status"], "pass")
        ids = {c["id"] for c in facts["validation"]["checks"]}
        self.assertNotIn("months.relation_scope_present", ids)


class OutOfScopeGuardTest(unittest.TestCase):
    """守住计划的 out_of_scope：AI 不得参与计算，也不得往事实包里塞解读/评级。"""

    # 这些键一旦出现在事实包里，就说明有人把 AI 解读或吉凶评级混进了确定性层
    FORBIDDEN_KEYS = frozenset(
        {
            "interpretation",
            "advice",
            "prediction",
            "rating",
            "score",
            "auspicious",
            "inauspicious",
            "ai_summary",
            "narrative",
            "oneLineSummary",
        }
    )

    def _walk_keys(self, node, path="$", key=None):
        """递归产出 (path, key, value)。列表里的字符串元素也会产出，key 沿用父键名。"""
        if isinstance(node, dict):
            for child_key, value in node.items():
                yield path, child_key, value
                yield from self._walk_keys(value, f"{path}.{child_key}", child_key)
        elif isinstance(node, list):
            for index, item in enumerate(node):
                if isinstance(item, str):
                    yield f"{path}[{index}]", key or "", item
                else:
                    yield from self._walk_keys(item, f"{path}[{index}]", key)

    def test_facts_package_contains_no_ai_or_rating_fields(self):
        from mingli_tool.bazi import calculate

        payload = {
            "schema_version": "1.0",
            "profile": {
                "display_name": None,
                "calendar": "solar",
                "date": "1990-05-15",
                "is_leap_month": False,
                "time": {"precision": "minute", "value": "12:30"},
                "timezone": "Asia/Shanghai",
                "sex_for_calculation": "male",
                "birthplace": {"label": None, "longitude": None, "latitude": None},
            },
            "rules": {"profile_id": "engine-default-v1", "true_solar_time": False},
            "options": {"save_history": False, "annual_cycles_through": 2026},
        }
        facts = calculate(payload)["monthly_facts"]
        offenders = [
            f"{path}.{key}"
            for path, key, _value in self._walk_keys(facts)
            if key in self.FORBIDDEN_KEYS
        ]
        self.assertEqual(offenders, [], f"事实包里出现了 AI/评级字段：{offenders}")

    # ---------------------------------------------------------------- 闭集词表
    # 事实包里允许出现的**长中文**文本（>6 个汉字）必须是这 36 条之一。
    # 动态成分先做归一化：ISO 时刻 → <ISO>，柱名 → <P>。
    # 这是闭集而不是关键词黑名单：黑名单永远追不上新措辞，闭集只问
    # 「这句是不是我登记过的那句」，于是任何解读文字都混不进来。
    ALLOWED_SENTENCES = {
        "上游关系表未实现这些类型，本层不做推断，也不假装已覆盖。",
        "已覆盖全部已登记的关系类型，没有未实现项。",
        "藏干五合枚举候选，不等于严格暗合或合化成立",
        "上游若给出 time.precision（minute/branch），即可确定归属。",
        "出生时刻窗口跨过节气，大运层整体不可信；原局年柱/月柱也可能因跨节而不同",
        "出生时刻窗口跨过节气，起运所用的节气会切换，年中大运无法确定",
        "出生时刻窗口跨过节气，起运所用的节气会切换，本月大运归属无法确定",
        "出生时刻精度未知，大运层无法归属到本月",
        "出生时刻精度未知，无法判断换运点落在本月的哪一侧",
        "出生窗口跨过 <ISO>，原局年柱/月柱可能不同",
        "实际 12 个",
        "早子 D 00:30 附近",
        "晚子 D 23:30 附近",
        # 藏支计数随四柱+大运+流年+流月的藏干总数变化：
        # 给流运柱补上 hidden_stems 后，参与统计的柱更多，计数上限也跟着抬高。
        # 精度声明：早期是 "1s"，改成微秒级发布后是 "1us"
        "1us",
        "化神五行藏支 1 处",
        "化神五行藏支 2 处",
        "化神五行藏支 3 处",
        "化神五行藏支 4 处",
        "化神五行藏支 5 处",
        "化神五行藏支 6 处",
        "化神五行藏支 7 处",
        "化神五行藏支 8 处",
        "化神五行藏支 9 处",
        "化神五行藏支 10 处",
        "化神五行藏支 11 处",
        "化神五行藏支 12 处",
        "化神五行透干 1 处",
        "化神五行透干 2 处",
        "化神五行透干 3 处",
        "原局四柱不全，缺少 <P>；大运层不可用，本次只审计原局/流年/流月",
        "只知子时，无法确定早子还是晚子；上游日柱亦按早子取得，不能反过来作为证据。两种可能相差约 23 小时。",
        "只知子时，早子与晚子的日柱差一天，时柱也随之不同",
        "同一层不能既算过又声明没算",
        "四柱不全时必须在 scope 里说明",
        "声明了没算的层就必须说明原因",
        "声明切成 N 段就必须真有 N 段明细；没声明分段就不该有分段数组",
        "复用上游成化条件审计（月令/透干/藏支）；即使条件较齐也不改写原局五行。",
        "大运层不可用，本次只审计原局/流年/流月",
        "大运按每月中点分别定位；跨运年的月份可能分属不同大运，若换运点落在某月区间内，该月标 crosses_boundary 且不绑定单一大运。",
        "干支拼接必须与分字段一致",
        "引擎给出带微秒的节气时刻，事实包按秒级四舍五入发布；相邻月共用同一字符串，故无缝隙无重叠，边界位置误差 ≤0.5 秒。",
        "月令本气支持化神五行",
        "每个月都必须带 computed_layers",
        "每月起点必须早于终点",
        "相邻月首尾必须相接且不重叠",
        "索引应为 1..12 各一次",
        "组合所需干支在参与柱中齐备",
        "缺少出生公历日期，无法换算运限",
        "逐月 scope 必须显式标注原局四柱是否完整",
        "首月起点应为当年立春，末月终点应为次年立春",
    }

    # 纯 ASCII 值的封闭文法（不是关键词黑名单：没命中任何一条就报错）
    ASCII_SHAPES = (
        # 纯原局关系块：/natal_relations/<序号>
        re.compile(r"^/natal_relations/\d{1,3}$"),
        # 关系摘要：8 位十六进制（FNV-1a 低 32 位）
        re.compile(r"^[0-9a-f]{8}$"),
        # 精度声明值本身也是 ASCII 串，需要显式承认
        re.compile(r"^1us$"),
        re.compile(r"^1s$"),
        re.compile(r"^/months/\d{1,2}(/relation_segments/\d{1,2}/relations/\d{1,2}|/relations/\d{1,2})?$"),
                re.compile(r"^monthly\.months\[\d{1,2}\]$"),
        re.compile(r"^monthly\.months\[\d{1,2}\]\.relation\.(stem-combine|stem-clash|stem-three-combine|branch-six-combine|branch-six-clash|branch-harm|branch-break|branch-punishment|branch-three-harmony|branch-three-meeting|branch-half-harmony|branch-arch-harmony|branch-half-meeting|branch-arch-meeting|branch-hidden-combine|branch-hidden-stem-combine-candidate)(\.(year|month|day|hour|liunian|liuyue|dayun))+$"),
        re.compile(r"^natal\.relation\.(stem-combine|stem-clash|stem-three-combine|branch-six-combine|branch-six-clash|branch-harm|branch-break|branch-punishment|branch-three-harmony|branch-three-meeting|branch-half-harmony|branch-arch-harmony|branch-half-meeting|branch-arch-meeting|branch-hidden-combine|branch-hidden-stem-combine-candidate)(\.(year|month|day|hour|liunian|liuyue|dayun))+$"),
        re.compile(r"^mf-[0-9a-f]{8}$"),
        re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?\+08:00$"),
        re.compile(r"^(stem|branch)-(combine|clash|harm|break|punishment|half-harmony|arch-harmony|half-meeting|arch-meeting|hidden-combine|hidden-stem-combine-candidate|six-clash|six-combine|three-harmony|three-meeting|three-combine)$"),
        re.compile(r"^(natal|luck|annual|monthly|year|month|day|hour|liunian|liuyue|dayun|bazi|months|"
            r"stem|branch|mid-year|self|three-branch|mutual)$"),
        re.compile(
            r"^(ok|partial|unavailable|indeterminate|before_start|split|unknown|"
            r"pass|fail|full|exact|birth-time-approximate|blocked-candidate|supported-candidate|"
            r"pending-candidate|days|months|fine)$"
        ),
        re.compile(
            r"^months\.(boundary_year|contiguous|count|ganzhi|index|natal_complete|"
            r"natal_completeness_consistent|order|relation_scope_disjoint|"
            r"relation_scope_present|relation_scope_reason|relation_segments)$"
        ),
        re.compile(r"^(engine-default-v1|combination-condition-audit-v1|solar-term[a-z_\- ()\/]*)$"),
        re.compile(r"^(pai_pan\.[a-z_]+(\([a-z_]+\))?|solar_term_[a-z_]+)$"),
        re.compile(r"^(half_open\[start,end\)|exact_lichun|twelve_jie|1s|UTC\+08:00|\+08:00)$"),
        re.compile(r"^[+-]?\d+(\.\d+)?$"),
        re.compile(
            r"^(annual|bazi|branch|day|dayun|exact_lichun|full|hour|indeterminate|"
            r"liunian|liuyue|luck|month|monthly|months|mutual|natal|ok|partial|pass|"
            r"self|solar_term_apparent_longitude|stem|twelve_jie|unavailable|year|"
            r"unknown|before_start|split|exact|fine|days)$"
        ),
    )

    # 短中文值（<=6 个汉字）同样必须是经典术语表里的词，不能随便几个字就算数
    SHORT_TERMS = frozenset(
        set("甲乙丙丁戊己庚辛壬癸")
        | set("子丑寅卯辰巳午未申酉戌亥")
        | set("金木水火土阴阳")
        | {
            "立春", "惊蛰", "清明", "立夏", "芒种", "小暑",
            "立秋", "白露", "寒露", "立冬", "大雪", "小寒",
            "正月", "二月", "三月", "四月", "五月", "六月",
            "七月", "八月", "九月", "十月", "冬月", "腊月",
            "比肩", "劫财", "食神", "伤官", "偏财", "正财",
            "偏官", "正官", "偏印", "正印",
            "长生", "沐浴", "冠带", "临官", "帝旺", "衰",
            "病", "死", "墓", "绝", "胎", "养",
            "中气", "本气", "余气", "组合结构完整",
        }
    )

    ISO_PATTERN = re.compile(r"\d{4}-\d{2}-\d{2}T[0-9:.+\-]+")
    PILLAR_PATTERN = re.compile(r"\b(year|month|day|hour)\b")

    @classmethod
    def _normalise(cls, text: str) -> str:
        return cls.PILLAR_PATTERN.sub("<P>", cls.ISO_PATTERN.sub("<ISO>", text))

    # 数值字段同样是闭集：想塞个「运势分 100」进来，键名不在表里就报错
    FORBIDDEN_KEYS = frozenset(
        {
            "interpretation", "advice", "prediction", "rating", "score",
            "auspicious", "inauspicious", "ai_summary", "narrative",
            "oneLineSummary",
        }
    )

    @classmethod
    def _forbidden_keys(cls, facts: dict) -> list:
        """包里任何层级出现禁用键都算违规。"""
        offenders = []

        def walk(node, path="$"):
            if isinstance(node, dict):
                for key, value in node.items():
                    if key in cls.FORBIDDEN_KEYS:
                        offenders.append(f"{path}.{key}")
                    walk(value, f"{path}.{key}")
            elif isinstance(node, list):
                for index, item in enumerate(node):
                    walk(item, f"{path}[{index}]")

        walk(facts)
        return offenders

    NUMERIC_KEYS = frozenset(
        {
            "delta_hours", "duration_days", "hidden_support_count", "index",
            "jie_longitude", "nominal_weight", "qiyun_sensitivity_days",
            "relation_count", "confirmed_count", "candidate_count", "segments", "target_year",
            "tolerance_seconds",
            "visible_support_count", "year", "boundary_uncertainty_seconds",
            "birth_time_tolerance_seconds", "qiyun_sensitivity_seconds",
            "sequence", "latitude", "longitude", "months", "months_with_luck",
            "months_without_luck", "crossed_months", "evidence_ids",
        }
    )
    # 布尔字段同样闭集：想加个「吉凶评级: true」进来，键不在表里就报错
    BOOL_KEYS = frozenset(
        {
            "addressable", "complete", "natal_complete", "pass",
            "resolved_per_month", "season_support", "structure_intact",
            "uncertain", "natal_uncertain", "validated", "available",
        }
    )

    # 键名里出现这些词就说明有人想加"打分/评级"这类东西
    RATING_KEY_WORDS = (
        "score", "rating", "rank", "grade", "level", "fortune", "luck_score",
        # 中文同义：吉凶、评级、打分、旺衰…
        "吉凶", "评级", "打分", "评分", "旺衰", "运势",
    )

    @classmethod
    def _unregistered_numeric_keys(cls, facts: dict) -> list:
        """返回所有「不该出现」的数值键。"""
        offenders = []

        def walk(node, path="$", key=None):
            if isinstance(node, dict):
                for child_key, value in node.items():
                    lowered = child_key.lower()
                    if any(word in lowered for word in cls.RATING_KEY_WORDS):
                        offenders.append(f"{path}.{child_key}")
                    elif isinstance(value, bool):
                        if child_key not in cls.BOOL_KEYS:
                            offenders.append(f"{path}.{child_key}={value}（布尔字段未登记）")
                    elif isinstance(value, (int, float)):
                        if child_key not in cls.NUMERIC_KEYS:
                            offenders.append(f"{path}.{child_key}={value}")
                    walk(value, f"{path}.{child_key}", child_key)
            elif isinstance(node, list):
                for index, item in enumerate(node):
                    # 列表里直接放的数字同样要归到父键名下检查
                    if isinstance(item, bool):
                        if key is not None and key not in cls.BOOL_KEYS:
                            offenders.append(f"{path}[{index}]={item}（布尔字段 {key} 未登记）")
                        continue
                    if (
                        isinstance(item, (int, float))
                        and key is not None
                        and key not in cls.NUMERIC_KEYS
                    ):
                        offenders.append(f"{path}[{index}]={item}（键 {key}）")
                        continue
                    walk(item, f"{path}[{index}]", key)

        walk(facts)
        return offenders

    @classmethod
    def _unregistered_text(cls, facts: dict) -> list:
        """返回事实包里所有「不该出现」的中文字符串。空列表才算干净。"""
        unexpected = []
        values = []

        def walk(node):
            if isinstance(node, dict):
                for key, value in node.items():
                    # 键名也要查：{"今年事业顺利，财源广进": null} 这种注入
                    # 只有键名带中文/空格才会露馅
                    if re.search(r"[\u4e00-\u9fff]", key) or " " in key:
                        unexpected.append(f"键名 {key[:70]}")
                    walk(value)
            elif isinstance(node, list):
                for value in node:
                    walk(value)
            elif isinstance(node, str):
                values.append(node)

        walk(facts)
        english_sentence = re.compile(r"[A-Za-z]{3,}\s+[A-Za-z]{3,}")
        # 中英混合只允许「标识符 + 干支尾巴」这一种形状，例如
        # natal.relation.branch-punishment.寅-巳-申
        # 尾巴只允许干支字与连字符：`x.运势大吉` 这种不能靠"含个点"混过去
        mixed_identifier = re.compile(
            r"^[a-z][a-z0-9._\-\[\]]*\.[甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥][甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥\-]*$"
        )
        for text in values:
            cjk = len(re.findall(r"[\u4e00-\u9fff]", text))
            if cjk == 0:
                # 纯 ASCII 必须落在**封闭的文法**里：路径、证据 ID、ISO 时刻、
                # 状态词、关系类型、检查 ID 等。像 excellent-fortune 这种
                # "看着像标识符其实是一句话"的写法进不来。
                if " " in text or english_sentence.search(text):
                    unexpected.append(text[:70])
                    continue
                if any(pattern.match(text) for pattern in cls.ASCII_SHAPES):
                    continue
                unexpected.append(text[:70])
                continue
            if re.search(r"[A-Za-z]", text):
                # 含中文又含 ASCII：只能是标识符形状，或已登记的整句
                if mixed_identifier.match(text):
                    continue
                if cls._normalise(text) in cls.ALLOWED_SENTENCES:
                    continue
                unexpected.append(text[:70])
                continue
            if cjk <= 6:
                # 先看是否已登记（短句也可能带数字，如「实际 12 个」）
                if cls._normalise(text) in cls.ALLOWED_SENTENCES:
                    continue
                # 干支组合：两个字，天干 + 地支
                if (
                    len(text) == 2
                    and text[0] in "甲乙丙丁戊己庚辛壬癸"
                    and text[1] in "子丑寅卯辰巳午未申酉戌亥"
                ):
                    continue
                if text in cls.SHORT_TERMS:
                    continue
                if re.fullmatch(r"\d+-\d+岁", text):
                    continue
                unexpected.append(text[:70])
                continue
            if cls._normalise(text) in cls.ALLOWED_SENTENCES:
                continue
            unexpected.append(cls._normalise(text)[:70])
        return unexpected

    def test_facts_package_has_no_unregistered_chinese_text(self):
        """闭集检查：长文本必须登记在案，短文本必须是经典术语表里的词。"""
        from mingli_tool.bazi import calculate

        scenarios = [
            ({"precision": "minute", "value": "12:30"}, "1990-05-15"),
            ({"precision": "branch", "branch": "午"}, "1990-05-15"),
            ({"precision": "branch", "branch": "子"}, "1990-05-15"),
            ({"precision": "unknown"}, "1990-05-15"),
            ({"precision": "branch", "branch": "巳"}, "2024-03-05"),
            ({"precision": "branch", "branch": "申"}, "2024-02-04"),
        ]
        for time_block, date in scenarios:
            with self.subTest(precision=time_block["precision"], date=date):
                payload = {
                    "schema_version": "1.0",
                    "profile": {
                        "display_name": None,
                        "calendar": "solar",
                        "date": date,
                        "is_leap_month": False,
                        "time": time_block,
                        "timezone": "Asia/Shanghai",
                        "sex_for_calculation": "male",
                        "birthplace": {"label": None, "longitude": None, "latitude": None},
                    },
                    "rules": {"profile_id": "engine-default-v1", "true_solar_time": False},
                    "options": {"save_history": False, "annual_cycles_through": 2026},
                }
                facts = calculate(payload)["monthly_facts"]
                self.assertEqual(
                    OutOfScopeGuardTest._forbidden_keys(facts), [],
                    f"{date} {time_block} 的事实包里出现了 AI/评级字段",
                )
                self.assertEqual(
                    OutOfScopeGuardTest._unregistered_numeric_keys(facts), [],
                    f"{date} {time_block} 的事实包里有不该出现的数值/评级字段",
                )
                self.assertEqual(
                    OutOfScopeGuardTest._unregistered_text(facts), [],
                    f"{date} {time_block} 的事实包里有未登记文本",
                )

    def test_closed_vocabulary_rejects_injected_prose(self):
        """证明闭集不是摆设：把解读文字塞进包里，检查器必须报出来。"""
        from mingli_tool.bazi import calculate

        payload = {
            "schema_version": "1.0",
            "profile": {
                "display_name": None,
                "calendar": "solar",
                "date": "1990-05-15",
                "is_leap_month": False,
                "time": {"precision": "unknown"},
                "timezone": "Asia/Shanghai",
                "sex_for_calculation": "male",
                "birthplace": {"label": None, "longitude": None, "latitude": None},
            },
            "rules": {"profile_id": "engine-default-v1", "true_solar_time": False},
            "options": {"save_history": False, "annual_cycles_through": 2026},
        }
        baseline = calculate(payload)["monthly_facts"]
        self.assertEqual(OutOfScopeGuardTest._unregistered_text(baseline), [])

        injections = (
            ("长句放进 reason", lambda f: f["layers"]["luck"].update({"reason": "今年事业顺利，财源广进"})),
            ("短句放进普通字段", lambda f: f["months"][0].update({"note_x": "运势大吉"})),
            ("长句放进白名单字段", lambda f: f["months"][0]["luck"].update({"reason": "本月宜静不宜动，注意健康。"})),
            ("塞进 week 列表", lambda f: f["months"][0].update({"extra": ["今年事业顺利，财源广进"]})),
        )
        for label, mutate in injections:
            with self.subTest(case=label):
                tampered = copy.deepcopy(baseline)
                mutate(tampered)
                self.assertTrue(
                    OutOfScopeGuardTest._unregistered_text(tampered)
                    or OutOfScopeGuardTest._unregistered_numeric_keys(tampered),
                    f"{label} 没有被闭集检查抓到",
                )


if __name__ == "__main__":
    unittest.main()
