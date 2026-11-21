import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import ts from 'typescript';

interface SourceTree {
  label: string;
  read(path: string): Buffer | null;
}

export function diskTree(root: string): SourceTree {
  const dir = resolve(root);
  return {
    label: 'working tree',
    read(path) {
      const file = resolve(dir, path);
      return file.startsWith(dir + sep) && existsSync(file) ? readFileSync(file) : null;
    },
  };
}

export function gitTree(ref: string): SourceTree {
  const sha = execFileSync('git', ['rev-parse', '--verify', ref + '^{commit}'], { encoding: 'utf8' }).trim();
  const cache = new Map<string, Buffer | null>();
  return {
    label: `${ref} (${sha.slice(0, 7)})`,
    read(path) {
      const cached = cache.get(path);
      if (cached !== undefined) return cached;
      let body = null;
      try {
        body = execFileSync('git', ['show', `${sha}:${path}`], { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] });
      } catch { /* A module may exist only in the other source language. */ }
      cache.set(path, body);
      return body;
    },
  };
}

export function compileBrowserModule(path: string, source: string): string {
  return ts.transpileModule(source, {
    fileName: path,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      verbatimModuleSyntax: true,
      rewriteRelativeImportExtensions: true,
    },
  }).outputText;
}

const mime: Record<string, string> = {
  '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.m4a': 'audio/mp4',
};

/** Each source tree serves the same executable .js URLs. Old Git revisions supply
 * those bytes directly. A TS tree compiles the matching source file and emits
 * relative .js imports, keeping exactly one instance of the settings and engine. */
export function browserAsset(tree: SourceTree, path: string) {
  if (path.startsWith('src/') && path.endsWith('.js')) {
    const sourcePath = path.slice(0, -3) + '.ts';
    const source = tree.read(sourcePath);
    if (source !== null) return { contentType: 'text/javascript', body: compileBrowserModule(sourcePath, source.toString('utf8')) };
  }
  const body = tree.read(path.startsWith('src/') || path.startsWith('node_modules/') ? path : 'public/' + path);
  return body !== null ? { contentType: mime[extname(path)] ?? 'application/octet-stream', body }
    : { status: 404, contentType: 'text/plain', body: 'not found' };
}
