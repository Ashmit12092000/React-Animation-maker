/**
 * DragonBones renderer — thin wrapper around dragonbones-pixijs (pixi v8 official runtime).
 */
import * as PIXI from "pixi.js";
import { PixiFactory } from "dragonbones-pixijs";

export type { PixiArmatureDisplay } from "dragonbones-pixijs";

/** Load a PNG via fetch→blob so PIXI doesn't hit decode errors on some servers */
async function loadTextureFromUrl(url: string): Promise<PIXI.Texture> {
  // Try PIXI.Assets first (works when the server sends correct content-type)
  try {
    await PIXI.Assets.load(url);
    return PIXI.Assets.get(url);
  } catch (_) {
    // Fall back: fetch as blob → object URL → PIXI texture
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} loading ${url}`);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    await PIXI.Assets.load(objectUrl);
    return PIXI.Assets.get(objectUrl);
  }
}

export async function loadCharacter(
  skeletonUrl: string,
  atlasUrl: string,
  imageUrl: string,
  armatureName?: string
): Promise<{
  display: import("dragonbones-pixijs").PixiArmatureDisplay;
  animations: string[];
}> {
  // Load JSON files
  const [skeletonData, atlasData] = await Promise.all([
    fetch(skeletonUrl).then((r) => r.json()),
    fetch(atlasUrl).then((r) => r.json()),
  ]);

  // Load texture with fallback
  const texture = await loadTextureFromUrl(imageUrl);

  const factory = PixiFactory.factory;
  factory.parseDragonBonesData(skeletonData);
  factory.parseTextureAtlasData(atlasData, texture);

  const name = armatureName ?? skeletonData?.armature?.[0]?.name;
  if (!name) throw new Error("[DragonBones] No armature found in skeleton");

  const display = factory.buildArmatureDisplay(name)!;
  if (!display) throw new Error(`[DragonBones] Could not build armature: ${name}`);

  return { display, animations: display.animation.animationNames };
}