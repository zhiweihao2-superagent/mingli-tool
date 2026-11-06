"""紫微流月分段的可控采样契约（T5）。

通过子进程注入可控 sample，覆盖：首/末签名缺失、二分采到第三签名、
二分采样为空、切换落在首日、正常跨月、同签名、非法日期。
"""

from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
# 探针写到**临时目录**：不能覆盖仓库里的同名文件，也不能留垃圾
_TMPDIR = Path(tempfile.mkdtemp(prefix="ziwei-seg-"))
PROBE = _TMPDIR / "_segment_probe.cjs"
PAYLOAD = _TMPDIR / "_segment_probe.json"

PROBE_SOURCE = r'''
const fs = require("node:fs");
require(process.env.ZIWEI_FACTS);
const Ziwei = globalThis.MingliZiweiFacts;
const payload = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const sigs = payload.signatures;
const sample = (d) => {
  const label = sigs[d];
  if (label === "__NULL__") return null;
  const monthly = label ? {
    name: "流月",
    ganzhi: "甲子",
    palaceOverlay: [{ monthlyPalace: "命宫" }],
    fourTransformations: [{ kind: "化禄", star: "天机" }],
    starsProvided: true,
  } : null;
  const pass = Boolean(monthly);
  return {
    lunarDate: label ? label + "月初一" : null,
    solarDate: d,
    current: { monthly },
    validation: {
      monthly: {
        status: pass ? "pass" : "unavailable",
        checks: [
          { id: "monthly_twelve_palaces_unique", pass },
          { id: "monthly_four_hua_complete", pass },
          { id: "monthly_transit_stars_valid", pass },
        ],
        hardFailures: [],
      },
    },
  };
};
const segs = Ziwei.lunarSegments(payload.spec, sample);
process.stdout.write(JSON.stringify({ segments: segs }));
'''

SPEC = {
    "index": 1,
    "startDate": "2026-02-04",
    "endDate": "2026-03-05",
    "midpoint": "2026-02-18",
}


def tearDownModule():
    import shutil
    shutil.rmtree(_TMPDIR, ignore_errors=True)


def _sigs(default="A"):
    start = date(2026, 2, 4)
    end = date(2026, 3, 5)
    out = {}
    cursor = start
    while cursor <= end:
        out[cursor.isoformat()] = default
        cursor += timedelta(days=1)
    return out


def _run(spec, sigs):
    PROBE.write_text(PROBE_SOURCE, encoding="utf-8")
    PAYLOAD.write_text(json.dumps({"spec": spec, "signatures": sigs}), encoding="utf-8")
    env = dict(**__import__("os").environ)
    env["ZIWEI_FACTS"] = str(ROOT / "web" / "ziwei-facts.js")
    proc = subprocess.run(
        ["node", str(PROBE), str(PAYLOAD)], capture_output=True, cwd=str(ROOT), env=env,
    )
    assert proc.returncode == 0, proc.stderr.decode("utf-8", "replace")
    data = json.loads(proc.stdout.decode("utf-8"))
    segments = data["segments"]
    return {"segments": segments, "segmentCount": len(segments)}


class SegmentContractTest(unittest.TestCase):
    def test_missing_start_signature_marks_unverified(self):
        sigs = _sigs()
        sigs["2026-02-04"] = "__NULL__"
        month = _run(SPEC, sigs)
        self.assertEqual(month["segmentCount"], 1)
        seg = month["segments"][0]
        self.assertIs(seg["verified"], False)
        self.assertEqual(seg["from"], SPEC["startDate"])
        self.assertEqual(seg["to"], SPEC["endDate"])

    def test_missing_end_signature_marks_unverified(self):
        sigs = _sigs()
        sigs["2026-03-05"] = "__NULL__"
        self.assertIs(_run(SPEC, sigs)["segments"][0]["verified"], False)

    def test_third_signature_marks_unverified(self):
        sigs = _sigs()
        sigs["2026-03-05"] = "B"
        sigs["2026-02-18"] = "C"
        month = _run(SPEC, sigs)
        self.assertEqual(month["segmentCount"], 1)
        self.assertIs(month["segments"][0]["verified"], False)

    def test_null_sample_during_search_marks_unverified(self):
        sigs = _sigs()
        sigs["2026-03-05"] = "B"
        sigs["2026-02-18"] = "__NULL__"
        self.assertIs(_run(SPEC, sigs)["segments"][0]["verified"], False)

    def test_switch_on_first_day_yields_one_day_segment(self):
        """切换落在首日时，首段只有 1 天，但仍是可构造的相邻边界（契约允许）。"""
        sigs = _sigs("B")
        sigs["2026-02-04"] = "A"
        month = _run(SPEC, sigs)
        self.assertEqual(month["segmentCount"], 2)
        first, second = month["segments"]
        self.assertEqual(first["from"], SPEC["startDate"])
        self.assertEqual(first["to"], SPEC["startDate"])
        self.assertEqual(first["days"], 1)
        self.assertIs(first["verified"], True)
        self.assertIs(second["verified"], True)

    def test_normal_split_yields_two_verified_segments(self):
        sigs = _sigs()
        cursor = date(2026, 2, 17)
        while cursor <= date(2026, 3, 5):
            sigs[cursor.isoformat()] = "B"
            cursor += timedelta(days=1)
        month = _run(SPEC, sigs)
        self.assertEqual(month["segmentCount"], 2)
        first, second = month["segments"]
        self.assertIs(first["verified"], True)
        self.assertIs(second["verified"], True)
        self.assertLess(first["to"], second["from"])
        self.assertEqual(first["days"] + second["days"], 30)

    def test_same_signature_yields_single_verified_segment(self):
        month = _run(SPEC, _sigs())
        self.assertEqual(month["segmentCount"], 1)
        self.assertIs(month["segments"][0]["verified"], True)

    def test_invalid_date_returns_no_segments(self):
        spec = dict(SPEC, startDate="2026-02-30")
        month = _run(spec, _sigs())
        self.assertEqual(month["segmentCount"], 0)


