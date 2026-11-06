"""确定性与严格 JSON：包必须能被浏览器无歧义地消费。

两个容易被忽略的坑：

1. Python 的 ``json.dumps`` 默认 ``allow_nan=True``，会把 NaN / Infinity 原样写成
   ``NaN`` / ``Infinity``。这不是合法 JSON，浏览器 ``JSON.parse`` 会直接抛错。
   只要某个字段（比如 duration_days）算出 NaN，前端就会整块炸掉，而这在
   Python 侧一点都不报错。
2. 同一输入必须得到同一输出，且不能偷偷改调用方传进来的 ``calculation`` ——
   调用方通常会复用同一个 calculation 去算多个年份，被改一次后面全歪。
"""

from __future__ import annotations

import copy
import hashlib
import json
import unittest
from pathlib import Path

from mingli_tool.bazi import calculate
from mingli_tool.bazi_months import MAX_TARGET_YEAR, MIN_TARGET_YEAR, build_monthly_facts

ROOT = Path(__file__).resolve().parents[1]
FIXTURE_DIR = ROOT / "tests" / "fixtures"

PRECISIONS = (
    {"precision": "minute", "value": "12:30"},
    {"precision": "branch", "branch": "午"},
    {"precision": "branch", "branch": "子"},
    {"precision": "unknown"},
)


