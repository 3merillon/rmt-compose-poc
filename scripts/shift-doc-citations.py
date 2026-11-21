#!/usr/bin/env python3
"""Shift Markdown citations after a source edit or a JavaScript-to-TypeScript rename.

Usage: python scripts/shift-doc-citations.py <repo> <revision> <current/path.ts> [...]
Pass the revision that the existing line numbers refer to. Review the resulting
diff and run check-doc-citations.mjs before accepting the changes.
"""
import difflib
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys

repo = Path(sys.argv[1]).resolve()
revision = sys.argv[2]
paths = [PurePosixPath(p.replace("\\", "/")) for p in sys.argv[3:]]
if not paths:
    sys.exit(__doc__)

revision_paths = set(subprocess.check_output(
    ["git", "-C", repo, "ls-tree", "-r", "--name-only", revision],
    encoding="utf8",
).splitlines())
# Full paths always resolve. A basename shared by several files cannot.
names = {}
def register(name, target):
    if name in names and names[name] != target:
        names[name] = None
    else:
        names[name] = target

for path in paths:
    candidates = [path]
    if path.suffix == ".ts":
        candidates += [path.with_suffix(".js"), path.with_suffix(".mjs")]
    old = next((p for p in candidates if str(p) in revision_paths), None)
    if old is None:
        sys.exit(f"Cannot find the predecessor of {path} at {revision}")
    before = subprocess.check_output(["git", "-C", repo, "show", f"{revision}:{old}"], encoding="utf8").splitlines()
    after = (repo / path).read_text(encoding="utf8").splitlines()
    lines = {}
    for _, i1, i2, j1, j2 in difflib.SequenceMatcher(None, before, after, autojunk=False).get_opcodes():
        for k in range(i2 - i1):
            lines[i1 + k + 1] = min(j1 + k + 1, max(j1 + 1, j2), max(1, len(after)))
    for p in (old, path):
        register(str(p), (str(path), lines))
        if sum(PurePosixPath(f).name == p.name for f in revision_paths) <= 1:
            register(p.name, (path.name, lines))

named = re.compile(r"(?<![\w./-])((?:(?:src|rust|scripts|public)/)?[\w./-]+\.(?:m?js|ts|rs|json)):(\d+)(?:-(\d+))?")
bare = re.compile(r"`:(\d+)(?:-(\d+))?`")

def shift(lines, start, end):
    first = lines.get(int(start), int(start))
    return str(first) if not end else f"{first}-{lines.get(int(end), int(end))}"

changed = 0
for page in (repo / "docs").rglob("*.md"):
    if any(p in (".vitepress", "node_modules") for p in page.relative_to(repo).parts):
        continue
    with page.open(encoding="utf8", newline="") as stream:
        source = stream.read()
    first = next((m[1] for m in named.finditer(source) if "/" in m[1]), None)
    def update(match):
        target = names.get(match[1])
        if not target:
            return match[0]
        filename, lines = target
        return filename + ":" + shift(lines, match[2], match[3])
    output = named.sub(update, source)
    if first and names.get(first):
        first_lines = names[first][1]
        output = bare.sub(lambda m: "`:" + shift(first_lines, m[1], m[2]) + "`", output)
    if source != output:
        with page.open("w", encoding="utf8", newline="") as stream:
            stream.write(output)
        changed += 1
print(f"Changed {changed} page(s)")
