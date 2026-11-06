import copy
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT))

from mingli_tool.bazi import ENGINE_COMMIT, calculate  # noqa: E402
from mingli_tool.bazi_facts import _annotate_transformation_reviews, _pair_relations  # noqa: E402
from mingli_tool.cli import main  # noqa: E402
from mingli_tool.errors import ToolError  # noqa: E402


def request(precision="minute"):
    time_data = {"precision": precision, "value": None, "branch": None}
    if precision == "minute":
        time_data["value"] = "12:30"
    elif precision == "branch":
        time_data["branch"] = "午"
    return {
        "schema_version": "1.0",
        "profile": {
            "display_name": None,
            "calendar": "solar",
            "date": "1990-05-15",
            "is_leap_month": False,
            "time": time_data,
            "timezone": "Asia/Shanghai",
            "sex_for_calculation": "male",
            "birthplace": {"label": None, "longitude": None, "latitude": None},
        },
        "rules": {"profile_id": "engine-default-v1", "true_solar_time": False},
        "options": {"save_history": False, "annual_cycles_through": 2026},
    }


class BaziAdapterTests(unittest.TestCase):
    def assert_error(self, payload, code):
        with self.assertRaises(ToolError) as caught:
            calculate(payload)
        self.assertEqual(caught.exception.code, code)

    def test_known_time_maps_golden_pillars(self):
        result = calculate(request())
        pillars = result["calculation"]["pillars"]
        self.assertEqual(pillars["year"]["ganzhi"], "庚午")
        self.assertEqual(pillars["month"]["ganzhi"], "辛巳")
        self.assertEqual(pillars["day"]["ganzhi"], "庚辰")
        self.assertEqual(pillars["hour"]["ganzhi"], "壬午")
        self.assertEqual(result["calculation"]["engine"]["commit"], ENGINE_COMMIT)
        self.assertIn(
            "天乙贵人",
            {item["name"] for item in result["calculation"]["derived"]["shensha"]},
        )
        facts = result["ai_facts"]
        self.assertEqual(facts["schema_version"], "bazi-facts/v3")
        self.assertRegex(facts["fingerprint"], r"^bz1-[0-9a-f]{8}$")
        self.assertEqual(facts["validation"]["status"], "pass")
        self.assertTrue(facts["readiness"]["ai_may_interpret"])
        self.assertIn("natal-relations", facts["readiness"]["supported_scopes"])
        self.assertIn("school-agnostic-definitive-strength", facts["readiness"]["unsupported_scopes"])
        self.assertFalse(facts["element_inventory"]["scoring_applied"])
        self.assertEqual(len(facts["luck_cycles"]), 9)
        self.assertEqual(facts["annual_cycles"][-1]["year"], 2026)
        self.assertEqual(facts["annual_cycle_coverage"], {
            "start_year": 1990,
            "end_year": 2026,
            "count": 37,
            "requested_through": 2026,
            "complete_for_requested_range": True,
        })
        self.assertEqual(
            facts["derived_rules"]["useful_elements"]["resolution"]["profile"],
            "conservative-three-axis-consensus-v1",
        )

    def test_bazi_fact_relations_bind_to_pillars(self):
        result = calculate(request())
        relations = result["ai_facts"]["natal_relations"]
        self.assertIn(
            ("branch-punishment", ("year", "hour"), ("午", "午")),
            {(item["kind"], tuple(item["participants"]), tuple(item["values"])) for item in relations},
        )
        self.assertTrue(result["ai_facts"]["luck_cycles"][1]["ten_god"])
        self.assertIsInstance(result["ai_facts"]["luck_cycles"][1]["relations_to_natal"], list)

    def test_combination_transformation_conditions_are_audited_without_rewriting(self):
        pillars = {
            "year": {"stem": "甲", "branch": "子", "hidden_stems": []},
            "month": {"stem": "己", "branch": "丑", "hidden_stems": [{"element": "土"}]},
            "day": {"stem": "丙", "branch": "寅", "hidden_stems": []},
            "hour": None,
        }
        reviewed = _annotate_transformation_reviews(pillars, _pair_relations(pillars))
        stem_combine = next(item for item in reviewed if item["kind"] == "stem-combine")
        audit = stem_combine["transformation_review"]
        self.assertEqual(audit["status"], "supported-candidate")
        self.assertEqual(audit["target_element"], "土")
        self.assertTrue(audit["season_support"])
        self.assertFalse(audit["rewrites_original_elements"])

    def test_unknown_time_keeps_ymd_and_null_hour(self):
        result = calculate(request("unknown"))
        pillars = result["calculation"]["pillars"]
        self.assertEqual(pillars["day"]["ganzhi"], "庚辰")
        self.assertIsNone(pillars["hour"])
        self.assertIn("UNKNOWN_TIME", {item["code"] for item in result["warnings"]})
        self.assertEqual(sum(result["ai_facts"]["element_inventory"]["counts"]["visible_stems"].values()), 3)

    def test_late_zi_uses_next_day(self):
        payload = request()
        payload["profile"]["time"]["value"] = "23:30"
        result = calculate(payload)
        self.assertEqual(result["calculation"]["pillars"]["day"]["ganzhi"], "辛巳")
        self.assertEqual(result["calculation"]["derived"]["zi_period"], "夜子时")

    def test_branch_only_zi_is_explicit_assumption(self):
        payload = request("branch")
        payload["profile"]["time"]["branch"] = "子"
        result = calculate(payload)
        self.assertIn("EARLY_ZI_ASSUMPTION", {item["code"] for item in result["warnings"]})

    def test_lunar_anchor_matches_solar(self):
        solar = calculate(request())
        lunar_payload = request()
        lunar_payload["profile"]["calendar"] = "lunar"
        lunar_payload["profile"]["date"] = "1990-04-21"
        lunar = calculate(lunar_payload)
        for name in ("year", "month", "day", "hour"):
            self.assertEqual(
                solar["calculation"]["pillars"][name]["ganzhi"],
                lunar["calculation"]["pillars"][name]["ganzhi"],
            )
        self.assertEqual(lunar["normalized_input"]["profile"]["solar_date"], "1990-05-15")

    def test_invalid_date_has_stable_error(self):
        payload = request()
        payload["profile"]["date"] = "1990-02-30"
        self.assert_error(payload, "INVALID_DATE")

    def test_unsupported_timezone_is_rejected(self):
        payload = request()
        payload["profile"]["timezone"] = "Europe/London"
        self.assert_error(payload, "UNSUPPORTED_TIMEZONE")

    def test_true_solar_time_is_applied_and_recorded(self):
        payload = request()
        payload["profile"]["birthplace"] = {
            "label": "北京",
            "longitude": 116.4074,
            "latitude": None,
        }
        payload["rules"]["true_solar_time"] = True
        result = calculate(payload)
        correction = result["normalized_input"]["profile"]["time_correction"]
        self.assertTrue(correction["applied"])
        self.assertEqual(correction["longitude"], 116.4074)
        self.assertIn("TRUE_SOLAR_TIME_APPLIED", {item["code"] for item in result["warnings"]})

    def test_history_persistence_is_not_implemented(self):
        payload = request()
        payload["options"]["save_history"] = True
        self.assert_error(payload, "UNSUPPORTED_OPTION")

    def test_explicit_as_of_year_is_deterministic(self):
        first = calculate(request())
        second = calculate(copy.deepcopy(request()))
        self.assertEqual(first, second)
        self.assertEqual(first["calculation"]["annual_cycles"][-1]["year"], 2026)

    def test_coordinates_get_non_correction_warning(self):
        payload = request()
        payload["profile"]["birthplace"] = {
            "label": "成都",
            "longitude": 104.0665,
            "latitude": 30.5728,
        }
        result = calculate(payload)
        self.assertIn(
            "BIRTHPLACE_NOT_USED_FOR_SOLAR_CORRECTION",
            {item["code"] for item in result["warnings"]},
        )

    def test_cli_returns_json_error_and_exit_two(self):
        payload = request()
        payload["profile"]["date"] = "bad"
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "input.json"
            path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
            output = StringIO()
            with redirect_stdout(output):
                code = main(["bazi", "calculate", "--input", str(path)])
        self.assertEqual(code, 2)
        parsed = json.loads(output.getvalue())
        self.assertEqual(parsed["status"], "error")
        self.assertEqual(parsed["error"]["code"], "INVALID_DATE")


if __name__ == "__main__":
    unittest.main()
