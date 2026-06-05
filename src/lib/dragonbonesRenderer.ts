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

// Use import.meta.env.BASE_URL so that URLs are always absolute and correct
// regardless of the page's current path. Without this, relative URLs like
// "dragonbones/file.json" would silently break whenever the app is served
// under a sub-path (e.g. base: "/animate/") and the server's SPA fallback
// or a proxy injects extra content into the response after the JSON bytes,
// causing JSON.parse to throw "Unexpected non-whitespace character after JSON
// at position <filesize>".
const _BASE = import.meta.env.BASE_URL.replace(/\/$/, ""); // strip trailing slash
const SKE_URL = `${_BASE}/dragonbones/characte_2_ske.json`;
const TEX_URL = `${_BASE}/dragonbones/characte_2_tex.json`;
const IMG_URL = `${_BASE}/dragonbones/characte_2_tex.png`;

let _factoryReady = false;
let _loadPromise: Promise<void> | null = null;

/**
 * Walk a JSON string and return the index of the character immediately after
 * the first complete top-level JSON value (object or array).
 *
 * This handles the "file sent twice" server bug: the response body is
 * <valid-json><same-valid-json> (length = 2x file size). Trimming from the
 * last closing brace leaves the full doubled string, which is still invalid.
 * We need to find where the FIRST value ends.
 *
 * The algorithm tracks brace/bracket depth and skips string literals
 * (including escaped characters) so it is not confused by braces inside
 * string values.
 */
