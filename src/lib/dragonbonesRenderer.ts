import * as PIXI from "pixi.js";

export interface Bone {
  name: string;
  parent?: string;
  length?: number;
  transform?: {
    x?: number;
    y?: number;
    skX?: number;
    skY?: number;
    scaleX?: number;
    scaleY?: number;
  };
  x?: number;
  y?: number;
  scaleX?: number;
  scaleY?: number;
  rotation?: number;
}

export interface Display {
  name: string;
  type?: string;
  transform?: {
    x?: number;
    y?: number;
    skX?: number;
    skY?: number;
    scaleX?: number;
    scaleY?: number;
  };
  x?: number;
  y?: number;
  scaleX?: number;
  scaleY?: number;
}

export interface SkinSlot {
  name: string;
  display: Display[];
}

export interface Skin {
  name?: string;
  slot: SkinSlot[];
}

export interface Slot {
  name: string;
  parent: string;
  displayIndex?: number;
}

export interface DragonBonesData {
  name: string;
  version?: string;
  armature: Array<{
    name: string;
    type?: string;
    frameRate?: number;
    bone: Bone[];
    slot: Slot[];
    animation: Array<{
      name: string;
      duration: number;
      bone?: Array<{
        name: string;
        frame: Array<any>;
      }>;
    }>;
    skin: Skin[];
  }>;
}

export interface TextureAtlasData {
  name: string;
  imagePath: string;
  width: number;
  height: number;
  SubTexture: Array<{
    name: string;
    x: number;
    y: number;
    width: number;
    height: number;
    frameX?: number;
    frameY?: number;
    frameWidth?: number;
    frameHeight?: number;
  }>;
}

/**
 * Simple DragonBones PIXI renderer
 * Parses DragonBones JSON and renders using PIXI
 */
export class DragonBonesRenderer {
  private data: DragonBonesData;
  private atlasData: TextureAtlasData;
  private texture: PIXI.Texture;
  private bones: Map<string, PIXI.Container> = new Map();
  private armature: PIXI.Container;
  private currentAnimation: string = "";
  private animationTime: number = 0;
  private animationPlaying: boolean = false;
  private animationDuration: number = 0;
  private animationFrameRate: number = 24;

  constructor(
    data: DragonBonesData,
    atlasData: TextureAtlasData,
    texture: PIXI.Texture
  ) {
    this.data = data;
    this.atlasData = atlasData;
    this.texture = texture;
    this.armature = new PIXI.Container();
    this.animationFrameRate = data.armature[0]?.frameRate || 24;
    this.buildSkeleton();
  }

  private buildSkeleton() {
    const armatureData = this.data.armature[0];
    if (!armatureData) {
      console.error("[DragonBonesRenderer] No armature data found");
      return;
    }

    console.log(
      "[DragonBonesRenderer] Building skeleton:",
      armatureData.name
    );

    // Create bone hierarchy
    const bones = armatureData.bone || [];
    console.log("[DragonBonesRenderer] Found", bones.length, "bones");

    // Create root container for each bone
    bones.forEach((boneData: any) => {
      const boneContainer = new PIXI.Container();
      boneContainer.label = boneData.name;
      
      // Parse transform - can be either nested object or flat properties
      const transform = boneData.transform || {};
      boneContainer.x = transform.x || boneData.x || 0;
      boneContainer.y = transform.y || boneData.y || 0;
      
      // Handle scale
      const scaleX = transform.scaleX || boneData.scaleX || 1;
      const scaleY = transform.scaleY || boneData.scaleY || 1;
      boneContainer.scale.set(scaleX, scaleY);
      
      // Handle rotation - convert from degrees and handle skew
      const rotation = (transform.skX || boneData.rotation || 0) * (Math.PI / 180);
      boneContainer.rotation = rotation;

      this.bones.set(boneData.name, boneContainer);

      // Add to parent or root
      if (boneData.parent) {
        const parentBone = this.bones.get(boneData.parent);
        if (parentBone) {
          parentBone.addChild(boneContainer);
        } else {
          this.armature.addChild(boneContainer);
        }
      } else {
        this.armature.addChild(boneContainer);
      }
    });

    // Add sprites based on skin
    const skin = armatureData.skin?.[0];
    if (skin) {
      this.applySkin(skin, armatureData.slot || []);
    }

    console.log("[DragonBonesRenderer] Skeleton built");
  }

