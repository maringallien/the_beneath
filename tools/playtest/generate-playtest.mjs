// Renders the manual playtest checklist to docs/The-Beneath-Playtest-Plan.docx.
// Content comes from playtest-content.mjs; the enemy/trap rosters are pulled from
// the live entityRegistry.json (via the manual's registry.mjs) so they never drift.
// Style: plain black on white — no fills, no colour. Hierarchy is weight and size
// only, matching the player manual. Run: npm run playtest
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, Footer, PageNumber,
} from 'docx';
import * as C from './playtest-content.mjs';
import { categorize } from '../manual/registry.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── layout ────────────────────────────────────────────────────────────────────
const INK = '000000';      // every glyph is black
const BORDER = '000000';   // hairline table + heading rules
const USABLE_TWIPS = 9360; // 6.5in content width at 1in margins

// ── small builders ───────────────────────────────────────────────────────────
const run = (text, o = {}) => new TextRun({ text, ...o });

const para = (text, o = {}) =>
  new Paragraph({
    children: Array.isArray(text) ? text : [run(text, o.runOpts ?? {})],
    spacing: { after: o.after ?? 120, before: o.before ?? 0, line: 276 },
    alignment: o.align,
  });

const h1 = (text) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 300, after: 130 },
    keepNext: true,
    border: { bottom: { color: BORDER, space: 4, style: BorderStyle.SINGLE, size: 8 } },
    children: [run(text, { bold: true, size: 28 })],
  });

const bullet = (text) =>
  new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 60, line: 272 },
    children: [run(text)],
  });

const gap = (h = 80) => new Paragraph({ spacing: { after: h }, children: [] });

const cellBorders = () => ({
  top: { style: BorderStyle.SINGLE, size: 2, color: BORDER },
  bottom: { style: BorderStyle.SINGLE, size: 2, color: BORDER },
  left: { style: BorderStyle.SINGLE, size: 2, color: BORDER },
  right: { style: BorderStyle.SINGLE, size: 2, color: BORDER },
});

// Plain cell — header rows are set apart by bold text alone, no shading.
function cell(content, { header = false, align } = {}) {
  const runs = (Array.isArray(content) ? content : [content]).map((c) =>
    typeof c === 'string' ? run(c, { bold: header }) : c,
  );
  return new TableCell({
    margins: { top: 56, bottom: 56, left: 110, right: 110 },
    borders: cellBorders(),
    children: [new Paragraph({ alignment: align, spacing: { after: 0, line: 264 }, children: runs })],
  });
}

// headers: string[]; rows: (string|TextRun[])[][]; percents sum 100.
function makeTable(headers, rows, percents, opts = {}) {
  const widths = percents.map((p) => Math.round((p / 100) * USABLE_TWIPS));
  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map((hd, i) => cell(hd, { header: true, align: opts.align?.[i] })),
  });
  const bodyRows = rows.map((r) =>
    new TableRow({ children: r.map((c, i) => cell(c, { align: opts.align?.[i] })) }),
  );
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: widths,
    rows: [headerRow, ...bodyRows],
  });
}

// A blank Pass/Fail box for the Result column.
const resultCell = () =>
  new TableCell({
    margins: { top: 56, bottom: 56, left: 110, right: 110 },
    borders: cellBorders(),
    children: [new Paragraph({
      spacing: { after: 0, line: 264 },
      children: [run('☐ Pass', { size: 18 }), run('', { break: 1 }), run('☐ Fail', { size: 18 })],
    })],
  });

// Check | Expected | Result, one row per [check, expected] pair.
function checkTable(checks) {
  const widths = [45, 43, 12].map((p) => Math.round((p / 100) * USABLE_TWIPS));
  const headerRow = new TableRow({
    tableHeader: true,
    children: [cell('Check', { header: true }), cell('Expected', { header: true }), cell('Result', { header: true, align: AlignmentType.CENTER })],
  });
  const rows = checks.map(([check, expected]) =>
    new TableRow({ children: [cell(check), cell(expected), resultCell()] }),
  );
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, columnWidths: widths, rows: [headerRow, ...rows] });
}

