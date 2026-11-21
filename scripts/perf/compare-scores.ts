// Compare a reference Git worktree to this checkout, including valid legacy inputs.
// node scripts/perf/compare-scores.mjs <reference-worktree>
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isInputScore } from '../../src/model-types.ts';

const candidate = fileURLToPath(new URL('../../', import.meta.url));
const reference = process.argv[2];
if (!reference) throw new Error('Pass the path to the reference Git worktree');
assert.notEqual(realpathSync(candidate), realpathSync(reference), 'Use separate reference and candidate worktrees');
const hash = (text: string) => createHash('sha256').update(text).digest('hex');

function runtimeModule(root: string, stem: string) {
  const path = resolve(root, 'src', stem);
  return import(pathToFileURL(path + (existsSync(path + '.ts') ? '.ts' : '.js')).href);
}

async function snapshot(root: string) {
  // Both revisions expose the same public musical API. Static type imports describe
  // that API while file URLs load each revision's implementation and dependencies.
  const model: typeof import('../../src/module.ts') = await runtimeModule(root, 'module');
  const noteApi: typeof import('../../src/note.ts') = await runtimeModule(root, 'note');
  const exact: typeof import('../../src/value/exact.ts') = await runtimeModule(root, 'value/exact');
  const paths = execFileSync('git', ['-C', root, 'ls-files', '-z', '--', 'public/modules',
    'scripts/fixtures/old-time', 'scripts/fixtures/legacy-syntax'], { encoding: 'utf8' })
    .split('\0').filter(path => path.endsWith('.json')).sort();
  const scores = new Map<string, { notes: number; save: string; evaluation: string }>();
  for (const path of paths) {
    if (path.startsWith('public/modules/') && ['index.json', 'library.json'].includes(basename(path))) continue;
    const input: unknown = JSON.parse(await readFile(resolve(root, path), 'utf8'));
    assert(isInputScore(input), 'Invalid tracked score: ' + path);
    const score = await model.Module.loadFromJSON(input);
    const records = score.evaluateModule();
    const notes = Object.values(score.notes).map(note => ({
      id: note.id,
      kind: noteApi.noteKind(note),
      deps: [...note.getAllDependencies()],
      corruption: records.get(note.id)?.corruptionFlags,
      approximation: records.get(note.id)?.approxFlags,
      values: noteApi.EXPRESSION_VARS.map(key => {
        const v = note.getExactVariable(key);
        return [key, exact.kindOf(v), exact.toText(v), note.getExpression(key)?.getVariableRefs()];
      }),
    }));
    scores.set(path, { notes: notes.length, save: hash(score.createModuleJSONString()), evaluation: hash(JSON.stringify(notes)) });
  }
  assert(scores.has('public/modules/defaultModule.json'), 'Expected the released startup canon');
  return scores;
}

const before = await snapshot(resolve(reference));
const after = await snapshot(candidate);
assert.deepEqual([...after.keys()], [...before.keys()], 'Tracked score paths changed');
for (const [path, digest] of before) assert.deepEqual(after.get(path), digest, path);
console.log(`${before.size} scores matched in canonical JSON, note kinds, exact values and dependencies. SHA-256 ${hash(JSON.stringify([...before]))}`);
