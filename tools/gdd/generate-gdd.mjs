// Renders the Game Design Document to docs/The-Beneath-GDD.docx.
// Content + verified scalars come from gdd-content.mjs. Styling mirrors the
// player-manual generator (tools/manual/generate-manual.mjs) so the two docs
// share a look. No images: the world map / navigation is rendered as text.
// Run: npm run gdd
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType,
  Footer, PageNumber,
} from 'docx';
import * as C from './gdd-content.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── palette ──────────────────────────────────────────────────────────────────
const CRIMSON = '7A0A0A';
const INK = '1A1A1A';
const MUTED = '5A5A5A';
const HEADER_BG = '7A0A0A';
const ALT_BG = 'F4ECEC';
const BORDER = 'D9CFCF';
const USABLE_TWIPS = 9936; // ~6.9in content width at 0.8in margins

// ── small builders ────────────────────────────────────────────────────────────
const run = (text, o = {}) => new TextRun({ text, ...o });

const para = (text, o = {}) =>
  new Paragraph({
    children: Array.isArray(text) ? text : [run(text, o.runOpts ?? {})],
    spacing: { after: o.after ?? 110, before: o.before ?? 0, line: 252 },
    alignment: o.align,
    ...o.paraOpts,
  });

const h1 = (text) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 200, after: 90 },
    keepNext: true,
    border: { bottom: { color: CRIMSON, space: 4, style: BorderStyle.SINGLE, size: 8 } },
    children: [run(text, { bold: true, color: CRIMSON, size: 28 })],
  });

const h2 = (text) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 140, after: 60 },
    keepNext: true,
    children: [run(text, { bold: true, color: INK, size: 23 })],
  });

const bullet = (text) =>
  new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 46, line: 250 },
    children: Array.isArray(text) ? text : [run(text)],
  });

const gap = (h = 48) => new Paragraph({ spacing: { after: h }, children: [] });

const cellBorders = () => ({
  top: { style: BorderStyle.SINGLE, size: 2, color: BORDER },
  bottom: { style: BorderStyle.SINGLE, size: 2, color: BORDER },
  left: { style: BorderStyle.SINGLE, size: 2, color: BORDER },
  right: { style: BorderStyle.SINGLE, size: 2, color: BORDER },
});

function cell(content, { header = false, fill, bold = false, align } = {}) {
  const runs = (Array.isArray(content) ? content : [content]).map((c) =>
    typeof c === 'string'
      ? run(c, { bold: bold || header, color: header ? 'FFFFFF' : INK })
      : c,
  );
  return new TableCell({
    margins: { top: 50, bottom: 50, left: 100, right: 100 },
    shading: header
      ? { type: ShadingType.CLEAR, fill: HEADER_BG }
      : fill
        ? { type: ShadingType.CLEAR, fill }
        : undefined,
    borders: cellBorders(),
    children: [new Paragraph({ alignment: align, spacing: { after: 0, line: 244 }, children: runs })],
  });
}

// headers: string[]; rows: (string|TextRun[])[][]; percents: number[] (sum 100)
function makeTable(headers, rows, percents, opts = {}) {
  const widths = percents.map((p) => Math.round((p / 100) * USABLE_TWIPS));
  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map((hd, i) => cell(hd, { header: true, align: opts.align?.[i] })),
  });
  const bodyRows = rows.map((r, ri) =>
    new TableRow({
      children: r.map((c, i) => cell(c, { fill: ri % 2 === 1 ? ALT_BG : undefined, align: opts.align?.[i] })),
    }),
  );
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: widths,
    rows: [headerRow, ...bodyRows],
  });
}

// Centered text "flow chart" node with a ↓ connector between nodes.
function flowNode(text, { last = false } = {}) {
  const out = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: last ? 0 : 30, before: 0, line: 252 },
      shading: { type: ShadingType.CLEAR, fill: ALT_BG },
      border: {
        top: { color: BORDER, space: 3, style: BorderStyle.SINGLE, size: 3 },
        bottom: { color: BORDER, space: 3, style: BorderStyle.SINGLE, size: 3 },
        left: { color: BORDER, space: 3, style: BorderStyle.SINGLE, size: 3 },
        right: { color: BORDER, space: 3, style: BorderStyle.SINGLE, size: 3 },
      },
      children: [run(text, { color: INK, size: 19, bold: true })],
    }),
  ];
  if (!last) {
    out.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 30, before: 0, line: 200 },
      children: [run('↓', { color: CRIMSON, size: 22, bold: true })],
    }));
  }
  return out;
}

// ── assemble document body ─────────────────────────────────────────────────────
const body = [];

// Title header (compact — no separate title page, to respect the 3–4 page limit)
body.push(
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 80, after: 40 },
    children: [run(C.TITLE, { bold: true, color: CRIMSON, size: 52 })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 60, line: 276 },
    children: [run(C.TAGLINE, { italics: true, color: INK, size: 21 })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 60 },
    border: { bottom: { color: CRIMSON, space: 6, style: BorderStyle.SINGLE, size: 10 } },
    children: [run(C.META, { color: MUTED, size: 17 })],
  }),
  gap(40),
);

