// Tileset/level rendering effects: brightness lifts, foreground glow,
// and neon-sign flicker/pulsate.

// Per-tileset brightness lift applied at preload (RGB multiplier on each
// opaque pixel, clamped to 255). Used to compensate for tilesets whose source
// art ships visibly darker than peers stacked in the same level. uid=2
// (The_beneath_tileset1) backs every level's Foreground2 layer; the average-
// luminance ratio against uid=4 is ~1.24, but the eye perceives brightness
// non-linearly so the visible match lands well below that — tuned by feel.
export const TILESET_BRIGHTNESS_FACTORS: Readonly<Record<number, number>> = {
  2: 1.1,
};

// Per-LAYER brightness lift applied at render time via an ADD-blended sibling
// overlay. Use this when a foreground decoration layer needs to read brighter
// than the IntGrid ground it sits on, but they share the same tileset uid so
// TILESET_BRIGHTNESS_FACTORS can't differentiate them (lifting the tileset
// would brighten the ground too). The value is the total multiplier — 1.10 =
// 10% brighter — and the renderer derives the overlay alpha as (factor - 1).
// Cost: one extra draw call per tile in the listed layer.
export const LAYER_BRIGHTNESS_FACTORS: Readonly<Record<string, number>> = {
  Foreground1: 1.1,
};

// Foreground bright-pixel glow. Each tileset used by a Foreground* layer gets
// a sibling "glow" texture pre-baked at preload: every source pixel whose
// luminance exceeds FOREGROUND_GLOW_LUMINANCE_THRESHOLD has a soft radial halo
// painted at its position in the glow atlas. LevelRenderer then draws a second
// Image per foreground tile from that atlas with ADD blend, so bright dots
// emit a halo while the surrounding tile pixels stay unchanged against the
// darker background art. Toggle this flag to disable the effect entirely (no
// bake, no extra draw calls).
export const FOREGROUND_GLOW_ENABLED = true;
// LDtk layer identifier prefix that opts a layer into the glow pass. Matches
// "Foreground1", "Foreground2", "Foreground3" in the_beneath.ldtk. Other
// tile layers (Parallax*, IntGrid, Background*) are unaffected.
export const FOREGROUND_GLOW_LAYER_PREFIX = 'Foreground';
// Suffix appended to a tileset's texture key to address its sibling glow
// atlas. GlowAtlasBaker writes the atlas under `${tilesetTextureKey(uid)}${SUFFIX}`;
// LevelRenderer reads from the same key. Keep them in sync.
export const FOREGROUND_GLOW_TEXTURE_SUFFIX = '_glow';
// Luminance threshold (0..1, Rec.601 weights) above which a source pixel is
// treated as "bright" and gets a halo. 0.85 catches near-white dots (stars,
// candle highlights, lamp cores) while leaving stone/grass mid-tones alone.
// Raise if too many incidental highlights glow; lower to catch dimmer dots.
export const FOREGROUND_GLOW_LUMINANCE_THRESHOLD = 0.78;
// Halo radius in *source* pixels. Camera zoom multiplies the on-screen
// radius — at CAMERA_ZOOM=3, RADIUS_PX=3 becomes 9 canvas px. Smaller =
// tighter pinpricks; larger = soft bloom. The atlas is LINEAR-filtered so
// the halo stays smooth at any zoom.
export const FOREGROUND_GLOW_RADIUS_PX = 3;
// Alpha at the very center of a halo (r=0). The radial falloff fades from
// this value to 0 across RADIUS_PX. Overlapping halos accumulate additively
// in the bake, so a tight cluster of bright pixels reads brighter than a
// single isolated dot without each individual halo punching through.
// Multiplied at runtime by the container's flicker alpha, so this is the
// peak brightness of a single isolated halo when the flicker is at its
// maximum — the visible average sits lower (see FLICKER_* below).
export const FOREGROUND_GLOW_CORE_ALPHA = 0.4;
// Falloff curve exponent. alpha(r) = CORE_ALPHA * (1 - r/RADIUS)^EXPONENT.
// 1 = linear, 2 = quadratic (softer center → harder edge), 0.5 = sqrt
// (bright plateau, fast outer fade). 1.6 reads as a smooth wisp rather than
// a hard ring or a foggy blob.
export const FOREGROUND_GLOW_FALLOFF_EXPONENT = 1.6;

