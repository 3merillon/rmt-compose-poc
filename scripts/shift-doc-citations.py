#!/usr/bin/env python3
# Re-point docs line citations after a source edit: map each cited line of the OLD file (git rev) to
# the same line in the working tree (difflib), so a citation keeps pointing at what it said before.
# usage: python scripts/shift-doc-citations.py <repo> <rev> <src/path.js> [more...]
#   rev: the commit the docs were last right for (e.g. v2 before your branch). Run it after
#   a src/ edit, then check-doc-citations.mjs; it maps by line content, so a citation keeps
#   pointing at what it said, and a deleted line goes to the next one that survived.
import sys, subprocess, difflib, re, os, io
repo, rev, paths = sys.argv[1], sys.argv[2], sys.argv[3:]
def old_lines(p):
    return subprocess.run(['git', '-C', repo, 'show', f'{rev}:{p}'], capture_output=True, text=True, encoding='utf8').stdout.replace('\r\n', '\n').split('\n')
maps = {}
for p in paths:
    a = old_lines(p)
    b = io.open(os.path.join(repo, p), encoding='utf8').read().replace('\r\n', '\n').split('\n')
    m = {}
    sm = difflib.SequenceMatcher(None, a, b, autojunk=False)
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        for k in range(i2 - i1):
            if tag == 'equal' or (tag == 'replace' and k < j2 - j1): m[i1 + k + 1] = j1 + k + 1
            elif tag in ('delete', 'replace'): m[i1 + k + 1] = j1 + 1
    maps[os.path.basename(p)] = m
names = '|'.join(re.escape(n) for n in maps)
cite = re.compile(r'((?:' + names + r'):)(\d+)(?:-(\d+))?')
bare = re.compile(r'(`:)(\d+)(?:-(\d+))?(`)')
changed = 0
for root, _, files in os.walk(os.path.join(repo, 'docs')):
    if 'node_modules' in root or '.vitepress' in root and 'cache' in root: continue
    for f in files:
        if not f.endswith('.md'): continue
        fp = os.path.join(root, f)
        s = io.open(fp, encoding='utf8', newline='').read()
        out = []
        for line in s.split('\n'):
            last = [None]
            def sub(mo):
                name = mo.group(1)[:-1]; last[0] = name
                mp = maps[name]; n = int(mo.group(2)); r = mp.get(n, n)
                t = '' if not mo.group(3) else '-' + str(mp.get(int(mo.group(3)), int(mo.group(3))))
                return f'{mo.group(1)}{r}{t}'
            new = cite.sub(sub, line)
            if last[0]:
                mp = maps[last[0]]
                new = bare.sub(lambda mo: f'{mo.group(1)}{mp.get(int(mo.group(2)), int(mo.group(2)))}' + ('' if not mo.group(3) else '-' + str(mp.get(int(mo.group(3)), int(mo.group(3))))) + mo.group(4), new)
            if new != line: changed += 1
            out.append(new)
        ns = '\n'.join(out)
        if ns != s: io.open(fp, 'w', encoding='utf8', newline='').write(ns)
print('lines changed:', changed)
