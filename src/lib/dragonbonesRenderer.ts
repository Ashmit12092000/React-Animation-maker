/**
 * DragonBones renderer — singleton factory with cache guard.
 *
 * Key design decisions:
 * - PixiFactory is a global singleton in dragonbones-pixijs; calling
 *   parseDragonBonesData / parseTextureAtlasData more than once with the
 *   same name throws "already registered" errors and corrupts state.
 *   We guard with a simple boolean flag.
 * - advanceTime() must be called every frame via the PIXI ticker.
 *   We set that up once here so CanvasEditor doesn't have to.
 */

import * as PIXI from "pixi.js";
import { PixiFactory } from "dragonbones-pixijs";
export type { PixiArmatureDisplay } from "dragonbones-pixijs";

const SKE_URL = "/dragonbones/characte_2_ske.json";
const TEX_URL = "/dragonbones/characte_2_tex.json";
const IMG_URL = "/dragonbones/characte_2_tex.png";

let _factoryReady = false;
let _loadPromise: Promise<void> | null = null;

/** One-time load + parse of the DragonBones data into the global factory. */
async function ensureFactoryLoaded(): Promise<void> {
  if (_factoryReady) return;
  if (_loadPromise) return _loadPromise;

  _loadPromise = (async () => {
    const [skeletonData, atlasData] = await Promise.all([
      fetch(SKE_URL).then((r) => {
        if (!r.ok) throw new Error(`Failed to load skeleton: ${r.status} ${SKE_URL}`);
        return r.json();
      }),
      fetch(TEX_URL).then((r) => {
        if (!r.ok) throw new Error(`Failed to load atlas: ${r.status} ${TEX_URL}`);
        return r.json();
      }),
    ]);

    // Load texture — try PIXI.Assets first, fall back to blob URL
    let texture: PIXI.Texture;
    try {
      texture = await PIXI.Assets.load(IMG_URL);
    } catch {
      const res = await fetch(IMG_URL);
      if (!res.ok) throw new Error(`Failed to load texture: ${res.status} ${IMG_URL}`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      texture = await PIXI.Assets.load(objectUrl);
    }

    const factory = PixiFactory.factory;
    factory.parseDragonBonesData(skeletonData);
    factory.parseTextureAtlasData(atlasData, texture);

    _factoryReady = true;
    console.log("[DragonBones] Factory loaded successfully.");
  })();

  return _loadPromise;
}

/** Hook the PIXI ticker to advance DragonBones time. Call once per PIXI app. */
export function hookPixiTicker(app: PIXI.Application): void {
  app.ticker.add(() => {
    if (_factoryReady) {
      PixiFactory.factory.dragonBones?.advanceTime(app.ticker.deltaMS / 1000);
    }
  });
}

/**
 * Build a new armature display for the given animation name.
 * Returns the display and the list of available animation names.
 */
export async function loadCharacter(
  animationName?: string
): Promise<{
  display: import("dragonbones-pixijs").PixiArmatureDisplay;
  animations: string[];
}> {
  await ensureFactoryLoaded();

  const factory = PixiFactory.factory;
  // The armature name comes from the skeleton JSON armature[0].name
  const armatureName = "character";

  const display = factory.buildArmatureDisplay(armatureName);
  if (!display) throw new Error(`[DragonBones] Could not build armature: ${armatureName}`);

  // Hide IK target slots — they are rig control handles, not visual parts.
  // displayIndex = -1 tells DragonBones to render nothing for that slot
  // while keeping the IK constraints fully functional.
  for (const slot of display.armature.getSlots()) {
    if (slot.name.toLowerCase().includes("iktarget") || slot.name.toLowerCase().includes("ik_target")) {
      slot.displayIndex = -1;
    }
  }

  const animations: string[] = display.animation.animationNames;

  // Play the requested animation (or the first available one)
  const target =
    animations.find((a) => a.toLowerCase() === (animationName ?? "").toLowerCase()) ??
    animations[0];

  if (target) {
    display.animation.play(target, 0); // 0 = loop forever
    console.log("[DragonBones] Playing:", target, "| Available:", animations);
  }

  return { display, animations };
}