// Flicker: each foreground glow container gets a yoyo'd alpha tween between
// MIN and MAX, with a random duration in [DURATION_MIN, DURATION_MAX] and a
// random initial delay so neighboring containers fall out of phase. Visual
// effect: the dots breathe like candlelight rather than glowing steadily.
// Since the glow images use BlendModes.ADD, multiplying the container alpha
// directly scales the additive contribution per pixel.
export const FOREGROUND_GLOW_FLICKER_MIN_ALPHA = 0.45;
export const FOREGROUND_GLOW_FLICKER_MAX_ALPHA = 1.0;
// Period range per yoyo half-cycle (ms). A full bright→dim→bright loop
// takes DURATION × 2. Short enough to read as flicker, long enough to feel
// organic rather than strobed. Per-container random sample within the range
// is paired with a per-container random initial delay so the overall world
// never has every dot pulsing in lockstep.
export const FOREGROUND_GLOW_FLICKER_DURATION_MIN_MS = 280;
export const FOREGROUND_GLOW_FLICKER_DURATION_MAX_MS = 720;

// Neon sign flicker. Sign entities whose identifier is registered in
// SignTextureBaker get split into two textures at first render — a static
// "structure" image (frame, mounts) and a "lit" overlay (the colored
// letters/icons). Only the lit overlay receives the flicker tween, so the
// frame stays visible while the light buzzes on/off. The tween is a chain
// of randomized pulses: each "burst" plays 1-N rapid on/off pulses, then
// holds at full brightness for a random idle interval, then loops. Both
// the burst size, each pulse duration, and the idle interval are sampled
// independently per cycle — no two cycles look identical, and no two sign
// instances share a schedule.
//
// Alpha at the bottom of a flicker pulse. 0 cuts the lit overlay entirely
// (true off — the structure carries the sign through the dark beat); a small
// non-zero residual would keep a faint ghost glow visible at all times.
export const SIGN_FLICKER_DIM_ALPHA = 0.0;
// One "burst" is a sequence of 1-N rapid dim/bright pulses, separated by
// longer idle periods at full brightness. Larger max → noisier/more-broken
// neon; smaller max → calmer single-pulse flickers. Sampled per cycle.
export const SIGN_FLICKER_BURST_SIZE_MIN = 1;
export const SIGN_FLICKER_BURST_SIZE_MAX = 4;
// Per-pulse duration range in ms (one alpha transition, e.g. bright→dim or
// dim→bright). Short = abrupt strobe; long = soft pulse. 18-90ms reads as
// a buzzing fluorescent. Sampled independently for every transition so a
// single burst contains a mix of fast and slow pulses.
export const SIGN_FLICKER_PULSE_DURATION_MIN_MS = 18;
export const SIGN_FLICKER_PULSE_DURATION_MAX_MS = 90;
// Idle hold at full brightness between bursts. Lower bound caps the max
// flicker frequency. Sampled per cycle so the pattern stays irregular —
// a steady period would read as a metronome rather than a faulty light.
export const SIGN_FLICKER_INTERVAL_MIN_MS = 250;
export const SIGN_FLICKER_INTERVAL_MAX_MS = 1400;

// Pulsate: smooth sine-eased yoyo between MIN and MAX alpha on a lit
// overlay. Used by lit decorations whose config.mode is 'pulsate' (e.g.
// the small teal window dots on House2..House5) — visually a slow,
// organic "breathing" glow rather than the abrupt sign flicker. MIN > 0
// keeps the light visible at all times (a true off would read as a
// flicker, not a pulsate).
export const SIGN_PULSATE_MIN_ALPHA = 0.25;
export const SIGN_PULSATE_MAX_ALPHA = 1.0;
// Half-cycle duration (ms). One full breath (dim → bright → dim) takes
// DURATION × 2. Random per-instance sample within this range so neighboring
// house lights drift apart in phase and period — without the variance, a
// city block reads as a single synchronized strobe. Wider range = stronger
// drift over time; narrower = more uniform breathing.
export const SIGN_PULSATE_DURATION_MIN_MS = 550;
export const SIGN_PULSATE_DURATION_MAX_MS = 1300;