# ---- T3：生成侧失败矩阵探针 ----
ASSESS_PROBE = r"""
const fs = require("node:fs");
require(process.env.ZIWEI_FACTS);
const Ziwei = globalThis.MingliZiweiFacts;
const payload = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));

function revive(value) {
  if (value === "__ARRAY__") return ["2026-02-04"];
  if (value === "__THROW_LENGTH__") {
    return { get length() { throw new Error("boom-length"); } };
  }
  return value;
}

if (payload.mode === "assess") {
  const source = JSON.parse(JSON.stringify(payload.source ?? {}));
  (source.segments || []).forEach((seg) => {
    Object.keys(seg).forEach((key) => { seg[key] = revive(seg[key]); });
  });
  const result = Ziwei.assessSegments(source, payload.expected, payload.options || {});
  process.stdout.write(JSON.stringify({
    ok: result.ok, reason: result.reason, coverage: result.coverage,
  }));
} else {
  // build 模式：用 hooks.segmenter 注入非法返回值，验证不抛异常
  const specs = [payload.spec];
  const result = Ziwei.buildMonthlyTiming(null, [], specs, 0, {
    sample: () => null,
    segmenter: () => revive(payload.segmenterReturn),
  });
  const month = result.months[0];
  process.stdout.write(JSON.stringify({
    status: month.status,
    reason: month.reason,
    segments: (month.segments || []).length,
    coverage: month.coverage,
    sources: [
      month.palaceOverlay?.source ?? null,
      month.fourTransformations?.source ?? null,
      month.transitStars?.source ?? null,
    ],
  }));
}
"""




# ---- T3：生成侧失败矩阵探针 ----
ASSESS_PROBE = r"""
const fs = require("node:fs");
require(process.env.ZIWEI_FACTS);
const Ziwei = globalThis.MingliZiweiFacts;
const payload = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));

function revive(value) {
  if (value === "__ARRAY__") return ["2026-02-04"];
  if (value === "__THROW_LENGTH__") {
    return { get length() { throw new Error("boom-length"); } };
  }
  return value;
}

if (payload.mode === "assess") {
  const source = JSON.parse(JSON.stringify(payload.source ?? {}));
  (source.segments || []).forEach((seg) => {
    Object.keys(seg).forEach((key) => { seg[key] = revive(seg[key]); });
  });
  const result = Ziwei.assessSegments(source, payload.expected, payload.options || {});
  process.stdout.write(JSON.stringify({
    ok: result.ok, reason: result.reason, coverage: result.coverage,
  }));
} else {
  // build 模式：用 hooks.segmenter 注入非法返回值，验证不抛异常
  const specs = [payload.spec];
  const result = Ziwei.buildMonthlyTiming(null, [], specs, 0, {
    sample: () => null,
    segmenter: () => revive(payload.segmenterReturn),
  });
  const month = result.months[0];
  process.stdout.write(JSON.stringify({
    status: month.status,
    reason: month.reason,
    segments: (month.segments || []).length,
    coverage: month.coverage,
    sources: [
      month.palaceOverlay?.source ?? null,
      month.fourTransformations?.source ?? null,
      month.transitStars?.source ?? null,
    ],
  }));
}
"""

