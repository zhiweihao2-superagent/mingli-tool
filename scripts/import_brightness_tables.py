"""把文墨天机导出的四套亮度表接入紫微事实层。

来源：`knowledge/wmt/tables.json`（由 FFDec 反编译得到，表名 `_AX_SB_QS` / `_AX_SB_XD1` /
`_AX_SB_XD2` / `_AX_SB_ZZ`）。每行 13 个数字，首列占位，后 12 列从子到亥；
1 庙 2 旺 3 得 4 利 5 平 6 不 7 陷，0 表示该派不给这颗星定亮度。

做两件事：
1. 生成 `knowledge/wmt/brightness.json`，供文档与对账脚本直接读。
2. 把 `web/ziwei-facts.js` 里硬编码的「全书派」单表替换成四套表 + 门派选择逻辑。

自检：生成的 `qs` 必须与原先硬编码的 `QS_BRIGHTNESS` 逐星逐支完全一致，
否则说明数字映射或星名对错了地方，直接失败而不是带着错表上线。
"""

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TABLES_PATH = ROOT / "knowledge" / "wmt" / "tables.json"
BRIGHTNESS_PATH = ROOT / "knowledge" / "wmt" / "brightness.json"
FACTS_PATH = ROOT / "web" / "ziwei-facts.js"

# 引擎把截空/旬空成对输出为副截/副旬，数值与主星相同；表里只有主星名。
NAME_ALIASES = {"副截": "截空", "副旬": "旬空"}

PROFILES = [
    ("qs", "斗数全书派", "_AX_SB_QS"),
    ("xd1", "现代修订一（文墨默认）", "_AX_SB_XD1"),
    ("xd2", "现代修订二", "_AX_SB_XD2"),
    ("zz", "中州派", "_AX_SB_ZZ"),
]


def build_rows(table, names):
    rows = {}
    for index in range(1, len(names)):
        name = names[index]
        if not name:
            continue
        row = table[index]
        if len(row) != 13:
            raise SystemExit(f"表行长度异常：{name} -> {len(row)}（应为 13）")
        rows[name] = "".join(str(value) for value in row[1:13])
    for alias, target in NAME_ALIASES.items():
        if target in rows:
            rows[alias] = rows[target]
    return rows


def existing_qs(facts_text):
    match = re.search(r"const QS_BRIGHTNESS = Object\.freeze\(\{(.*?)\n  \}\);", facts_text, re.S)
    if not match:
        raise SystemExit("web/ziwei-facts.js 里找不到旧的 QS_BRIGHTNESS 块")
    expected = {
        name: [int(value) for value in digits.split(",")]
        for name, digits in re.findall(r"([\u4e00-\u9fa5]+):\[([0-9,]+)\]", match.group(1))
    }
    return expected, match


def verify(rows, expected):
    mismatched = []
    for name, old_row in expected.items():
        if name not in rows:
            mismatched.append((name, "missing"))
            continue
        if [int(char) for char in rows[name]] != old_row:
            mismatched.append((name, old_row, rows[name]))
    if mismatched:
        raise SystemExit(f"生成的 qs 表与原实现不一致：{mismatched[:5]}")


def write_knowledge(generated):
    payload = {
        "schema": "wmt-brightness/v1",
        "source": {
            "artifact": "文墨天机 2.0.15（Adobe AIR 2.0.15）",
            "tables": [item[2] for item in PROFILES],
            "note": "每颗星 12 位数字，子→亥；1 庙 2 旺 3 得 4 利 5 平 6 不 7 陷，0 = 该派不赋值",
        },
        "defaultProfile": "qs",
        "profiles": {
            key: {"label": value["label"], "table": value["table"], "rows": value["rows"]}
            for key, value in generated.items()
        },
    }
    BRIGHTNESS_PATH.write_text(
        json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )


