// Renders the player's manual to docs/The-Beneath-Manual.docx.
// Content + verified scalars come from content.mjs; enemy/boss/trap stats are
// pulled from the live entityRegistry.json via registry.mjs so the bestiary can
// never drift from the game. Run: npm run manual
//
// Style: plain black text on white — no fills, no accent colours. Hierarchy
// comes from weight and size only, so the document stays simple to read.
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, TableOfContents,
  PageBreak, Footer, PageNumber,
} from 'docx';
import * as C from './content.mjs';
import { categorize, prettyName } from './registry.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── layout ────────────────────────────────────────────────────────────────────
const INK = '000000';        // every glyph is black
const BORDER = '000000';     // hairline table + heading rules
const USABLE_TWIPS = 9360;   // 6.5in content width at 1in margins

// ── small builders ───────────────────────────────────────────────────────────
const run = (text, o = {}) => new TextRun({ text, ...o });

const para = (text, o = {}) =>
  new Paragraph({
    children: Array.isArray(text) ? text : [run(text, o.runOpts ?? {})],
    spacing: { after: o.after ?? 120, before: o.before ?? 0, line: 276 },
    alignment: o.align,
    ...o.paraOpts,
  });

const h1 = (text) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 320, after: 140 },
    border: { bottom: { color: BORDER, space: 4, style: BorderStyle.SINGLE, size: 8 } },
    children: [run(text, { bold: true, size: 30 })],
  });

const h2 = (text) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 220, after: 90 },
    children: [run(text, { bold: true, size: 25 })],
  });

const h3 = (text) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 160, after: 60 },
    children: [run(text, { bold: true, size: 22 })],
  });

const bullet = (text) =>
  new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 60, line: 270 },
    children: Array.isArray(text) ? text : [run(text)],
  });

// A callout marked only by a thin left rule — no fill, no colour.
const tip = (text) =>
  new Paragraph({
    spacing: { before: 80, after: 140, line: 270 },
    indent: { left: 180 },
    border: { left: { color: BORDER, space: 10, style: BorderStyle.SINGLE, size: 12 } },
    children: [run('Tip  ', { bold: true }), run(text)],
  });

const cellBorders = () => ({
  top: { style: BorderStyle.SINGLE, size: 2, color: BORDER },
  bottom: { style: BorderStyle.SINGLE, size: 2, color: BORDER },
  left: { style: BorderStyle.SINGLE, size: 2, color: BORDER },
  right: { style: BorderStyle.SINGLE, size: 2, color: BORDER },
});

function cell(content, { header = false, bold = false, align } = {}) {
  const runs = (Array.isArray(content) ? content : [content]).map((c) =>
    typeof c === 'string' ? run(c, { bold: bold || header }) : c,
  );
  return new TableCell({
    margins: { top: 60, bottom: 60, left: 110, right: 110 },
    borders: cellBorders(),
    children: [
      new Paragraph({
        alignment: align,
        spacing: { after: 0, line: 264 },
        children: runs,
      }),
    ],
  });
}

// headers: string[]; rows: (string|TextRun[])[][]; percents: number[] (sum 100)
// The header row is set apart by bold text alone — no shading, no alt-row fill.
function makeTable(headers, rows, percents, opts = {}) {
  const widths = percents.map((p) => Math.round((p / 100) * USABLE_TWIPS));
  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map((hd, i) => cell(hd, { header: true, align: opts.align?.[i] })),
  });
  const bodyRows = rows.map((r) =>
    new TableRow({
      children: r.map((c, i) => cell(c, { align: opts.align?.[i] })),
    }),
  );
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: widths,
    rows: [headerRow, ...bodyRows],
  });
}

const gap = (h = 80) => new Paragraph({ spacing: { after: h }, children: [] });

// ── assemble document body ────────────────────────────────────────────────────
const body = [];
const reg = categorize();
const bossById = Object.fromEntries(reg.bosses.map((b) => [b.id, b]));

// Title page
body.push(
  new Paragraph({ spacing: { before: 2600 }, children: [] }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 80 },
    children: [run(C.TITLE, { bold: true, size: 72 })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 360 },
    children: [run(C.SUBTITLE, { size: 30, allCaps: true })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 120, line: 300 },
    children: [run(C.TAGLINE, { italics: true, size: 24 })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 2400 },
    children: [run('A guide to surviving the descent', { size: 20 })],
  }),
  new Paragraph({ children: [new PageBreak()] }),
);

// Table of contents
body.push(
  new Paragraph({ spacing: { after: 140 }, children: [run('Contents', { bold: true, size: 30 })] }),
  new TableOfContents('Contents', { hyperlink: true, headingStyleRange: '1-2' }),
  new Paragraph({ children: [new PageBreak()] }),
);

// 1. Overview
body.push(h1('1 · Overview'));
body.push(para(C.OVERVIEW.lead));
body.push(h2('The core loop'));
body.push(
  makeTable(
    ['Step', 'What it means'],
    C.OVERVIEW.loop.map(([n, d]) => [n, d]),
    [22, 78],
  ),
);
body.push(gap());
body.push(tip('New here? Read Controls and Combat next, then skim Stealth so you can read your exposure at a glance.'));

