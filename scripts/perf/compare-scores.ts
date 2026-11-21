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

function trackedScorePaths(root: string) {
  return execFileSync('git', ['-C', root, 'ls-files', '-z', '--', 'public/modules',
    'scripts/fixtures/old-time', 'scripts/fixtures/legacy-syntax'], { encoding: 'utf8' })
    .split('\0').filter(path => path.endsWith('.json'))
    .filter(path => !path.startsWith('public/modules/') || !['index.json', 'library.json'].includes(basename(path)))
    .sort();
}

async function loadRuntime(root: string) {
  // Static types describe the shared musical API. Each worktree supplies its
  // implementation and dependencies.
  const model: typeof import('../../src/module.ts') = await runtimeModule(root, 'module');
  const noteApi: typeof import('../../src/note.ts') = await runtimeModule(root, 'note');
  const exact: typeof import('../../src/value/exact.ts') = await runtimeModule(root, 'value/exact');
  return async function snapshot(text: string, path: string) {
    // Parse a fresh copy for each engine, including for in-place legacy migrations.
    const input: unknown = JSON.parse(text);
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
    return { notes: notes.length, save: hash(score.createModuleJSONString()), evaluation: hash(JSON.stringify(notes)) };
  };
}

const paths = trackedScorePaths(reference);
assert.deepEqual(trackedScorePaths(candidate), paths, 'Tracked score paths changed');
assert(paths.includes('public/modules/defaultModule.json'), 'Expected the released startup canon');

const baselineSnapshot = await loadRuntime(reference);
const candidateSnapshot = await loadRuntime(candidate);

async function compareInput(text: string, path: string, source: 'reference' | 'candidate') {
  const before = await baselineSnapshot(text, path);
  const after = await candidateSnapshot(text, path);
  assert.deepEqual(after, before, source + ' input: ' + path);
  return before;
}

const releaseScores = new Map<string, Awaited<ReturnType<typeof compareInput>>>();
const changedScores = new Map<string, Awaited<ReturnType<typeof compareInput>>>();
for (const path of paths) {
  const [releaseInput, candidateInput] = await Promise.all([
    readFile(resolve(reference, path), 'utf8'), readFile(resolve(candidate, path), 'utf8'),
  ]);
  releaseScores.set(path, await compareInput(releaseInput, path, 'reference'));
  if (candidateInput !== releaseInput) {
    changedScores.set(path, await compareInput(candidateInput, path, 'candidate'));
  }
}

console.log('Reference inputs matched across both engines in canonical JSON, note kinds, exact values and dependencies.');
console.log(releaseScores.size + ' reference scores. SHA-256 ' + hash(JSON.stringify([...releaseScores])));
console.log(changedScores.size + ' changed candidate inputs also matched across both engines. SHA-256 ' + hash(JSON.stringify([...changedScores])));
