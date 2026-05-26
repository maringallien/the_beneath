import { writeFile } from 'node:fs/promises';
import { resolve as pathResolve, join as pathJoin } from 'node:path';

// Single allow-listed target file. The save plugin only writes here — any
// other path is rejected before any filesystem call, so path traversal is
// structurally impossible (we never receive a filename from the client).
const TARGET_REL_PATH = 'src/audio/animationSoundTriggers.json';
const ALLOWED_BASE_DIRS = ['src/audio'];

const ENDPOINT = '/__anim-sound-aligner/save';
const TRIGGER_NAME_REGEX = /^[A-Za-z0-9_]+$/;
const SOUND_ID_REGEX = /^[A-Za-z0-9_]+$/;
const ANIM_KEY_REGEX = /^[A-Za-z0-9_]+$/;

function readRequestBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        resolveBody(Buffer.concat(chunks).toString('utf8'));
      } catch (err) {
        rejectBody(err);
      }
    });
    req.on('error', rejectBody);
  });
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

// Strict whole-payload validation. The tool sends the entire intended file
// contents — the server writes them verbatim after validation, no merge.
// This keeps the contract simple: what you see in the tool is what's on
// disk after save.
function validate(raw) {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, message: 'Body must be a JSON object.' };
  }
  for (const key of Object.keys(raw)) {
    if (key !== 'triggers') {
      return { ok: false, message: `Unexpected top-level key "${key}".` };
    }
  }
  const { triggers } = raw;
  if (!triggers || typeof triggers !== 'object') {
    return { ok: false, message: 'triggers must be an object.' };
  }
  for (const [animKey, list] of Object.entries(triggers)) {
    if (!ANIM_KEY_REGEX.test(animKey)) {
      return {
        ok: false,
        message: `Animation key "${animKey}" must match /^[A-Za-z0-9_]+$/.`,
      };
    }
    if (!Array.isArray(list)) {
      return {
        ok: false,
        message: `triggers["${animKey}"] must be an array.`,
      };
    }
    const seenNames = new Set();
    for (const entry of list) {
      if (!entry || typeof entry !== 'object') {
        return {
          ok: false,
          message: `triggers["${animKey}"] contains a non-object entry.`,
        };
      }
      for (const key of Object.keys(entry)) {
        if (
          key !== 'name' &&
          key !== 'soundId' &&
          key !== 'frameIndex' &&
          key !== 'audioStartOffsetMs'
        ) {
          return {
            ok: false,
            message: `triggers["${animKey}"] has unexpected key "${key}".`,
          };
        }
      }
      const { name, soundId, frameIndex, audioStartOffsetMs } = entry;
      if (typeof name !== 'string' || !TRIGGER_NAME_REGEX.test(name)) {
        return {
          ok: false,
          message: `triggers["${animKey}"].name must match /^[A-Za-z0-9_]+$/.`,
        };
      }
      if (seenNames.has(name)) {
        return {
          ok: false,
          message: `triggers["${animKey}"] has duplicate name "${name}".`,
        };
      }
      seenNames.add(name);
      if (typeof soundId !== 'string' || !SOUND_ID_REGEX.test(soundId)) {
        return {
          ok: false,
          message: `triggers["${animKey}"].soundId must match /^[A-Za-z0-9_]+$/.`,
        };
      }
      if (
        typeof frameIndex !== 'number' ||
        !Number.isInteger(frameIndex) ||
        frameIndex < 1
      ) {
        return {
          ok: false,
          message: `triggers["${animKey}"].frameIndex must be a positive integer.`,
        };
      }
      if (audioStartOffsetMs !== undefined) {
        if (
          typeof audioStartOffsetMs !== 'number' ||
          !Number.isFinite(audioStartOffsetMs) ||
          audioStartOffsetMs < 0
        ) {
          return {
            ok: false,
            message: `triggers["${animKey}"].audioStartOffsetMs must be a non-negative number.`,
          };
        }
      }
    }
  }
  return { ok: true, payload: { triggers } };
}

export function animSoundAlignerSavePlugin() {
  return {
    name: 'anim-sound-aligner-save',
    // Dev-server only — never ships to the production build.
    apply: 'serve',
    configureServer(server) {
      const root = server.config.root;
      server.middlewares.use(ENDPOINT, async (req, res) => {
        if (req.method !== 'POST') {
          send(res, 405, { error: 'Method not allowed' });
          return;
        }
        let body;
        try {
          const raw = await readRequestBody(req);
          body = JSON.parse(raw);
        } catch (err) {
          send(res, 400, { error: 'Invalid JSON', detail: String(err) });
          return;
        }
        const validation = validate(body);
        if (!validation.ok) {
          send(res, 400, { error: validation.message });
          return;
        }
        const filePath = pathResolve(pathJoin(root, TARGET_REL_PATH));
        // Belt + suspenders: even though the relative path is hardcoded,
        // confirm the resolved absolute path lives under an allow-listed
        // base directory. Defends against a misconfigured project root.
        const inAllowedDir = ALLOWED_BASE_DIRS.some((baseDir) =>
          filePath.startsWith(pathResolve(pathJoin(root, baseDir))),
        );
        if (!inAllowedDir) {
          send(res, 400, {
            error: 'Resolved path escapes allowed save directories.',
          });
          return;
        }
        try {
          const content = `${JSON.stringify(validation.payload, null, 2)}\n`;
          await writeFile(filePath, content, 'utf8');
          send(res, 200, {
            ok: true,
            written: TARGET_REL_PATH,
            count: Object.keys(validation.payload.triggers).length,
          });
        } catch (err) {
          send(res, 500, { error: 'Save failed', detail: String(err) });
        }
      });
    },
  };
}
