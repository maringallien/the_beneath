// verify-comments-only — proves a documentation pass changed comments only.
//
// Git-free snapshot workflow, correct even when a file already carries other
// uncommitted edits: snapshot a file's CURRENT bytes before documenting it, then
// after editing transpile both the snapshot and the working copy with
// `removeComments: true` and compare the emitted JS. Identical output ⇒ only
// comments changed; differing output ⇒ real code changed, which fails the check.
// This is the mechanical substitute for a test suite when asserting a
// comments-only diff across the codebase.
//
// Usage:
//   node tools/verify-comments-only.mjs snapshot <file...>   # before editing
//   node tools/verify-comments-only.mjs check    <file...>   # after editing
//
// 'snapshot' copies each file verbatim into the baseline dir (under the system
// temp, so it never shows in the working tree). 'check' compares each file
// against its snapshot and exits non-zero if any file's code changed.

import { mkdirSync, copyFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import ts from 'typescript';

const BASELINE_DIR = join(tmpdir(), 'the-beneath-doc-verify');

// Strip comments by transpiling the source to JS with removeComments on.
const stripped = (source, fileName) =>
  ts.transpileModule(source, {
    fileName,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      removeComments: true,
      // Newlines normalized so a CRLF/LF drift never reads as a code change.
      newLine: ts.NewLineKind.LineFeed,
    },
    reportDiagnostics: false,
  }).outputText;

const [mode, ...files] = process.argv.slice(2);

if (!mode || !['snapshot', 'check'].includes(mode) || files.length === 0) {
  console.error('usage: verify-comments-only.mjs <snapshot|check> <file...>');
  process.exit(2);
}

if (mode === 'snapshot') {
  for (const file of files) {
    const dest = join(BASELINE_DIR, file);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(file, dest);
  }
  console.log(`snapshotted ${files.length} file(s) → ${BASELINE_DIR}`);
  process.exit(0);
}

// mode === 'check'
let failed = 0;
let missing = 0;
for (const file of files) {
  const base = join(BASELINE_DIR, file);
  if (!existsSync(base)) {
    console.log(`MISS  ${file} (no snapshot — run 'snapshot' first)`);
    missing += 1;
    continue;
  }
  const before = stripped(readFileSync(base, 'utf8'), file);
  const after = stripped(readFileSync(file, 'utf8'), file);
  if (before === after) {
    console.log(`PASS  ${file}`);
  } else {
    console.log(`FAIL  ${file} — code changed, not just comments`);
    failed += 1;
  }
}

console.log(
  `\n${files.length - failed - missing} passed, ${failed} failed, ${missing} missing`,
);
process.exit(failed > 0 || missing > 0 ? 1 : 0);