def js_block(generated):
    lines = [
        '  const BRIGHTNESS_TEXT = Object.freeze({ 1: "庙", 2: "旺", 3: "得", 4: "利", 5: "平", 6: "不", 7: "陷" });',
        "  // 亮度四套：源文墨天机 2.0.15 的 _AX_SB_QS / _AX_SB_XD1 / _AX_SB_XD2 / _AX_SB_ZZ。",
        "  // 每颗星 12 位数字，子→亥；1 庙 2 旺 3 得 4 利 5 平 6 不 7 陷，0 表示该派不给这颗星定亮度。",
        "  // 默认取「现代修订一」（xd1）：那是文墨的出厂口径；切换门派只改 brightnessSchool，不动排盘。",
        "  const BRIGHTNESS_PROFILES = Object.freeze({",
    ]
    for key, _, table_name in PROFILES:
        rows = generated[key]["rows"]
        lines.append(f"    {key}: Object.freeze({{")
        lines.append(f'      label: "{generated[key]["label"]}",')
        lines.append(f'      wmtTable: "{table_name}",')
        lines.append("      stars: Object.freeze({")
        names = list(rows)
        for start in range(0, len(names), 4):
            chunk = names[start : start + 4]
            lines.append("        " + " ".join(f'{name}: "{rows[name]}",' for name in chunk))
        lines.append("      })")
        lines.append("    }),")
    lines.append("  });")
    lines.append('  const BRIGHTNESS_DEFAULT_PROFILE = "xd1";')
    lines.append("  const BRIGHTNESS_PROFILE_ALIASES = Object.freeze({")
    lines.append('    qs: "qs", "全书": "qs", "斗数全书": "qs", "斗数全书派": "qs", QS: "qs",')
    lines.append('    xd1: "xd1", "现代一": "xd1", "现代修订一": "xd1", XD1: "xd1",')
    lines.append('    xd2: "xd2", "现代二": "xd2", "现代修订二": "xd2", XD2: "xd2",')
    lines.append('    zz: "zz", "中州": "zz", "中州派": "zz", ZZ: "zz"')
    lines.append("  });")
    lines.append("  // 引擎与文墨对同一颗星的写法偶有差异，这里只放已经核过的别名。")
    lines.append('  const BRIGHTNESS_STAR_ALIASES = Object.freeze({ 官府: "官符" });')
    lines.append("  function resolveBrightnessProfile(name) {")
    lines.append('    const raw = String(name ?? "").trim();')
    lines.append("    if (!raw) return null;")
    lines.append("    const alias = BRIGHTNESS_PROFILE_ALIASES[raw];")
    lines.append("    if (alias) return alias;")
    lines.append("    const key = raw.toLowerCase();")
    lines.append("    return BRIGHTNESS_PROFILES[key] ? key : null;")
    lines.append("  }")
    lines.append("  function brightnessOf(profileId, starName, branchIndex) {")
    lines.append("    const profile = BRIGHTNESS_PROFILES[profileId];")
    lines.append("    if (!profile) return { known: false, label: null };")
    lines.append("    const name = profile.stars[starName] ? starName : BRIGHTNESS_STAR_ALIASES[starName];")
    lines.append("    const row = profile.stars[name];")
    lines.append("    if (!row) return { known: false, label: null };")
    lines.append("    return { known: true, label: BRIGHTNESS_TEXT[Number(row[branchIndex])] || null };")
    lines.append("  }")
    return "\n".join(lines)


def replace_once(text, old, new, label):
    if text.count(old) != 1:
        raise SystemExit(f"替换失败（{label}）：命中 {text.count(old)} 次")
    return text.replace(old, new)