// 2. Controls
body.push(h1('2 · Controls'));
body.push(para('One character, keyboard and mouse. Debug keys are omitted here.'));
for (const grp of C.CONTROLS) {
  body.push(h3(grp.group));
  body.push(makeTable(['Input', 'Action'], grp.rows.map(([k, a]) => [k, a]), [28, 72]));
  body.push(gap(60));
}

// 3. Combat
body.push(h1('3 · Combat & Abilities'));
body.push(para(C.COMBAT.intro));
body.push(
  makeTable(
    ['Weapon', 'Input', 'Damage', 'Cost', 'How it works'],
    C.COMBAT.moves.map((m) => [m.name, m.keys, m.damage, m.cost, m.blurb]),
    [14, 16, 12, 14, 44],
  ),
);
body.push(gap());
body.push(tip('Sword and magic are silent; guns are loud and alert enemies through walls. Use blades to stay hidden, guns when you’ve already been seen.'));

// 4. Survival resources
body.push(h1('4 · Survival Resources'));
body.push(para('Five meters and two currencies decide how long you last. HUD: vitals top-left, resources top-right, weapon bottom-left.'));
body.push(
  makeTable(
    ['Resource', 'Amount', 'Details'],
    C.RESOURCES.map(([n, a, d]) => [n, a, d]),
    [18, 18, 64],
  ),
);
body.push(gap());
body.push(h3('Fall damage'));
body.push(para(C.FALL_DAMAGE));

// 5. Stealth & detection
body.push(h1('5 · Stealth & Detection'));
body.push(para(C.STEALTH.intro));
body.push(
  makeTable(
    ['Corner brackets', 'State', 'What it means'],
    C.STEALTH.states.map(([b, s, d]) => [b, s, d]),
    [20, 18, 62],
  ),
);
body.push(gap());
for (const f of C.STEALTH.facts) body.push(bullet(f));

// 6. Items & economy
body.push(h1('6 · Items & Economy'));
body.push(h2('Pickups'));
body.push(makeTable(['Pickup', 'Effect'], C.PICKUPS.map(([n, d]) => [n, d]), [24, 76]));
body.push(gap(80));
body.push(h2('In the world'));
body.push(makeTable(['Feature', 'Detail'], C.WORLD_FEATURES.map(([n, d]) => [n, d]), [24, 76]));
body.push(gap(80));
body.push(h2('Drop odds'));
body.push(para(C.DROP_ODDS));

// 7. Shops & upgrades
body.push(h1('7 · Shops & Upgrades'));
body.push(para(C.SHOPS.intro));
for (const shop of [C.SHOPS.techShop, C.SHOPS.mushroomMerchant]) {
  body.push(h3(shop.name));
  body.push(makeTable(['Item', 'Price'], shop.sells.map(([n, p]) => [n, p]), [70, 30], { align: [undefined, AlignmentType.RIGHT] }));
  body.push(gap(40));
  body.push(para(shop.upgrade));
}
body.push(h3('What coins are worth'));
body.push(makeTable(['Source', 'Coins'], C.SHOPS.coinValues.map(([n, v]) => [n, v]), [70, 30], { align: [undefined, AlignmentType.RIGHT] }));
body.push(gap());
body.push(tip('Capacity upgrades (Ammo Storage, Orb Pouch) are permanent and survive death — buy them before restocks when coins are tight.'));

// 8. Bestiary
body.push(h1('8 · Bestiary'));
body.push(para('Health already includes the global 1.5× scaling on non-boss foes — these are the numbers you actually fight. Damage is the per-hit range across an enemy’s attacks.'));

body.push(h2('Hostiles'));
body.push(
  makeTable(
    ['Enemy', 'HP', 'Damage', 'Behaviour & drops'],
    reg.enemies.map((e) => {
      const role = C.ENEMY_ROLES[e.id];
      const note = role ? role[1] : '';
      const flags = e.flags.length ? ' ' + e.flags.join('. ') + '.' : '';
      const drops = e.drops !== '—' ? ` Drops: ${e.drops}.` : '';
      return [
        [run(e.name, { bold: true }), run(role ? `  (${role[0]})` : '', { size: 18 })],
        String(e.hp),
        e.damageType !== 'Passive' ? `${e.damage} (${e.damageType})` : e.damage,
        `${note}${flags}${drops}`,
      ];
    }),
    [22, 8, 18, 52],
    { align: [undefined, AlignmentType.CENTER, undefined, undefined] },
  ),
);
body.push(gap());