def payload(time_block: dict) -> dict:
    return {
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


class StrictJsonTest(unittest.TestCase):
    def test_every_supported_year_serialises_as_strict_json(self):
        """全范围都必须能 allow_nan=False 序列化——否则浏览器解析会报错。"""
        for year in range(MIN_TARGET_YEAR, MAX_TARGET_YEAR + 1):
            with self.subTest(year=year):
                facts = build_monthly_facts(None, year)
                try:
                    text = json.dumps(facts, ensure_ascii=False, allow_nan=False)
                except ValueError as error:      # 专门抓 NaN / Infinity
                    self.fail(f"{year} 年的事实包含非有限浮点数：{error}")
                self.assertEqual(json.loads(text)["target_year"], year)

    def test_all_precisions_serialise_as_strict_json(self):
        for time_block in PRECISIONS:
            with self.subTest(precision=time_block["precision"], branch=time_block.get("branch")):
                result = calculate(payload(time_block))
                facts = result["monthly_facts"]
                text = json.dumps(facts, ensure_ascii=False, allow_nan=False)
                round_tripped = json.loads(text)
                self.assertEqual(round_tripped["target_year"], facts["target_year"])
                self.assertEqual(len(round_tripped["months"]), 12)


    def test_strict_json_guard_actually_rejects_nan(self):
        """证明上一个用例不是摆设：真塞一个 NaN 进去，allow_nan=False 必须报错。"""
        facts = build_monthly_facts(None, 2026)
        facts["months"][0]["duration_days"] = float("nan")
        with self.assertRaises(ValueError):
            json.dumps(facts, ensure_ascii=False, allow_nan=False)
        # 而默认设置会把它写成非法 JSON —— 这正是要防的那个坑
        self.assertIn("NaN", json.dumps(facts, ensure_ascii=False))


class DeterminismTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.result = calculate(payload(PRECISIONS[0]))
        cls.calculation = cls.result["calculation"]
        cls.normalized = cls.result["normalized_input"]

    def test_same_input_gives_identical_output(self):
        first = build_monthly_facts(self.calculation, 2026, self.normalized)
        second = build_monthly_facts(self.calculation, 2026, self.normalized)
        self.assertEqual(
            json.dumps(first, ensure_ascii=False, sort_keys=True, allow_nan=False),
            json.dumps(second, ensure_ascii=False, sort_keys=True, allow_nan=False),
            "同一输入两次构建结果不一致，说明存在未受控的随机性或共享状态",
        )

    def test_building_does_not_mutate_inputs(self):
        calculation = copy.deepcopy(self.calculation)
        normalized = copy.deepcopy(self.normalized)
        before_calc = copy.deepcopy(calculation)
        before_norm = copy.deepcopy(normalized)

        for year in (2026, 2027, 2030):
            build_monthly_facts(calculation, year, normalized)

        self.assertEqual(calculation, before_calc, "calculation 被就地改动了")
        self.assertEqual(normalized, before_norm, "normalized_input 被就地改动了")

    def test_building_earlier_year_does_not_affect_later_year(self):
        """先算 2020 再算 2026，必须和直接算 2026 完全一致。"""
        baseline = build_monthly_facts(self.calculation, 2026, self.normalized)
        build_monthly_facts(self.calculation, 2020, self.normalized)
        after = build_monthly_facts(self.calculation, 2026, self.normalized)
        self.assertEqual(
            json.dumps(baseline, ensure_ascii=False, sort_keys=True),
            json.dumps(after, ensure_ascii=False, sort_keys=True),
        )


class ContractVersionTest(unittest.TestCase):
    """事实包版本必须跟上形状变化，消费方才有据可依。"""

    def test_version_and_new_contract_markers(self):
        from mingli_tool.bazi_months import SCHEMA_VERSION

        facts = build_monthly_facts(None, 2026)
        self.assertEqual(facts["schema_version"], SCHEMA_VERSION)
        self.assertEqual(SCHEMA_VERSION, "1.1", "形状变了就该升版本")

        result = calculate(payload(PRECISIONS[0]))
        audited = result["monthly_facts"]

        # 1.1 的三个可判读标记：年度汇总拆分、覆盖信息、切点精度
        luck = audited["layers"]["luck"]
        self.assertIn("mid_year", luck)
        self.assertIn("months_with_luck", luck)
        self.assertIn("months_without_luck", luck)
        self.assertNotIn("ganzhi", luck, "顶层不应再摊年中干支")

        coverage = audited["relation_audit"]["luck_coverage"]
        self.assertIn(coverage["coverage"], {"full", "partial"})
        self.assertEqual(
            sorted(coverage["months_with_luck"] + coverage["months_without_luck"]),
            list(range(1, 13)),
        )

        for month in audited["months"]:
            if month["luck"]["status"] == "split":
                self.assertIn("boundary_precision", month["luck"])
                self.assertIn("boundary_uncertainty_seconds", month["luck"])
                self.assertIn("ambiguous_windows", month["luck"])


class FixtureFreshnessTest(unittest.TestCase):
    """前端夹具必须与当前代码一致，否则「真实数据」其实早就过期了。"""

    CASES = {
        "monthly-real-minute.json": PRECISIONS[0],
        "monthly-real-branch.json": PRECISIONS[1],
        "monthly-real-zishi.json": PRECISIONS[2],
        "monthly-real-unknown.json": PRECISIONS[3],
    }

    def test_fixtures_match_current_code(self):
        for name, time_block in self.CASES.items():
            with self.subTest(fixture=name):
                path = FIXTURE_DIR / name
                self.assertTrue(path.exists(), f"缺夹具 {name}，跑 scripts/generate_monthly_fixtures.py")
                fixture = json.loads(path.read_text(encoding="utf-8"))
                facts = calculate(payload(time_block))["monthly_facts"]

                self.assertEqual(
                    fixture["fingerprint"], facts["fingerprint"],
                    f"{name} 的指纹已过期，需重新生成夹具",
                )
                self.assertEqual(fixture["target_year"], facts["target_year"])
                self.assertEqual(len(fixture["months"]), len(facts["months"]))
                # 最终判据：整包哈希。只比指纹与几个字段的话，
                # 改错某月的 luck.ganzhi 或关系内容照样能过。
                # 先验夹具自身没被手改过
                body = {
                    key: value for key, value in fixture.items()
                    if key not in ("_package_sha256", "_fixture_sha256")
                }
                self.assertEqual(
                    fixture.get("_fixture_sha256"),
                    hashlib.sha256(
                        json.dumps(body, ensure_ascii=False, sort_keys=True, allow_nan=False).encode("utf-8")
                    ).hexdigest(),
                    f"{name} 的夹具内容被改过（自校验哈希不符）",
                )
                # 夹具正文必须与「当前代码 + 同样的裁剪」得到的投影完全一致：
                # 只比哈希会把"两个哈希各管一边"的空子留着。
                projection = {k: v for k, v in facts.items() if k != "months"}
                projection["months"] = [
                    {k: v for k, v in month.items() if k not in ("relations", "relation_segments")}
                    for month in facts["months"]
                ]
                self.assertEqual(
                    body, projection,
                    f"{name} 的夹具正文与当前代码输出不一致",
                )
                expected = fixture.get("_package_sha256")
                self.assertTrue(expected, f"{name} 缺 _package_sha256，需重新生成夹具")
                live_digest = hashlib.sha256(
                    json.dumps(facts, ensure_ascii=False, sort_keys=True, allow_nan=False).encode("utf-8")
                ).hexdigest()
                self.assertEqual(
                    expected, live_digest,
                    f"{name} 的夹具与当前代码输出不一致，需重新生成",
                )

                for cached, live in zip(fixture["months"], facts["months"]):
                    self.assertEqual(cached["start"], live["start"], f"{name} 第 {live['index']} 月起点过期")
                    self.assertEqual(cached["ganzhi"], live["ganzhi"])
                    self.assertEqual(cached["luck"], live["luck"])


if __name__ == "__main__":
    unittest.main()
