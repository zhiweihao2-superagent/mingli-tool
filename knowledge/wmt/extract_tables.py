"""Extract plain table constants from FFDec-exported GlobalConsts.as to JSON."""
import json
import pathlib
import re

HERE = pathlib.Path(__file__).resolve().parent
SRC = next(HERE.glob("scripts/scripts/**/GlobalConsts.as"))


class Parser:
    def __init__(self, text: str, pos: int = 0) -> None:
        self.text = text
        self.pos = pos

    def skip(self) -> None:
        while self.pos < len(self.text):
            ch = self.text[self.pos]
            if ch in " \t\r\n":
                self.pos += 1
            elif self.text.startswith("//", self.pos):
                end = self.text.find("\n", self.pos)
                self.pos = len(self.text) if end < 0 else end + 1
            elif self.text.startswith("/*", self.pos):
                end = self.text.find("*/", self.pos)
                self.pos = len(self.text) if end < 0 else end + 2
            else:
                return

    def value(self):
        self.skip()
        ch = self.text[self.pos]
        if ch == "[":
            return self.array()
        if ch == '"':
            return self.string()
        start = self.pos
        while self.pos < len(self.text) and self.text[self.pos] not in ",]\n":
            self.pos += 1
        token = self.text[start:self.pos].strip()
        if token in ("true", "false"):
            return token == "true"
        if token == "null":
            return None
        try:
            return int(token)
        except ValueError:
            try:
                return float(token)
            except ValueError:
                raise ValueError(f"unparsable token {token!r} at {start}")

    def string(self) -> str:
        self.pos += 1
        out = []
        while True:
            ch = self.text[self.pos]
            if ch == "\\":
                nxt = self.text[self.pos + 1]
                mapping = {"n": "\n", "r": "\r", "t": "\t", '"': '"', "\\": "\\", "'": "'"}
                if nxt == "u":
                    out.append(chr(int(self.text[self.pos + 2:self.pos + 6], 16)))
                    self.pos += 6
                    continue
                out.append(mapping.get(nxt, nxt))
                self.pos += 2
                continue
            if ch == '"':
                self.pos += 1
                return "".join(out)
            out.append(ch)
            self.pos += 1

    def array(self) -> list:
        self.pos += 1
        items = []
        while True:
            self.skip()
            if self.pos >= len(self.text):
                raise ValueError("unterminated array")
            if self.text[self.pos] == "]":
                self.pos += 1
                return items
            items.append(self.value())
            self.skip()
            if self.pos < len(self.text) and self.text[self.pos] == ",":
                self.pos += 1


def main() -> None:
    text = SRC.read_text(encoding="utf-8", errors="replace")
    tables: dict[str, list] = {}
    pattern = re.compile(r"static\s+const\s+(\w+)\s*:\s*Array\s*=\s*")
    for m in pattern.finditer(text):
        name = m.group(1)
        try:
            value = Parser(text, m.end()).value()
        except Exception as exc:  # keep going; report per table
            tables[name] = [f"<parse error: {exc}>"]
            continue
        tables[name] = value
    out = HERE / "tables.json"
    out.write_text(json.dumps(tables, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"tables={len(tables)} -> {out} ({out.stat().st_size} bytes)")

    stars = tables.get("stars_noWrap_CHS") or []
    print("stars:", len(stars))
    for key in ("_AX_SHB_ARR", "_AX_KY_ARR1", "_AX_KY_ARR2", "_AX_KY_ARR3", "_AX_KY_ARR4", "_WXJS_CHS", "_SH_CHS"):
        print(key, json.dumps(tables.get(key), ensure_ascii=False)[:200])


if __name__ == "__main__":
    main()