def patch_facts(facts, block, old_match):
    facts = facts.replace(old_match.group(0), block)

    facts = replace_once(
        facts,
        """  function applyDefaultBrightness(palaces) {
    palaces.forEach(palace => {
      const branchIndex = BRANCHES.indexOf(palace.earthlyBranch);
      STAR_GROUPS.forEach(group => palace[group].forEach(star => {
        const value = QS_BRIGHTNESS[star.name]?.[branchIndex] || 0;
        if (QS_BRIGHTNESS[star.name]) star.brightness = BRIGHTNESS_TEXT[value] || null;
      }));
    });
  }""",
        """  // 只按选定门派给「该派有定义」的星曜赋亮度；0 或未收录保持 null，不猜。
  function applyDefaultBrightness(palaces, brightnessSchool) {
    const profile = resolveBrightnessProfile(brightnessSchool) || BRIGHTNESS_DEFAULT_PROFILE;
    palaces.forEach(palace => {
      const branchIndex = BRANCHES.indexOf(palace.earthlyBranch);
      STAR_GROUPS.forEach(group => palace[group].forEach(star => {
        const found = brightnessOf(profile, star.name, branchIndex);
        if (found.known) star.brightness = found.label;
      }));
    });
    return profile;
  }""",
        "applyDefaultBrightness",
    )

    facts = replace_once(
        facts,
        "function applyKnownCorrections(yearStem, yearBranch, palaces) {",
        "function applyKnownCorrections(yearStem, yearBranch, palaces, brightnessSchool) {",
        "applyKnownCorrections 签名",
    )
    facts = facts.replace(
        "    applyDefaultBrightness(palaces);", "    applyDefaultBrightness(palaces, brightnessSchool);"
    )

    facts = replace_once(
        facts,
        "function validate({ palaces, fourTransformations, normalizedInput, relations, natalStructure }) {",
        "function validate({ palaces, fourTransformations, normalizedInput, relations, natalStructure, brightnessProfile }) {",
        "validate 签名",
    )

    facts = replace_once(
        facts,
        """      {
        id: "default_brightness_applied",
        pass: palaces.every(palace => STAR_GROUPS.every(group => palace[group].every(star => {
          const row = QS_BRIGHTNESS[star.name];
          if (!row) return true;
          const expected = BRIGHTNESS_TEXT[row[BRANCHES.indexOf(palace.earthlyBranch)]] || null;
          return star.brightness === expected;
        }))),
        message: "已收录星曜按全书派默认亮度表统一赋值"
      }""",
        """      {
        id: "default_brightness_applied",
        pass: palaces.every(palace => STAR_GROUPS.every(group => palace[group].every(star => {
          const profile = brightnessProfile || BRIGHTNESS_DEFAULT_PROFILE;
          const found = brightnessOf(profile, star.name, BRANCHES.indexOf(palace.earthlyBranch));
          if (!found.known) return true;
          return star.brightness === found.label;
        }))),
        message: `已收录星曜按「${BRIGHTNESS_PROFILES[brightnessProfile || BRIGHTNESS_DEFAULT_PROFILE].label}」亮度表统一赋值`
      }""",
        "亮度校验",
    )

    facts = replace_once(
        facts,
        "function build({ chart, astrolabe, palaces, normalizedInput, ruleProfile, asOfYear, asOfDate, asOfTimeIndex, dualFourPillars }) {",
        "function build({ chart, astrolabe, palaces, normalizedInput, ruleProfile, brightnessSchool, asOfYear, asOfDate, asOfTimeIndex, dualFourPillars }) {",
        "build 签名",
    )

    facts = replace_once(
        facts,
        """    const yearBranch = yearGanzhi.charAt(1);
    const corrections = applyKnownCorrections(yearStem, yearBranch, palaces);""",
        """    const yearBranch = yearGanzhi.charAt(1);
    // 门派可以直接传，也可以从 ruleProfile 带下来；识别不了就回落默认，不静默乱用。
    const brightnessProfile = resolveBrightnessProfile(brightnessSchool ?? ruleProfile?.brightnessSchool)
      || BRIGHTNESS_DEFAULT_PROFILE;
    const corrections = applyKnownCorrections(yearStem, yearBranch, palaces, brightnessProfile);""",
        "build 亮度门派",
    )

    facts = replace_once(
        facts,
        "const validation = validate({ palaces, fourTransformations, normalizedInput, relations, natalStructure });",
        "const validation = validate({ palaces, fourTransformations, normalizedInput, relations, natalStructure, brightnessProfile });",
        "validate 调用",
    )

    facts = replace_once(
        facts,
        """      corrections,
      validation,""",
        """      corrections,
      brightness: {
        profile: brightnessProfile,
        label: BRIGHTNESS_PROFILES[brightnessProfile].label,
        wmtTable: BRIGHTNESS_PROFILES[brightnessProfile].wmtTable,
        alternates: Object.keys(BRIGHTNESS_PROFILES).filter(key => key !== brightnessProfile)
      },
      validation,""",
        "build 返回值",
    )
    return facts


def main():
    tables = json.loads(TABLES_PATH.read_text(encoding="utf-8"))
    names = tables["stars_noWrap_CHS"]
    facts = FACTS_PATH.read_text(encoding="utf-8")
    if "const BRIGHTNESS_PROFILES = Object.freeze({" in facts:
        # 已经接入过：只重建 knowledge 快照，避免重复打补丁把文件改坏
        generated = {}
        for key, label, table_name in PROFILES:
            rows = build_rows(tables[table_name], names)
            generated[key] = {"label": label, "table": table_name, "rows": rows}
        write_knowledge(generated)
        print("web/ziwei-facts.js 已接入四套表，只重建了 knowledge/wmt/brightness.json")
        return
    expected, match = existing_qs(facts)

    generated = {}
    for key, label, table_name in PROFILES:
        rows = build_rows(tables[table_name], names)
        generated[key] = {"label": label, "table": table_name, "rows": rows}
        print(f"{key:4} 星数={len(rows)}  表={table_name}")

    verify(generated["qs"]["rows"], expected)
    print(f"自检通过：qs 与旧实现逐星逐支一致（{len(expected)} 颗）")

    write_knowledge(generated)
    print(f"写出 {BRIGHTNESS_PATH.relative_to(ROOT)}")

    block = js_block(generated)
    FACTS_PATH.write_text(patch_facts(facts, block, match), encoding="utf-8")
    print(f"改写 {FACTS_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
