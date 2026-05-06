#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const PROJECT_ROOT = '/home/marin/Documents/platformer_game';
const LDTK_FILE = path.join(PROJECT_ROOT, 'the_beneath.ldtk');
const STATEMENT_PIECES_DIR = path.join(
  PROJECT_ROOT,
  'public/DarkSpriteLib/the_beneath/parallax/statement_pieces',
);
const TILE_GRID_SIZE = 16;

function getPngDimensions(filePath) {
  const buf = fs.readFileSync(filePath);
  if (
    buf[0] !== 0x89 ||
    buf[1] !== 0x50 ||
    buf[2] !== 0x4e ||
    buf[3] !== 0x47 ||
    buf[4] !== 0x0d ||
    buf[5] !== 0x0a ||
    buf[6] !== 0x1a ||
    buf[7] !== 0x0a
  ) {
    throw new Error(`Not a PNG: ${filePath}`);
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function walkDir(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkDir(full));
    else if (entry.name.toLowerCase().endsWith('.png')) out.push(full);
  }
  return out;
}

function shouldInclude(relPath) {
  const filename = path.basename(relPath);
  if (/^layer_\d+\.png$/i.test(filename)) return false;
  if (/^bg_\d+\.png$/i.test(filename)) return false;
  if (relPath.endsWith(path.join('the_circle', 'red_circle', 'circle.png'))) {
    return false;
  }
  return true;
}

function pathToIdentifier(relPath) {
  let id = relPath.replace(/\.png$/i, '');
  id = id.split(path.sep).join('_');
  id = id.replace(/[()+\-\s]/g, '_');
  id = id.replace(/_+/g, '_');
  id = id.replace(/^_+|_+$/g, '');
  id = 'Tb_' + id;
  return id.charAt(0).toUpperCase() + id.slice(1);
}

function getCategory(relPath) {
  return relPath.split(path.sep)[0];
}

function buildTilesetEntry(item, uid) {
  const cWid = Math.max(1, Math.ceil(item.pxWid / TILE_GRID_SIZE));
  const cHei = Math.max(1, Math.ceil(item.pxHei / TILE_GRID_SIZE));
  return `\t\t{
\t\t\t"__cWid": ${cWid},
\t\t\t"__cHei": ${cHei},
\t\t\t"identifier": "${item.identifier}",
\t\t\t"uid": ${uid},
\t\t\t"relPath": "${item.projectRelPath}",
\t\t\t"embedAtlas": null,
\t\t\t"pxWid": ${item.pxWid},
\t\t\t"pxHei": ${item.pxHei},
\t\t\t"tileGridSize": ${TILE_GRID_SIZE},
\t\t\t"spacing": 0,
\t\t\t"padding": 0,
\t\t\t"tags": ["statement_piece", "${item.category}"],
\t\t\t"tagsSourceEnumUid": null,
\t\t\t"enumTags": [],
\t\t\t"customData": [],
\t\t\t"savedSelections": [],
\t\t\t"cachedPixelData": null
\t\t}`;
}

function main() {
  console.log('Scanning statement_pieces...');
  const all = walkDir(STATEMENT_PIECES_DIR);
  console.log(`Found ${all.length} PNGs total.`);

  const manifest = [];
  const skipped = [];
  for (const full of all) {
    const rel = path.relative(STATEMENT_PIECES_DIR, full);
    if (!shouldInclude(rel)) {
      skipped.push(rel);
      continue;
    }
    const dims = getPngDimensions(full);
    manifest.push({
      relPath: rel,
      projectRelPath: path.relative(PROJECT_ROOT, full),
      identifier: pathToIdentifier(rel),
      category: getCategory(rel),
      pxWid: dims.width,
      pxHei: dims.height,
    });
  }

  console.log(`Including ${manifest.length}, skipping ${skipped.length}.`);

  // Detect duplicate identifiers within manifest
  const idCounts = new Map();
  for (const m of manifest) {
    idCounts.set(m.identifier, (idCounts.get(m.identifier) || 0) + 1);
  }
  const dupes = [...idCounts.entries()].filter(([, n]) => n > 1);
  if (dupes.length) {
    throw new Error(`Duplicate identifiers in manifest: ${JSON.stringify(dupes)}`);
  }

  // Read and parse the LDtk file
  console.log('Reading LDtk file...');
  const ldtkText = fs.readFileSync(LDTK_FILE, 'utf8');
  const parsed = JSON.parse(ldtkText);

  const existingIds = new Set(parsed.defs.tilesets.map((t) => t.identifier));
  const collisions = manifest
    .map((m) => m.identifier)
    .filter((id) => existingIds.has(id));
  if (collisions.length) {
    throw new Error(`Identifier collisions with existing tilesets: ${collisions.join(', ')}`);
  }

  let nextUid = parsed.nextUid;
  console.log(`Starting nextUid: ${nextUid}`);

  const newEntries = manifest.map((m) => {
    const e = buildTilesetEntry(m, nextUid);
    nextUid++;
    return e;
  });
  console.log(`Final nextUid: ${nextUid}`);

  // Insert before closing of tilesets array. The unique pattern at the close is:
  //   \t\t}\n\t], "enums":
  const insertionRegex = /(\t\t\})\n(\t\], "enums":)/;
  if (!insertionRegex.test(ldtkText)) {
    throw new Error('Could not find tilesets-array close pattern.');
  }

  const newBlock = newEntries.join(',\n');
  let updated = ldtkText.replace(
    insertionRegex,
    `$1,\n${newBlock}\n$2`,
  );

  // Update nextUid line
  const nextUidRegex = /"nextUid":\s*\d+,/;
  if (!nextUidRegex.test(updated)) {
    throw new Error('Could not find nextUid field.');
  }
  updated = updated.replace(nextUidRegex, `"nextUid": ${nextUid},`);

  // Validate before write
  console.log('Validating JSON...');
  const reparsed = JSON.parse(updated);
  if (reparsed.defs.tilesets.length !== parsed.defs.tilesets.length + manifest.length) {
    throw new Error('Tileset count after insert does not match expected.');
  }
  if (reparsed.nextUid !== nextUid) {
    throw new Error('nextUid mismatch after update.');
  }

  // Atomic write
  const tmp = LDTK_FILE + '.tmp';
  fs.writeFileSync(tmp, updated);
  fs.renameSync(tmp, LDTK_FILE);

  console.log('\n--- Imported tilesets ---');
  for (const m of manifest) {
    console.log(`  ${m.identifier.padEnd(60)} ${m.pxWid}x${m.pxHei}`);
  }
  console.log(`\nDone. Added ${manifest.length} tilesets.`);
}

main();
