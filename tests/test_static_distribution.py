from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class StaticDistributionTests(unittest.TestCase):
    def test_both_workbenches_use_progressive_minimal_input(self):
        for relative_path in ("web/index.html", "dist/index.html"):
            with self.subTest(path=relative_path):
                page = (ROOT / relative_path).read_text(encoding="utf-8")
                for field_id in ("birth-year", "birth-month", "birth-day"):
                    self.assertIn(f'id="{field_id}"', page)
                self.assertIn('inputmode="numeric"', page)
                self.assertIn('id="is-leap"', page)
                self.assertIn("出生月份是闰月", page)
                self.assertNotIn('type="date"', page)
                self.assertIn('id="birth-time" name="birthTime" type="time"', page)
                self.assertIn("出生时间 <span class=\"optional\">选填</span>", page)
                self.assertIn('id="branch-mode-toggle"', page)
                self.assertIn('id="sex-error"', page)
                self.assertIn('name="sex" value="male"><span>男</span>', page)
                self.assertNotIn('name="precision"', page)
                self.assertNotIn('name="birthplace"', page)

    def test_browser_bundle_contains_exact_python_sources(self):
        pairs = (
            ("scripts/pai_pan.py", "dist/python/scripts/pai_pan.py"),
            ("src/mingli_tool/__init__.py", "dist/python/mingli_tool/__init__.py"),
            ("src/mingli_tool/errors.py", "dist/python/mingli_tool/errors.py"),
            ("src/mingli_tool/bazi_facts.py", "dist/python/mingli_tool/bazi_facts.py"),
            ("src/mingli_tool/bazi.py", "dist/python/mingli_tool/bazi.py"),
        )
        for source, bundled in pairs:
            with self.subTest(source=source):
                self.assertEqual(
                    (ROOT / source).read_bytes(),
                    (ROOT / bundled).read_bytes(),
                )

    def test_browser_runtime_is_pinned_and_loaded_before_application(self):
        index = (ROOT / "dist/index.html").read_text(encoding="utf-8")
        loader = (ROOT / "dist/engine-loader.js").read_text(encoding="utf-8")
        self.assertIn("pyodide/v314.0.7/full/pyodide.js", index)
        self.assertIn('const PYODIDE_VERSION = "314.0.7"', loader)
        self.assertLess(index.index("/engine-loader.js"), index.index("/app.js"))
        self.assertIn("window.calculateInBrowser", loader)
        self.assertIn("/python/mingli_tool/bazi_facts.py", loader)
        app = (ROOT / "dist/app.js").read_text(encoding="utf-8")
        self.assertIn('typeof window.calculateInBrowser === "function"', app)

    def test_plain_language_interpretation_is_loaded_before_both_apps(self):
        for relative_path in ("web/index.html", "dist/index.html"):
            with self.subTest(path=relative_path):
                page = (ROOT / relative_path).read_text(encoding="utf-8")
                self.assertIn('id="interpretation-section"', page)
                self.assertLess(page.index('/interpretation.js'), page.index('/app.js'))
        self.assertEqual(
            (ROOT / "web/interpretation.js").read_bytes(),
            (ROOT / "dist/interpretation.js").read_bytes(),
        )

    def test_date_input_is_loaded_before_both_apps(self):
        for relative_path in ("web/index.html", "dist/index.html"):
            with self.subTest(path=relative_path):
                page = (ROOT / relative_path).read_text(encoding="utf-8")
                self.assertLess(page.index("/date-input.js"), page.index("/app.js"))
        self.assertEqual(
            (ROOT / "web/date-input.js").read_bytes(),
            (ROOT / "dist/date-input.js").read_bytes(),
        )

    def test_ziwei_engine_and_adapter_are_pinned_and_loaded_before_both_apps(self):
        vendor_path = "vendor/iztro-v2.6.2.min.js"
        for relative_path in ("web/index.html", "dist/index.html"):
            with self.subTest(path=relative_path):
                page = (ROOT / relative_path).read_text(encoding="utf-8")
                self.assertIn(f'/{vendor_path}', page)
                self.assertLess(page.index(f'/{vendor_path}'), page.index("/ziwei-facts.js"))
                self.assertLess(page.index("/ziwei-facts.js"), page.index("/ziwei-adapter.js"))
                self.assertLess(page.index(f'/{vendor_path}'), page.index("/ziwei-adapter.js"))
                self.assertLess(page.index("/ziwei-adapter.js"), page.index("/app.js"))
                self.assertIn('id="system-ziwei"', page)
                self.assertIn('id="ziwei-content"', page)
        self.assertEqual(
            (ROOT / "web/vendor/iztro-v2.6.2.min.js").read_bytes(),
            (ROOT / "dist/vendor/iztro-v2.6.2.min.js").read_bytes(),
        )
        self.assertEqual(
            (ROOT / "web/ziwei-facts.js").read_bytes(),
            (ROOT / "dist/ziwei-facts.js").read_bytes(),
        )
        self.assertEqual(
            (ROOT / "web/ziwei-adapter.js").read_bytes(),
            (ROOT / "dist/ziwei-adapter.js").read_bytes(),
        )

    def test_ai_contract_is_loaded_guarded_and_distributed(self):
        for relative_path in ("web/index.html", "dist/index.html"):
            page = (ROOT / relative_path).read_text(encoding="utf-8")
            self.assertLess(page.index("/ai-contract.js"), page.index("/app.js"))
        self.assertEqual(
            (ROOT / "web/ai-contract.js").read_bytes(),
            (ROOT / "dist/ai-contract.js").read_bytes(),
        )
        contract = (ROOT / "web/ai-contract.js").read_text(encoding="utf-8")
        self.assertIn('"mingli-ai-input/v1"', contract)
        self.assertIn('"UNSUPPORTED_AI_SCOPE"', contract)
        self.assertIn('mode: "facts-only"', contract)

    def test_ai_interpretation_protocol_is_loaded_and_distributed(self):
        for relative_path in ("web/index.html", "dist/index.html"):
            page = (ROOT / relative_path).read_text(encoding="utf-8")
            self.assertLess(page.index("/ai-contract.js"), page.index("/ai-interpretation.js"))
            self.assertLess(page.index("/ai-interpretation.js"), page.index("/app.js"))
            self.assertIn('id="ai-reading-section"', page)
            self.assertIn("模拟网关", page)
        self.assertEqual(
            (ROOT / "web/ai-interpretation.js").read_bytes(),
            (ROOT / "dist/ai-interpretation.js").read_bytes(),
        )
        app = (ROOT / "web/app.js").read_text(encoding="utf-8")
        self.assertIn("prepareAiReading", app)
        self.assertIn("证据引用全部通过", app)

    def test_ziwei_plain_language_layer_is_loaded_and_distributed(self):
        for relative_path in ("web/index.html", "dist/index.html"):
            with self.subTest(path=relative_path):
                page = (ROOT / relative_path).read_text(encoding="utf-8")
                self.assertLess(page.index("/ziwei-adapter.js"), page.index("/ziwei-interpretation.js"))
                self.assertLess(page.index("/ziwei-interpretation.js"), page.index("/app.js"))
        self.assertEqual(
            (ROOT / "web/ziwei-interpretation.js").read_bytes(),
            (ROOT / "dist/ziwei-interpretation.js").read_bytes(),
        )
        app = (ROOT / "web/app.js").read_text(encoding="utf-8")
        self.assertIn("先看白话，再看术语", app)
        self.assertIn("现在走到哪一段", app)
        self.assertIn("查看当前大限与流年四化落点", app)
        self.assertIn("查看本命十二宫飞化与化忌链", app)
        self.assertIn("同宫离心、对宫向心", app)
        self.assertIn("流月、流日与流时坐标", app)
        self.assertIn("专业十二宫盘面", app)

    def test_date_parts_announce_mobile_flow_and_app_wires_auto_advance(self):
        for relative_path in ("web/index.html", "dist/index.html"):
            page = (ROOT / relative_path).read_text(encoding="utf-8")
            self.assertEqual(page.count('enterkeyhint="next"'), 2)
            self.assertEqual(page.count('enterkeyhint="done"'), 1)
        app = (ROOT / "web/app.js").read_text(encoding="utf-8")
        self.assertIn("attachAutoAdvance", app)

    def test_luck_and_annual_panels_include_plain_language_explanations(self):
        app = (ROOT / "web/app.js").read_text(encoding="utf-8")
        self.assertIn("先看懂这几个词", app)
        self.assertIn("进入第一步大运", app)
        self.assertIn("流年是“每一年的干支”", app)
        self.assertIn("explainCycle(cycle.ganzhi", app)
        self.assertIn("这一流年", app)
        self.assertIn("Number(right.year) - Number(left.year)", app)
        self.assertEqual((ROOT / "web/app.js").read_bytes(), (ROOT / "dist/app.js").read_bytes())
        self.assertEqual((ROOT / "web/styles.css").read_bytes(), (ROOT / "dist/styles.css").read_bytes())


if __name__ == "__main__":
    unittest.main()