// ── live-registry rosters ───────────────────────────────────────────────────────
const reg = categorize();

function enemyTable() {
  const behaviour = (e) => `${e.damageType}, ${e.damage} dmg${e.flags.length ? ` · ${e.flags[0]}` : ''}`;
  return makeTable(
    ['Enemy', 'HP', 'Behaviour to verify', 'Done'],
    reg.enemies.map((e) => [[run(e.name, { bold: true })], String(e.hp), behaviour(e), '☐']),
    [26, 8, 54, 12],
    { align: [undefined, AlignmentType.CENTER, undefined, AlignmentType.CENTER] },
  );
}

function trapTable() {
  return makeTable(
    ['Trap', 'Contact damage', 'Done'],
    reg.traps.map((t) => [t.name, String(t.damage), '☐']),
    [60, 26, 14],
    { align: [undefined, AlignmentType.CENTER, AlignmentType.CENTER] },
  );
}

// ── assemble document body ──────────────────────────────────────────────────────
const body = [];

// Compact title block (no separate title page).
body.push(
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120, after: 50 }, children: [run(C.TITLE, { bold: true, size: 52 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 }, children: [run(C.SUBTITLE, { size: 26, allCaps: true })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40, line: 280 }, children: [run(C.TAGLINE, { italics: true, size: 20 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, border: { bottom: { color: BORDER, space: 6, style: BorderStyle.SINGLE, size: 10 } }, children: [run(C.META, { size: 17 })] }),
  gap(60),
);

// Setup & how to use
body.push(h1('Setup & How to Use'));
for (const b of C.SETUP) body.push(bullet(b));
body.push(gap(40));
body.push(makeTable(['Input', 'Action'], C.CONTROLS, [26, 74]));

// Test sections
C.SECTIONS.forEach((sec, i) => {
  body.push(h1(`${i + 1} · ${sec.title}`));
  if (sec.intro) body.push(para(sec.intro));
  if (sec.table) {
    const rows = typeof sec.table.rows === 'string' ? C[sec.table.rows] : sec.table.rows;
    body.push(makeTable(sec.table.headers, rows, sec.table.widths));
    body.push(gap(60));
  }
  if (sec.inject === 'enemies') { body.push(enemyTable()); body.push(gap(60)); }
  if (sec.inject === 'traps') { body.push(trapTable()); body.push(gap(60)); }
  body.push(checkTable(sec.checks));
});

// Reporting
body.push(h1('Reporting Issues'));
for (const b of C.REPORTING) body.push(bullet(b));

// ── document ────────────────────────────────────────────────────────────────────
const totalChecks = C.SECTIONS.reduce((a, s) => a + s.checks.length, 0);

const doc = new Document({
  creator: 'The Beneath — playtest-checklist generator',
  title: 'The Beneath — Manual Playtest Checklist',
  description: 'Manual playtest checklist for The Beneath',
  styles: { default: { document: { run: { font: 'Calibri', size: 21, color: INK } } } },
  sections: [
    {
      properties: { page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                run('The Beneath · Playtest Checklist    ', { size: 16 }),
                new TextRun({ children: [PageNumber.CURRENT], size: 16 }),
              ],
            }),
          ],
        }),
      },
      children: body,
    },
  ],
});

const outDir = resolve(__dirname, '../../docs');
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, 'The-Beneath-Playtest-Plan.docx');
const buffer = await Packer.toBuffer(doc);
writeFileSync(outPath, buffer);
console.log(`Wrote ${outPath} (${(buffer.length / 1024).toFixed(0)} KB)`);
console.log(`${C.SECTIONS.length} sections, ${totalChecks} checks, plus a ${reg.enemies.length}-enemy and ${reg.traps.length}-trap roster.`);
