import Phaser from 'phaser';
import { SCENE_KEYS, ASSET_KEYS, GAME_HEIGHT } from '../constants';
import { Player } from '../entities/Player';
import {
  Projectile,
  type ProjectileSpawnOptions,
} from '../entities/Projectile';
import { ldtkRaw } from '../ldtk/ldtkData';
import { parseLevel, type ParsedLevel } from '../ldtk/parseLdtk';

const LEVEL_IDENTIFIER = 'Level_0';

export class GameScene extends Phaser.Scene {
  private player!: Player;
  private platforms!: Phaser.Physics.Arcade.StaticGroup;
  // Plain GameObjects.Group, not a physics group: Phaser.Physics.Arcade.Group's
  // createCallback re-applies its `defaults` to every added child's body —
  // including allowGravity:true and velocityX/Y:0 — clobbering the projectile's
  // own setup. Projectile creates its own dynamic body, so the group only needs
  // to be a collider container.
  private projectiles!: Phaser.GameObjects.Group;
  private level!: ParsedLevel;

  constructor() {
    super({ key: SCENE_KEYS.GAME });
  }

  create(): void {
    this.level = parseLevel(ldtkRaw, LEVEL_IDENTIFIER);
    this.physics.world.setBounds(0, 0, this.level.widthPx, this.level.heightPx);

    this.createPlatforms();
    this.createProjectileGroup();
    this.createPlayer();
    this.setupCollisions();
    this.setupCamera();
  }

  update(): void {
    this.player.update();
  }

  spawnProjectile(options: ProjectileSpawnOptions): void {
    const projectile = new Projectile(this, options);
    this.projectiles.add(projectile);
  }

  // TODO: replace with LDtk IntGrid collision once tile rendering is implemented.
  private createPlatforms(): void {
    this.platforms = this.physics.add.staticGroup();

    for (let x = 0; x < this.level.widthPx; x += 64) {
      this.platforms.create(x + 32, GAME_HEIGHT - 8, ASSET_KEYS.PLATFORM);
    }

    this.platforms.create(200, 450, ASSET_KEYS.PLATFORM);
    this.platforms.create(400, 350, ASSET_KEYS.PLATFORM);

    // 80x80 block with a usable top — exercises ledge_slide on the side
    // and ledge_climb at the corner. Spans x=800..880, y=504..584.
    this.createSizedPlatform(840, 544, 80, 80);
  }

  private createSizedPlatform(
    x: number,
    y: number,
    width: number,
    height: number,
  ): void {
    const block = this.platforms.create(
      x,
      y,
      ASSET_KEYS.PLATFORM,
    ) as Phaser.Physics.Arcade.Sprite;
    block.displayWidth = width;
    block.displayHeight = height;
    block.refreshBody();
  }

  private createProjectileGroup(): void {
    this.projectiles = this.add.group();
  }

  private createPlayer(): void {
    const { x, y } = this.level.playerSpawn;
    this.player = new Player(this, x, y);
  }

  private setupCollisions(): void {
    this.physics.add.collider(this.player, this.platforms);
    this.physics.add.collider(
      this.projectiles,
      this.platforms,
      this.onProjectilePlatformImpact,
      undefined,
      this,
    );
  }

  private onProjectilePlatformImpact: Phaser.Types.Physics.Arcade.ArcadePhysicsCallback =
    (projectile) => {
      if (projectile instanceof Projectile) {
        projectile.onImpact();
      }
    };

  private setupCamera(): void {
    this.cameras.main.setBounds(0, 0, this.level.widthPx, this.level.heightPx);
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
  }
}