ASSESS_PROBE_PATH = _TMPDIR / "_assess_probe.cjs"


def _run_assess(payload):
    ASSESS_PROBE_PATH.write_text(ASSESS_PROBE, encoding="utf-8")
    PAYLOAD.write_text(json.dumps(payload), encoding="utf-8")
    env = dict(**__import__("os").environ)
    env["ZIWEI_FACTS"] = str(ROOT / "web" / "ziwei-facts.js")
    proc = subprocess.run(
        ["node", str(ASSESS_PROBE_PATH), str(PAYLOAD)],
        capture_output=True, cwd=str(ROOT), env=env,
    )
    assert proc.returncode == 0, proc.stderr.decode("utf-8", "replace")
    return json.loads(proc.stdout.decode("utf-8"))


def _seg(from_date, to_date, days, verified=True, **extra):
    seg = {"from": from_date, "to": to_date, "days": days, "verified": verified,
           "midpoint": from_date}
    seg.update(extra)
    return seg


class GenerationFailureMatrixTest(unittest.TestCase):
    """T3：生成侧结构校验的失败矩阵。"""

    EXPECTED = {"startDate": "2026-02-04", "endDate": "2026-03-05"}

    def _assess(self, source, options=None, expected=None):
        return _run_assess({
            "mode": "assess",
            "source": source,
            "expected": self.EXPECTED if expected is None else expected,
            "options": options or {"raw": True},
        })

    def test_valid_single_segment_passes(self):
        out = self._assess({"segments": [_seg("2026-02-04", "2026-03-05", 30)], "coverage": None})
        self.assertTrue(out["ok"], out.get("reason"))
        self.assertEqual(out["coverage"], "full")

    def test_raw_requires_midpoint(self):
        seg = _seg("2026-02-04", "2026-03-05", 30)
        seg.pop("midpoint")
        out = self._assess({"segments": [seg], "coverage": None})
        self.assertFalse(out["ok"])

    def test_raw_rejects_null_midpoint(self):
        out = self._assess({"segments": [_seg("2026-02-04", "2026-03-05", 30, midpoint=None)], "coverage": None})
        self.assertFalse(out["ok"])

    def test_raw_rejects_array_midpoint(self):
        out = self._assess({"segments": [_seg("2026-02-04", "2026-03-05", 30, midpoint="__ARRAY__")], "coverage": None})
        self.assertFalse(out["ok"])

    def test_raw_rejects_out_of_range_midpoint(self):
        out = self._assess({"segments": [_seg("2026-02-04", "2026-03-05", 30, midpoint="2026-06-01")], "coverage": None})
        self.assertFalse(out["ok"])

    def test_rejects_array_date(self):
        out = self._assess({"segments": [_seg("__ARRAY__", "2026-03-05", 30)], "coverage": None})
        self.assertFalse(out["ok"])

    def test_rejects_missing_expected(self):
        out = self._assess({"segments": [_seg("2026-02-04", "2026-03-05", 30)], "coverage": None}, expected={})
        self.assertFalse(out["ok"])

    def test_rejects_reversed_expected(self):
        out = self._assess(
            {"segments": [_seg("2026-02-04", "2026-03-05", 30)], "coverage": None},
            expected={"startDate": "2026-03-05", "endDate": "2026-02-04"},
        )
        self.assertFalse(out["ok"])

    def test_non_raw_requires_boolean_isDominant(self):
        out = self._assess(
            {"segments": [_seg("2026-02-04", "2026-03-05", 30, isDominant="false")], "coverage": "full"},
            options={"raw": False},
        )
        self.assertFalse(out["ok"])

    def test_throwing_length_getter_does_not_crash(self):
        out = _run_assess({
            "mode": "build",
            "spec": {"index": 1, "startDate": "2026-02-04", "endDate": "2026-03-05", "midpoint": "2026-02-18"},
            "segmenterReturn": "__THROW_LENGTH__",
        })
        self.assertEqual(out["status"], "unverifiable")
        self.assertEqual(out["segments"], 0)
        self.assertEqual(out["coverage"], "none")

    def test_structure_failure_has_null_sources(self):
        out = _run_assess({
            "mode": "build",
            "spec": {"index": 1, "startDate": "2026-02-04", "endDate": "2026-03-05", "midpoint": "2026-02-18"},
            "segmenterReturn": [],
        })
        self.assertEqual(out["status"], "unverifiable")
        self.assertEqual(out["sources"], [None, None, None])


if __name__ == "__main__":
    unittest.main()