  private applySkin(
    skin: Skin,
    slots: Slot[]
  ) {
    console.log("[DragonBonesRenderer] Applying skin:", skin.name || "default");

    // Handle nested slot structure where skin.slot is an array of { name, display[] }
    if (!Array.isArray(skin.slot)) {
      console.warn("[DragonBonesRenderer] Skin slot is not an array");
      return;
    }

    skin.slot?.forEach((slotData: any) => {
      // Find the armature slot that matches this skin slot
      const armatureSlot = slots.find(s => s.name === slotData.name);
      if (!armatureSlot) {
        console.warn("[DragonBonesRenderer] Armature slot not found:", slotData.name);
        return;
      }

      // Get parent bone for this slot
      const parentBone = this.bones.get(armatureSlot.parent);
      if (!parentBone) {
        console.warn(
          "[DragonBonesRenderer] Parent bone not found for slot:",
          armatureSlot.parent
        );
        return;
      }

      // Add each display to the bone
      const displayIndex = armatureSlot.displayIndex ?? 0;
      const displays = slotData.display || [];
      
      if (displays.length === 0) {
        console.warn("[DragonBonesRenderer] No displays for slot:", slotData.name);
        return;
      }

      // Use the active display based on displayIndex
      const displayData = displays[displayIndex] || displays[0];
      if (!displayData) {
        console.warn("[DragonBonesRenderer] No display data for slot:", slotData.name);
        return;
      }

      try {
        const subTexture = this.atlasData.SubTexture?.find(
          (t) => t.name === displayData.name
        );

        if (!subTexture) {
          console.warn(
            "[DragonBonesRenderer] SubTexture not found:",
            displayData.name
          );
          return;
        }

        // Create sprite from texture atlas region
        const rect = new PIXI.Rectangle(
          subTexture.x,
          subTexture.y,
          subTexture.width,
          subTexture.height
        );
        const sprite = new PIXI.Sprite(new PIXI.Texture(this.texture.baseTexture, rect));

        // Apply transform from display data
        const transform = displayData.transform || {};
        sprite.x = transform.x || 0;
        sprite.y = transform.y || 0;
        
        // Handle skew as rotation if needed (simplified for now)
        const skX = transform.skX || 0;
        sprite.rotation = (skX * Math.PI) / 180;
        
        sprite.label = displayData.name;

        parentBone.addChild(sprite);
        console.log(
          "[DragonBonesRenderer] Added sprite:",
          displayData.name,
          "to bone:",
          armatureSlot.parent
        );
      } catch (err) {
        console.error(
          "[DragonBonesRenderer] Error adding sprite:",
          displayData.name,
          err
        );
      }
    });
  }

  getArmature(): PIXI.Container {
    return this.armature;
  }

  play(animationName: string, times: number = 0) {
    const animation = this.data.armature[0]?.animation?.find(
      (a) => a.name === animationName
    );
    
    if (!animation) {
      console.warn("[DragonBonesRenderer] Animation not found:", animationName);
      return;
    }

    this.currentAnimation = animationName;
    this.animationTime = 0;
    this.animationDuration = animation.duration;
    this.animationPlaying = true;
    console.log(
      "[DragonBonesRenderer] Playing animation:",
      animationName,
      "duration:",
      this.animationDuration,
      "frames"
    );
  }

  stop() {
    this.animationPlaying = false;
    console.log("[DragonBonesRenderer] Stopped animation");
  }

  update(deltaTime: number) {
    if (!this.animationPlaying) return;

    // Convert delta time (ms) to frames at the animation frame rate
    const deltaFrames = (deltaTime / 1000) * this.animationFrameRate;
    this.animationTime += deltaFrames;

    // Loop animation
    if (this.animationTime >= this.animationDuration) {
      this.animationTime = this.animationTime % this.animationDuration;
    }

    // Apply bone transforms from animation data
    this.applyAnimationFrame(this.currentAnimation, this.animationTime);
  }

  private applyAnimationFrame(animationName: string, frameIndex: number) {
    const animation = this.data.armature[0]?.animation?.find(
      (a) => a.name === animationName
    );

    if (!animation || !animation.bone) return;

    // For each bone in the animation
    animation.bone.forEach((boneAnimation: any) => {
      const bone = this.bones.get(boneAnimation.name);
      if (!bone) return;

      const frames = boneAnimation.frame || [];
      if (frames.length === 0) return;

      // Find the frame range we're in
      let prevFrame = frames[0];
      let nextFrame = frames[0];

      for (let i = 0; i < frames.length; i++) {
        if (frames[i].duration !== undefined) {
          prevFrame = frames[i];
          if (i + 1 < frames.length && frameIndex < frames[i].duration + (frames[i + 1].duration || 0)) {
            nextFrame = frames[i + 1] || frames[i];
            break;
          }
        }
      }

      // Apply transform from current frame
      if (prevFrame.transform) {
        const t = prevFrame.transform;
        if (t.x !== undefined) bone.x = t.x;
        if (t.y !== undefined) bone.y = t.y;
        if (t.scaleX !== undefined) bone.scale.x = t.scaleX;
        if (t.scaleY !== undefined) bone.scale.y = t.scaleY;
        if (t.skX !== undefined) bone.rotation = (t.skX * Math.PI) / 180;
      }
    });
  }

