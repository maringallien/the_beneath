export type AnimationCategory =
  | 'movement'
  | 'attack'
  | 'state'
  | 'traversal'
  | 'ranged';

export interface FrameData {
  sheetWidth: number;
  sheetHeight: number;
  frameWidth: number;
  frameHeight: number;
  frameCount: number;
  anchorX?: number;
  // Frame row (1-based pixel from top of frame) where the body's bottom
  // edge should sit. Defaults to frameHeight (body bottom = frame bottom).
  anchorY?: number;
  startFrame?: number;
  ambiguous?: boolean;
}

export interface AnimationStage {
  startFrame: number;
  endFrame: number;
}

export interface SimpleAnimation {
  type: 'simple';
  key: string;
  file: string;
  category: AnimationCategory;
  loops: boolean;
  frames: FrameData;
  originalName: string;
  stages?: Record<string, AnimationStage>;
}

export interface CharacterModeRegistry {
  type: 'standard';
  id: string;
  path: string;
  mode?: string;
  animations: Record<string, SimpleAnimation>;
}

// Wheel-cycled character modes. sword_master_magic is intentionally NOT here
// — it's a sub-stance of sword_master selected via F, not a wheel stop.
export type CharacterModeId =
  | 'sword_master'
  | 'gunslinger_gun1'
  | 'gunslinger_gun2';

// Cross-mode action vocabulary. Player.ts speaks in these abstract keys; the
// resolver decides which concrete registry key (and frame) each mode plays.
export type LogicalAnimationKey =
  | 'idle'
  | 'walk'
  | 'run'
  | 'sprint'
  | 'fall'
  | 'wall_slide'
  | 'attack1'
  | 'attack2'
  | 'attack3'
  | 'attack4'
  | 'attack5'
  | 'attack6'
  | 'dash'
  | 'roll'
  | 'block'
  | 'ledge_climb'
  | 'jump'
  | 'death'
  | 'take_hit';

export interface ResolvedAnimation {
  registryKey: string;
}
