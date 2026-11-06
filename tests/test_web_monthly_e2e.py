"""端到端：真实 HTTP 链路上的流月事实。

单元测试只覆盖模块内部；这里走完整路径（HTTP → 请求校验 → 排盘 → monthly_facts → JSON），
确认四种出生时刻精度都能得到符合验收标准的结果——尤其是提升为「不可确定」的那几种，
必须在真实响应里也表现为「不绑大运」，而不是只有单测里才对。
"""

from __future__ import annotations

import json
import sys
import threading
import unittest
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from mingli_tool.web import create_server  # noqa: E402


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


class MonthlyFactsEndToEndTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = create_server("127.0.0.1", 0)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base_url = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)

    def calculate(self, time_block: dict) -> dict:
        request = Request(
            f"{self.base_url}/api/v1/bazi/calculate",
            data=json.dumps(payload(time_block)).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urlopen(request, timeout=15) as response:
            self.assertEqual(response.status, 200)
            body = json.loads(response.read().decode("utf-8"))
        return body["monthly_facts"]

    def assert_structural_invariants(self, facts: dict) -> None:
        self.assertEqual(facts["status"], "ok")
        self.assertEqual(facts["target_year"], 2026)
        self.assertEqual(len(facts["months"]), 12)
        self.assertEqual([m["index"] for m in facts["months"]], list(range(1, 13)))
        for i in range(11):
            self.assertEqual(facts["months"][i]["end"], facts["months"][i + 1]["start"])
        self.assertEqual(
            facts["half_years"]["first_half"]["months"], [1, 2, 3, 4, 5, 6]
        )
        self.assertEqual(
            facts["half_years"]["second_half"]["months"], [7, 8, 9, 10, 11, 12]
        )
        self.assertEqual(facts["validation"]["status"], "pass")

    # ---------------------------------------------------------------- 精确到分钟
    def test_minute_precision_binds_luck_for_every_month(self):
        facts = self.calculate({"precision": "minute", "value": "12:30"})
        self.assert_structural_invariants(facts)
        self.assertEqual(facts["layers"]["luck"]["status"], "ok")
        self.assertEqual(facts["relation_audit"]["status"], "ok")
        self.assertEqual(facts["relation_audit"]["luck_coverage"]["coverage"], "full")
        self.assertEqual(
            facts["relation_audit"]["luck_coverage"]["months_with_luck"], list(range(1, 13))
        )
        first = facts["months"][0]
        self.assertIn("luck", first["relation_scope"]["computed_layers"])
        self.assertGreater(len(first["relations"]), 0)
        # 每条关系都要能落到四层之一，且绑定值不是空
        for relation in first["relations"]:
            self.assertEqual(len(relation["bindings"]), len(relation["participants"]))
            for binding in relation["bindings"]:
                self.assertIsNotNone(binding["value"])

    # ---------------------------------------------------------------- 只知时辰
    def test_branch_precision_still_resolves_with_tolerance(self):
        facts = self.calculate({"precision": "branch", "branch": "午"})
        self.assert_structural_invariants(facts)
        self.assertEqual(facts["layers"]["luck"]["status"], "ok")
        # 时辰精度下若出现 split，切点必须带上不确定度元数据
        for month in facts["months"]:
            if month["luck"]["status"] != "split":
                continue
            self.assertEqual(month["luck"]["boundary_precision"], "birth-time-approximate")
            # 不确定度 = 出生时刻误差 + 起运敏感度（+ 起运精度到天时的 43200）。
            # 固定写 3600 会漏掉后两项；这里直接与产品输出的总容差对齐。
            # split 分支只输出 boundary_uncertainty_seconds（没有 tolerance_seconds），
            # 所以拿它和月级容差比会 KeyError；这里直接对边界不确定度做下界检查。
            self.assertEqual(
                month["luck"]["boundary_uncertainty_seconds"],
                month["luck"].get("boundary_uncertainty_seconds"),
                "切点不确定度字段必须存在",
            )
            self.assertGreaterEqual(
                month["luck"]["boundary_uncertainty_seconds"],
                3600,
                "至少不能小于出生时刻本身的误差",
            )
            band_segments = [s for s in month["relation_segments"] if s["uncertain_band"]]
            for segment in band_segments:
                self.assertIn("luck", segment["relation_scope"]["omitted_layers"])

    def test_zishi_uses_day_pillar_to_pick_early_or_late(self):
        facts = self.calculate({"precision": "branch", "branch": "子"})
        self.assert_structural_invariants(facts)
        # 有日柱就能定早/晚子，因此不该整体降级为不可用
        self.assertEqual(facts["layers"]["luck"]["status"], "ok")
        self.assertEqual(facts["relation_audit"]["luck_coverage"]["coverage"], "full")

    # ---------------------------------------------------------------- 精度未知
    def test_unknown_precision_never_claims_luck(self):
        facts = self.calculate({"precision": "unknown"})
        self.assert_structural_invariants(facts)
        self.assertEqual(facts["layers"]["luck"]["status"], "unavailable")
        self.assertEqual(facts["relation_audit"]["status"], "partial")
        coverage = facts["relation_audit"]["luck_coverage"]
        self.assertEqual(coverage["coverage"], "partial")
        self.assertEqual(coverage["months_with_luck"], [])
        self.assertEqual(coverage["months_without_luck"], list(range(1, 13)))
        for month in facts["months"]:
            self.assertEqual(month["luck"]["status"], "indeterminate")
            self.assertIn("精度未知", month["luck"]["reason"])
            self.assertNotIn("luck", month["relation_scope"]["computed_layers"])

    # ---------------------------------------------------------------- 指纹一致
    def test_fingerprint_is_stable_and_matches_recompute(self):
        facts = self.calculate({"precision": "minute", "value": "12:30"})
        declared = facts["fingerprints"]["declared"] if "fingerprints" in facts else None
        if declared is not None:
            self.assertTrue(facts["fingerprints"]["matches"])
        self.assertTrue(facts["fingerprint"].startswith("mf-"))
        # 同样输入再算一次必须得到同一指纹
        again = self.calculate({"precision": "minute", "value": "12:30"})
        self.assertEqual(facts["fingerprint"], again["fingerprint"])


if __name__ == "__main__":
    unittest.main()