body.push(h2('Non-hostiles & wildlife'));
body.push(para('Not everything underground wants you dead — though some are dangerous if provoked.'));
const passiveRows = [];
const spiritWalker = reg.passives.find((p) => /Spirit Walker/.test(p.name));
for (const p of reg.passives) {
  if (/Spirit Walker/.test(p.name)) continue;
  const role = C.PASSIVE_ROLES[p.id] ?? ['', ''];
  const flags = p.flags.length ? ' ' + p.flags.join('. ') + '.' : '';
  passiveRows.push([
    [run(p.name, { bold: true }), run(role[0] ? `  (${role[0]})` : '', { size: 18 })],
    String(p.hp),
    `${role[1]}${flags}`.trim(),
  ]);
}
if (spiritWalker) {
  const role = C.PASSIVE_ROLES.Spirit_walker_spawn;
  passiveRows.unshift([
    [run('Spirit Walkers', { bold: true }), run(`  (${role[0]})`, { size: 18 })],
    String(spiritWalker.hp),
    role[1],
  ]);
}
body.push(makeTable(['Creature', 'HP', 'Notes'], passiveRows, [24, 8, 68], { align: [undefined, AlignmentType.CENTER, undefined] }));
body.push(gap());

body.push(h2('Traps'));
body.push(para(C.TRAPS_INTRO));
body.push(makeTable(['Trap', 'Contact damage'], reg.traps.map((t) => [t.name, String(t.damage)]), [70, 30], { align: [undefined, AlignmentType.CENTER] }));

// 9. Bosses
body.push(h1('9 · Boss Compendium'));
body.push(para(C.BOSS_SYSTEM));
for (const b of C.BOSSES) {
  const stats = bossById[b.id] ?? {};
  body.push(h2(stats.name ?? prettyName(b.id)));
  body.push(
    makeTable(
      ['Location', 'Health', 'Attacks', 'Key dropped'],
      [[b.location, String(stats.hp ?? '—'), `${stats.damage ?? '—'} dmg (${stats.damageType ?? '—'})`, b.drops]],
      [20, 14, 46, 20],
      { align: [undefined, AlignmentType.CENTER, undefined, undefined] },
    ),
  );
  body.push(gap(40));
  body.push(para([run('Style.  ', { bold: true }), run(b.style)]));
  for (const r of b.rounds) body.push(bullet(r));
  body.push(para([run('Unlocks.  ', { bold: true }), run(b.unlocks)]));
}
body.push(gap(40));
body.push(para(C.BOSS_COMMON_DROPS));
body.push(tip(C.VICTORY.split('.')[0] + '. Defeating the final boss does not by itself win — stepping through the portal does.'));
body.push(para([run('Note.  ', { bold: true }), run(C.BOSS_NOTE_BLOOD_KING)]));

// 10. Progression
body.push(h1('10 · Levels & Progression'));
body.push(para(C.PROGRESSION.intro));
body.push(h3('Boss-key gates'));
body.push(makeTable(['Key (from boss)', 'Opens'], C.PROGRESSION.gates.map(([k, o]) => [k, o]), [50, 50]));
body.push(gap(60));
for (const n of C.PROGRESSION.notes) body.push(bullet(n));

// 11. Winning & losing
body.push(h1('11 · Winning & Losing'));
body.push(h2('How to win'));
body.push(para(C.VICTORY));
body.push(h2('How to lose'));
body.push(para(C.DEFEAT));

// 12. Settings
body.push(h1('12 · Pause & Settings'));
body.push(para(C.SETTINGS));

// 13. Cheat sheet (new page)
body.push(new Paragraph({ children: [new PageBreak()] }));
body.push(h1('Quick Reference'));
body.push(h3('Controls at a glance'));
const allControls = C.CONTROLS.flatMap((g) => g.rows);
body.push(makeTable(['Input', 'Action'], allControls.map(([k, a]) => [k, a]), [28, 72]));
body.push(gap());
body.push(h3('Need-to-know'));
[
  'Win by reaching the portal in Level 13 and holding E — not by killing the last boss.',
  'Three bosses, three keys: Shadow of Storms → key_storms, Tarnished Widow → key_widow, Heart Hoarder → key_heart.',
  'Sword & magic are silent; guns are loud and draw enemies through walls.',
  'Save at beacons (hold E). No save means death sends you back to the title screen.',
  'Spend coins on permanent capacity upgrades first — they survive death.',
  'Hearts 100 HP · Stamina 3 · Magic 3→10 · Pistol 12→30 · Shotgun 8→20 · Heals carry 5 (25 HP each).',
].forEach((t) => body.push(bullet(t)));

// ── document ──────────────────────────────────────────────────────────────────
const doc = new Document({
  creator: 'The Beneath — manual generator',
  title: 'The Beneath — Player’s Manual',
  description: 'Comprehensive player manual for The Beneath',
  features: { updateFields: true },
  styles: {
    default: {
      document: { run: { font: 'Calibri', size: 22, color: INK } },
    },
  },
  sections: [
    {
      properties: { page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                run('The Beneath · Player’s Manual    ', { size: 16 }),
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
const outPath = resolve(outDir, 'The-Beneath-Manual.docx');
const buffer = await Packer.toBuffer(doc);
writeFileSync(outPath, buffer);
console.log(`Wrote ${outPath} (${(buffer.length / 1024).toFixed(0)} KB)`);
console.log(`Bestiary: ${reg.bosses.length} bosses, ${reg.enemies.length} hostiles, ${reg.passives.length} non-hostiles, ${reg.traps.length} traps.`);