// 1 · Game Title
body.push(h1('1 · Game Title'));
body.push(para([
  run('The Beneath', { bold: true }),
  run('  —  a single-player 2D action-adventure game that runs in the browser (HTML5 / Phaser, TypeScript). The player descends through a vast, collapsing cave system, fighting and sneaking past its monsters in search of a hidden portal to the lost surface.'),
]));

// 2 · Backstory
body.push(h1('2 · Backstory'));
for (const p of C.BACKSTORY) body.push(para(p));

// 3 · Characters
body.push(h1('3 · Characters'));
body.push(h2('The Player'));
body.push(para(C.MAIN_CHARACTER));
body.push(h2('Enemies'));
body.push(para(C.ENEMIES_INTRO));
body.push(makeTable(['Enemy', 'Type', 'Threat'], C.ENEMIES, [22, 18, 60]));
body.push(gap());
body.push(h2('Bosses'));
body.push(makeTable(
  ['Boss', 'Lair', 'Fights like', 'Key'],
  C.BOSSES.map(([n, l, s, k]) => [[run(n, { bold: true })], l, s, k]),
  [18, 18, 44, 20],
));
body.push(gap(50));
body.push(para(C.BOSS_NOTE, { runOpts: { color: MUTED } }));
body.push(h2('Friendly faces'));
body.push(para(C.NPCS));

// 4 · Gameplay
body.push(h1('4 · Gameplay'));
body.push(h2('Gameplay Mechanics'));
body.push(para('You control one survivor with the keyboard and mouse:'));
body.push(makeTable(['Input', 'Action'], C.CONTROLS, [30, 70]));
body.push(gap());
for (const [name, desc] of C.MECHANICS) {
  body.push(para([run(`${name}.  `, { bold: true, color: CRIMSON }), run(desc)]));
}
body.push(h2('Game Flow'));
body.push(para('The core loop repeats, one region at a time, all the way down:'));
body.push(makeTable(['Step', 'What it means'], C.FLOW, [22, 78]));
body.push(gap());
body.push(h2('Rules & Victory Conditions'));
for (const r of C.RULES) body.push(bullet(r));
body.push(gap(40));
body.push(para([run('How you win.  ', { bold: true, color: CRIMSON }), run(C.VICTORY)]));
body.push(para([run('How you lose.  ', { bold: true, color: CRIMSON }), run(C.DEFEAT)]));

// 5 · Game World
body.push(h1('5 · Game World'));
body.push(para(C.WORLD_INTRO));
body.push(h2('Three biomes'));
body.push(makeTable(
  ['Biome', 'Description'],
  C.BIOMES.map(([n, d]) => [[run(n, { bold: true })], d]),
  [22, 78],
));
body.push(gap(40));
body.push(h2('The three regions'));
body.push(makeTable(
  ['Region', 'Depth', 'What’s there', 'Boss', 'Key → Gate'],
  C.REGIONS.map(([r, d, w, b, k]) => [[run(r, { bold: true })], d, w, b, k]),
  [16, 14, 34, 18, 18],
));
body.push(gap(80));
body.push(h2('Sample map — how players navigate the world'));
body.push(para('There is no level-select screen; the world is one connected space, and locked boss-key doors enforce a strict descent. The path through it reads as a single line down:', { after: 90 }));
for (let i = 0; i < C.NAV_FLOW.length; i++) {
  for (const p of flowNode(C.NAV_FLOW[i], { last: i === C.NAV_FLOW.length - 1 })) body.push(p);
}

// 6 · Bonus Materials
body.push(h1('6 · Bonus Materials'));
body.push(h2('Achievements'));
body.push(para(C.ACHIEVEMENTS_INTRO));
body.push(makeTable(
  ['Achievement', 'How to earn it'],
  C.ACHIEVEMENTS.map(([n, h]) => [[run(n, { bold: true })], h]),
  [26, 74],
));
body.push(gap());
body.push(h2('Why players come back'));
for (const r of C.REPLAY) body.push(bullet(r));

// ── document ────────────────────────────────────────────────────────────────────
const doc = new Document({
  creator: 'The Beneath — GDD generator',
  title: 'The Beneath — Game Design Document',
  description: 'Game Design Document for The Beneath',
  styles: { default: { document: { run: { font: 'Calibri', size: 20, color: INK } } } },
  sections: [
    {
      properties: { page: { margin: { top: 1152, bottom: 1152, left: 1152, right: 1152 } } },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                run('The Beneath · Game Design Document    ', { color: MUTED, size: 16 }),
                new TextRun({ children: [PageNumber.CURRENT], color: MUTED, size: 16 }),
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
const outPath = resolve(outDir, 'The-Beneath-GDD.docx');
const buffer = await Packer.toBuffer(doc);
writeFileSync(outPath, buffer);
console.log(`Wrote ${outPath} (${(buffer.length / 1024).toFixed(0)} KB)`);