  getAnimations(): string[] {
    return (this.data.armature[0]?.animation || []).map((a) => a.name);
  }
}

/**
 * Load DragonBones data from URLs
 */
export async function loadDragonBonesData(
  skeleonUrl: string,
  textureUrl: string,
  imageUrls: string | string[]
): Promise<{ data: DragonBonesData; atlas: TextureAtlasData; texture: PIXI.Texture }> {
  console.log("[DragonBonesLoader] Loading skeleton from:", skeleonUrl);
  const data = await fetch(skeleonUrl).then((r) => r.json());

  console.log("[DragonBonesLoader] Loading atlas from:", textureUrl);
  const atlas = await fetch(textureUrl).then((r) => r.json());

  // Normalize to array
  const urls = Array.isArray(imageUrls) ? imageUrls : [imageUrls];
  console.log("[DragonBonesLoader] Will try loading image from:", urls);

  let texture: PIXI.Texture | null = null;
  let lastError: Error | null = null;

  // Try each URL in sequence
  for (const imageUrl of urls) {
    console.log("[DragonBonesLoader] Trying to load:", imageUrl);

    // Method 1: Try PIXI's asset loader
    try {
      console.log("[DragonBonesLoader] Attempting PIXI.Assets.load...");
      await PIXI.Assets.load(imageUrl);
      texture = PIXI.Texture.from(imageUrl);
      console.log("[DragonBonesLoader] Success with PIXI.Assets:", texture.width, "x", texture.height);
      return { data, atlas, texture };
    } catch (err) {
      console.warn("[DragonBonesLoader] PIXI.Assets failed:", err);
      lastError = err as Error;
    }

    // Method 2: Fetch as blob and create texture
    try {
      console.log("[DragonBonesLoader] Attempting fetch + blob...");
      const response = await fetch(imageUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      
      const blob = await response.blob();
      console.log("[DragonBonesLoader] Blob loaded:", blob.size, "bytes, type:", blob.type);
      
      const url = URL.createObjectURL(blob);
      const img = new Image();
      
      await new Promise<void>((resolve, reject) => {
        img.onload = () => {
          console.log("[DragonBonesLoader] Image decoded:", img.width, "x", img.height);
          resolve();
        };
        img.onerror = () => reject(new Error("Image decode failed"));
        img.src = url;
      });
      
      const baseTexture = new PIXI.BaseTexture(img);
      texture = new PIXI.Texture(baseTexture);
      console.log("[DragonBonesLoader] Success with fetch + blob from:", imageUrl);
      return { data, atlas, texture };
    } catch (err) {
      console.warn("[DragonBonesLoader] Fetch + blob failed for", imageUrl, ":", err);
      lastError = err as Error;
    }

    // Method 3: Direct Image API
    try {
      console.log("[DragonBonesLoader] Attempting direct Image API...");
      const img = new Image();
      img.crossOrigin = "anonymous";
      
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Image load timeout (5s)"));
        }, 5000);
        
        img.onload = () => {
          clearTimeout(timeout);
          console.log("[DragonBonesLoader] Image loaded:", img.width, "x", img.height);
          resolve();
        };
        
        img.onerror = () => {
          clearTimeout(timeout);
          reject(new Error("Image load error"));
        };
        
        img.src = imageUrl;
      });
      
      const baseTexture = new PIXI.BaseTexture(img);
      texture = new PIXI.Texture(baseTexture);
      console.log("[DragonBonesLoader] Success with direct Image API from:", imageUrl);
      return { data, atlas, texture };
    } catch (err) {
      console.warn("[DragonBonesLoader] Direct Image API failed for", imageUrl, ":", err);
      lastError = err as Error;
    }
  }

  // All methods and URLs failed
  console.error("[DragonBonesLoader] All image loading methods failed for all URLs!");
  throw new Error(`Failed to load image from any source: ${lastError?.message || "unknown error"}`);
}