function findFirstJsonEnd(s: string): number {
  let i = 0;
  const len = s.length;

  // Skip leading whitespace
  while (i < len && (s[i] === " " || s[i] === "\t" || s[i] === "\n" || s[i] === "\r")) i++;
  if (i === len) return -1;

  const opener = s[i];
  if (opener !== "{" && opener !== "[") return -1;

  const closer = opener === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;

  for (; i < len; i++) {
    const ch = s[i];
    if (inString) {
      if (ch === "\\") { i++; } // skip escaped char
      else if (ch === '"') { inString = false; }
      continue;
    }
    if (ch === '"') { inString = true; }
    else if (ch === opener) { depth++; }
    else if (ch === closer) {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/**
 * Fetch a JSON asset robustly.
 *
 * Production servers can corrupt the response in several ways:
 *   - Append a trailing newline or small suffix  -> "unexpected char at position N"
 *   - Send the file body twice (nginx gzip+sendfile bug) -> response = JSON+JSON,
 *     length = 2x file size; trimming from the last brace still leaves invalid JSON
 *   - Fall back to index.html for unresolved paths -> Content-Type: text/html
 *
 * Strategy:
 *   1. Detect HTML responses early (SPA fallback).
 *   2. Fast path: JSON.parse on raw text.
 *   3. Slow path: use findFirstJsonEnd() to extract exactly the first complete
 *      JSON value and discard everything after it, then parse that slice.
 */
async function fetchJson(url: string, label: string): Promise<unknown> {
  const r = await fetch(url);
  if (!r.ok) {
    throw new Error(`[DragonBones] Failed to fetch ${label}: HTTP ${r.status} - ${url}`);
  }

  const ct = r.headers.get("content-type") ?? "";
  if (ct.includes("text/html")) {
    throw new Error(
      `[DragonBones] Server returned HTML instead of JSON for ${label}. ` +
      `Check that "${url}" is reachable and not falling back to index.html.`
    );
  }

  const raw = await r.text();

  // Fast path - clean response.
  try {
    return JSON.parse(raw);
  } catch {
    // Slow path - extract exactly the first complete JSON value.
    // Handles: trailing bytes, doubled responses (file sent twice by server), etc.
    const end = findFirstJsonEnd(raw);
    if (end !== -1 && end < raw.length) {
      const trimmed = raw.slice(0, end);
      try {
        const parsed = JSON.parse(trimmed);
        console.warn(
          `[DragonBones] ${label} response was ${raw.length} bytes but first JSON value ` +
          `ends at ${end} (${raw.length - end} trailing bytes discarded). ` +
          `Fix your server config to stop sending duplicate/extra content.`
        );
        return parsed;
      } catch {
        // fall through to error
      }
    }

    throw new Error(
      `[DragonBones] Failed to parse ${label} JSON from "${url}". ` +
      `Response length: ${raw.length}, first-value boundary: ${findFirstJsonEnd(raw)}. ` +
      `First 200 chars: ${raw.slice(0, 200)}`
    );
  }
}

/** One-time load + parse of the DragonBones data into the global factory. */
async function ensureFactoryLoaded(): Promise<void> {
  if (_factoryReady) return;
  if (_loadPromise) return _loadPromise;

  _loadPromise = (async () => {
    const [skeletonData, atlasData] = await Promise.all([
      fetchJson(SKE_URL, "skeleton"),
      fetchJson(TEX_URL, "atlas"),
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
  const armatureName = "character";

  const display = factory.buildArmatureDisplay(armatureName);
  if (!display) throw new Error(`[DragonBones] Could not build armature: ${armatureName}`);

  // Disable the hardcoded debugDraw in dragonbones-pixi.js (line 9025) which
  // draws cyan circles at every bone joint.
  (display as any).debugDraw = false;

  // Hide IK target slots
  for (const slot of display.armature.getSlots()) {
    if (slot.name.toLowerCase().includes("iktarget") || slot.name.toLowerCase().includes("ik_target")) {
      slot.displayIndex = -1;
    }
  }

  const animations: string[] = display.animation.animationNames;

  const target =
    animations.find((a) => a.toLowerCase() === (animationName ?? "").toLowerCase()) ??
    animations[0];

  if (target) {
    display.animation.play(target, 0);
    console.log("[DragonBones] Playing:", target, "| Available:", animations);
  }

  return { display, animations };
}

// ─── Prop armature names (must match inject_props.py exactly) ────────────────
export const PROP_ARMATURE_NAMES = ["chair", "tshirt", "car", "food", "long_broom", "cup"] as const;
export type PropName = typeof PROP_ARMATURE_NAMES[number];

/** AABB dimensions for each prop (used to size the proxy rect on canvas) */
const PROP_AABB: Record<PropName, { w: number; h: number }> = {
  chair:      { w: 240, h: 340 },
  tshirt:     { w: 200, h: 300 },
  car:        { w: 600, h: 250 },
  food:       { w: 240, h: 140 },
  long_broom: { w: 80,  h: 380 },
  cup:        { w: 90,  h: 120 },
};

/**
 * Offset of the armature root (PIXI origin) from the top-left corner of the
 * AABB bounding box, IN ORIGINAL (un-scaled) DragonBones units.
 * i.e.  display.x = proxy.left - offsetX * scale
 *       display.y = proxy.top  - offsetY * scale
 *
 * These are measured as: how far right/down is the top-left corner of the AABB
 * relative to the armature root?  A positive offsetX means the root is to the
 * LEFT of the AABB top-left, so we subtract it.
 */
const PROP_ROOT_OFFSET: Record<PropName, { x: number; y: number }> = {
  chair:      { x: 120, y: 340 },   // root at bottom-centre
  tshirt:     { x: 100, y: 300 },
  car:        { x: 300, y: 250 },
  food:       { x: 120, y: 140 },
  long_broom: { x:  40, y: 380 },
  cup:        { x:  45, y: 120 },
};

/** Target pixel heights for props on a 540px-tall canvas (tuned visually) */
const PROP_TARGET_H: Record<PropName, number> = {
  chair:      160,
  tshirt:     140,
  car:        160,
  food:        80,
  long_broom: 200,
  cup:         70,
};

/**
 * Build a prop armature display.
 * Returns the PixiJS display + scale + canvas proxy dimensions.
 */
export async function loadProp(
  propName: PropName,
  animationName?: string
): Promise<{
  display: import("dragonbones-pixijs").PixiArmatureDisplay;
  animations: string[];
  dbScale: number;
  proxyW: number;
  proxyH: number;
  /** Pixels to subtract from proxy.left to get display.x (already scaled) */
  offsetX: number;
  /** Pixels to subtract from proxy.top  to get display.y (already scaled) */
  offsetY: number;
}> {
  await ensureFactoryLoaded();

  const factory = PixiFactory.factory;
  const display = factory.buildArmatureDisplay(propName);
  if (!display) throw new Error(`[DragonBones] Could not build prop armature: ${propName}`);

  // Suppress the hardcoded debugDraw cyan joint markers.
  (display as any).debugDraw = false;

  const aabb = PROP_AABB[propName];
  const root = PROP_ROOT_OFFSET[propName];
  const targetH = PROP_TARGET_H[propName];
  const dbScale = targetH / aabb.h;
  const proxyW  = Math.round(aabb.w * dbScale);
  const proxyH  = targetH;

  // How far (in scaled pixels) is the armature root from the proxy top-left?
  const offsetX = Math.round(root.x * dbScale);
  const offsetY = Math.round(root.y * dbScale);

  display.scale.set(dbScale);

  const animations: string[] = display.animation.animationNames;
  const target =
    animations.find((a) => a.toLowerCase() === (animationName ?? "").toLowerCase()) ??
    animations[0];

  if (target) {
    display.animation.play(target, 0);
    console.log(`[DragonBones] Prop '${propName}' playing: ${target}`);
  }

  return { display, animations, dbScale, proxyW, proxyH, offsetX, offsetY };
}