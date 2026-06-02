import { StateCreator } from "zustand";
import { EditorState } from "../editorStore";
import { TrackObject, Keyframe, PathAnimation } from "../../types";
import { FabricImage } from "fabric";
import { interpolateProperties } from "../../utils/interpolation";
import { buildCumulativeLengths, getPositionAtT } from "../../utils/pathAnimation";

/**
 * Scene-restore guard.
 * Set to true by CanvasEditor immediately before canvas.remove() + loadFromJSON,
 * and cleared to false inside the afterLoad callback once fabricObject refs are
 * re-linked. While true, applyKeyframesAtTime will NOT call canvas.add() — this
 * prevents the stale fabricObject ref from being re-added as a ghost between the
 * canvas clear and the loadFromJSON completion.
 */
export let isSceneRestoring = false;
export const setSceneRestoring = (v: boolean) => { isSceneRestoring = v; };

// Animations that should loop continuously (playTimes = 0).
// Everything NOT in this set is a one-shot transition (playTimes = 1) that
// plays through once and holds its last frame — e.g. sit_down, wave, jump.
const LOOPING_ANIMS = new Set([
  "Idle", "idle",
  "walk", "Walk",
  "run",  "Run",
  "sit_idle",
  "cross_legs",
  "lay_down",
  "fall_asleep",
]);

/** Returns the correct playTimes for display.animation.play() */
const playTimes = (animName: string) => LOOPING_ANIMS.has(animName) ? 0 : 1;


export interface TrackSlice {
  tracks: TrackObject[];
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  selectedTrackId: string | null;
  selectedKeyframe: Keyframe | null;

  setProjectName: (name: string) => void;
  setCurrentTime: (time: number) => void;
  setDuration: (duration: number) => void;
  setIsPlaying: (playing: boolean) => void;
  setSelectedKeyframe: (keyframe: Keyframe | null, trackId: string | null) => void;

  addTrack: (track: TrackObject) => void;
  updateTrack: (id: string, updates: Partial<TrackObject>) => void;
  removeTrack: (id: string) => void;
  splitTrack: (id: string) => void;
  reorderTracks: (fromIndex: number, toIndex: number) => void;

  addKeyframeAtCurrentTime: (trackId: string) => void;
  updateKeyframe: (trackId: string, keyframeId: string, updates: Partial<Keyframe>) => void;
  removeKeyframe: (trackId: string, keyframeId: string) => void;

  applyKeyframesAtTime: (time: number) => void;
  addAudioTrack: (name: string, audioSrc: string) => void;
  addTTSTrack: (name: string, ttsParams: { text: string; lang: string; pitch: number; rate: number }, duration: number) => void;
  addVideoTrack: (name: string, videoSrc: string) => void;
  syncAudioPlayback: () => void;

  // Path animation
  assignPathToTrack: (trackId: string, pathAnim: PathAnimation) => void;
  removePathFromTrack: (trackId: string) => void;

  // Character animation control
  setCharacterAnimation: (trackId: string, animName: string) => void;
  commitCharacterPathAction: (trackId: string, travelAnim: string, arrivalBehavior: "keep" | "idle") => void;
  commitCharacterSequenceAction: (trackId: string, steps: import("../../types").SequenceStep[]) => void;

  // Audio post-processing
  applyAudioFiltersToTrack: (trackId: string, cleaningKeys: string[], filterKeys: string[], processedBlob: Blob) => void;
  removeAudioFiltersFromTrack: (trackId: string) => void;

  // Clear everything
  clearCanvas: () => void;
}

export const createTrackSlice: StateCreator<EditorState, [], [], TrackSlice> = (set, get) => ({
  tracks: [],
  currentTime: 0,
  duration: 5000,
  isPlaying: false,
  selectedTrackId: null,
  selectedKeyframe: null,

  setProjectName: (name) => set({ projectName: name }),

  setCurrentTime: (time) => {
    set({ currentTime: time });
    get().applyKeyframesAtTime(time);
  },

  setDuration: (duration) => set({ duration }),
  setIsPlaying: (playing) => set({ isPlaying: playing }),

  setSelectedKeyframe: (keyframe, trackId) =>
    set({
      selectedKeyframe: keyframe,
      selectedTrackId: trackId,
    }),

  addTrack: (track) => set((state) => {
    const sceneId = (state as any).activeSceneId as string | undefined;
    return { tracks: [...state.tracks, { ...track, sceneId, volume: track.type === 'visual' ? 0 : 1 }] };
  }),

  reorderTracks: (fromIndex, toIndex) => {
    if (fromIndex === toIndex) return;
    const state = get();
    const activeSceneId = (state as any).activeSceneId as string | undefined;

    // Build the scene-filtered list so the indices from the Timeline UI (which
    // only shows current-scene tracks) map correctly to the global array.
    const allTracks = [...state.tracks];
    const sceneTrackIds = allTracks
      .filter(t => !t.sceneId || t.sceneId === activeSceneId)
      .map(t => t.id);

    const movedId = sceneTrackIds[fromIndex];
    const targetId = sceneTrackIds[toIndex];
    if (!movedId || !targetId) return;

    const globalFrom = allTracks.findIndex(t => t.id === movedId);
    const globalTo   = allTracks.findIndex(t => t.id === targetId);
    if (globalFrom < 0 || globalTo < 0) return;

    const tracks = [...allTracks];
    const [moved] = tracks.splice(globalFrom, 1);
    tracks.splice(globalTo, 0, moved);

    // Sync Fabric canvas z-order to match the new track order.
    // Track index 0 = bottom layer, last index = top layer.
    // Background (customType === "background") is always pinned to index 0.
    const canvas = state.canvas;
    if (canvas) {
      const bgObject = canvas.getObjects().find((o) => (o as any).customType === "background");
      const bgIndex = bgObject ? 0 : -1;

      tracks.forEach((track, idx) => {
        if (!track.fabricObject) return;
        // Offset above background (if any)
        const targetZ = bgIndex >= 0 ? idx + 1 : idx;
        canvas.moveObjectTo(track.fabricObject, targetZ);
      });

      canvas.renderAll();
    }

    set({ tracks });
  },

  updateTrack: (id, updates) => {
    if (updates.startTime !== undefined || updates.endTime !== undefined) {
      get().saveCheckpoint();
    }
    set((state) => ({
      tracks: state.tracks.map((track) =>
        track.id === id ? { ...track, ...updates } : track,
      ),
    }));
  },

  removeTrack: (id) => {
    get().saveCheckpoint();
    set((state) => {
      const track = state.tracks.find((t) => t.id === id);
      if (track?.fabricObject && state.canvas) {
        state.canvas.remove(track.fabricObject);
      }
      if (track?.audioElement) {
        track.audioElement.pause();
        track.audioElement.src = "";
      }
      return {
        tracks: state.tracks.filter((t) => t.id !== id),
        selectedObjectId: state.selectedObjectId === id ? null : state.selectedObjectId,
        selectedObject: state.selectedObjectId === id ? null : state.selectedObject,
        selectedTrackId: state.selectedTrackId === id ? null : state.selectedTrackId,
      };
    });
  },

  clearCanvas: () => {
    const { tracks, canvas, saveCheckpoint } = get();
    saveCheckpoint();

    // Stop & clean up every track's media/fabric object
    tracks.forEach((track) => {
      // Pause & release audio
      if (track.audioElement) {
        track.audioElement.pause();
        track.audioElement.src = "";
      }
      // Pause & release video DOM element
      if (track.type === "video" && track.fabricObject) {
        const videoEl = (track.fabricObject as any)._element as HTMLVideoElement | undefined;
        if (videoEl) {
          videoEl.pause();
          videoEl.src = "";
          videoEl.load();
          if (videoEl.parentNode) videoEl.parentNode.removeChild(videoEl);
        }
      }
      // Remove DragonBones armature display from PIXI stage
      if (track.fabricObject) {
        const display = (track.fabricObject as any).armatureDisplay;
        if (display) {
          try { display.dispose(); } catch (_) {}
        }
      }
      // Remove fabric object from canvas
      if (track.fabricObject && canvas) {
        canvas.remove(track.fabricObject);
      }
    });

    // Clear any remaining objects on the fabric canvas (background, orphans)
    if (canvas) {
      canvas.getObjects().slice().forEach((obj) => canvas.remove(obj));
      canvas.renderAll();
    }

    set({
      tracks: [],
      selectedObjectId: null,
      selectedObject: null,
      selectedTrackId: null,
      selectedKeyframe: null,
      currentTime: 0,
      isPlaying: false,
    });
  },

  splitTrack: (trackId) => {
    const { tracks, currentTime, saveCheckpoint, canvas } = get();
    const trackToSplit = tracks.find((t) => t.id === trackId);

    if (!trackToSplit) return;

    if (currentTime <= trackToSplit.startTime || currentTime >= trackToSplit.endTime) {
      console.warn("Playhead is outside the track bounds");
      return;
    }

    saveCheckpoint();

    const splitTime = currentTime;
    const oldEndTime = trackToSplit.endTime;

    const existingOffset = trackToSplit.mediaOffset || 0;
    const newMediaOffset = (splitTime - trackToSplit.startTime) + existingOffset;

    const newTrackId = `${trackToSplit.id}_split_${Date.now()}`;

    // Split keyframes at the split time
    const rightKeyframes = trackToSplit.keyframes.filter(k => k.time > splitTime);
    const leftKeyframes = trackToSplit.keyframes.filter(k => k.time <= splitTime);

    // Update left track (the part before split time)
    const updatedLeftTrack: TrackObject = {
      ...trackToSplit,
      endTime: splitTime,
      keyframes: leftKeyframes,
      name: `${trackToSplit.name}`,
    };

    // Create right track (the part after split time) - without fabricObject initially
    const rightTrack: TrackObject = {
      ...trackToSplit,
      id: newTrackId,
      startTime: splitTime,
      endTime: oldEndTime,
      keyframes: rightKeyframes,
      mediaOffset: newMediaOffset,
      name: `${trackToSplit.name}`,
      volume: trackToSplit.volume ?? 1,
      fabricObject: null, // Will be set asynchronously if needed
      audioElement: null,
    };

    // Handle fabric objects and media cloning
    let newFabricObject: any = null;
    let newAudioElement: HTMLAudioElement | null = null;

    if (trackToSplit.type === "visual") {
      if (trackToSplit.fabricObject) {
        trackToSplit.fabricObject.clone().then((cloned: any) => {
          cloned.set({
            left: trackToSplit.fabricObject!.left,
            top: trackToSplit.fabricObject!.top,
            _customId: newTrackId,
            customType: (trackToSplit.fabricObject as any).customType
          });
          (cloned as any)._assetName = trackToSplit.name;
          try { cloned.name = trackToSplit.name; } catch (e) {}
          
          if (canvas) {
            canvas.add(cloned);
            canvas.renderAll();
          }
          
          // Update the right track with the fabricObject
          set((state) => ({
            tracks: state.tracks.map((t) =>
              t.id === newTrackId ? { ...t, fabricObject: cloned } : t
            ),
          }));
        });
      }
    } else if (trackToSplit.type === "video") {
      const oldVideoEl = (trackToSplit.fabricObject as any)?._element;
      if (oldVideoEl && trackToSplit.fabricObject) {
        const newVideoEl = document.createElement("video");
        newVideoEl.src = oldVideoEl.src;
        newVideoEl.crossOrigin = "anonymous";
        newVideoEl.muted = true;
        newVideoEl.width = oldVideoEl.width;
        newVideoEl.height = oldVideoEl.height;

        const fabObj = trackToSplit.fabricObject;
        newFabricObject = new FabricImage(newVideoEl, {
          left: fabObj.left,
          top: fabObj.top,
          scaleX: fabObj.scaleX,
          scaleY: fabObj.scaleY,
          angle: fabObj.angle,
          opacity: fabObj.opacity,
          objectCaching: false,
        });
        (newFabricObject as any)._customId = newTrackId;
        (newFabricObject as any).customType = "video";
        (newFabricObject as any)._element = newVideoEl;
        (newFabricObject as any)._assetName = trackToSplit.name;
        
        try { (newFabricObject as any).name = trackToSplit.name; } catch (e) {}
        
        if (canvas) {
          canvas.add(newFabricObject);
          canvas.renderAll();
        }
      }
    } else if (trackToSplit.type === "audio") {
      if (trackToSplit.audioElement) {
        newAudioElement = new Audio(trackToSplit.audioElement.src);
        newAudioElement.preload = "auto";
        newAudioElement.crossOrigin = "anonymous";
        newAudioElement.currentTime = 0;
      }
    }

    // Update state with the split tracks
    set((state) => {
      const trackIdx = state.tracks.findIndex((t) => t.id === trackToSplit.id);
      if (trackIdx === -1) return state;

      // Create new tracks array with updated left track and inserted right track
      const updatedTracks = state.tracks.slice(); // Create shallow copy
      updatedTracks[trackIdx] = updatedLeftTrack;

      // Insert right track immediately after left track
      if (newFabricObject || newAudioElement) {
        const rightTrackWithMedia = { ...rightTrack, fabricObject: newFabricObject, audioElement: newAudioElement };
        updatedTracks.splice(trackIdx + 1, 0, rightTrackWithMedia);
      } else {
        updatedTracks.splice(trackIdx + 1, 0, rightTrack);
      }

      return {
        tracks: updatedTracks,
        selectedObjectId: newTrackId,
      };
    });

    if (canvas) canvas.requestRenderAll();
  },

  addKeyframeAtCurrentTime: (trackId) => {
    get().saveCheckpoint();
    set((state) => {
      const track = state.tracks.find((t) => t.id === trackId);
      if (!track?.fabricObject) return state;

      const fabricObj = track.fabricObject;
      const newKeyframe: Keyframe = {
        id: `kf_${Date.now()}`,
        time: state.currentTime,
        properties: {
          left: fabricObj.left || 0, top: fabricObj.top || 0, scaleX: fabricObj.scaleX || 1, scaleY: fabricObj.scaleY || 1, angle: fabricObj.angle || 0, opacity: fabricObj.opacity || 1,
        },
        easing: "linear",
      };

      return {
        tracks: state.tracks.map((t) => {
          if (t.id === trackId) {
            const existingIndex = t.keyframes.findIndex((kf) => Math.abs(kf.time - state.currentTime) < 0.1);
            let newKeyframes;
            if (existingIndex >= 0) {
              newKeyframes = [...t.keyframes];
              newKeyframes[existingIndex] = newKeyframe;
            } else {
              newKeyframes = [...t.keyframes, newKeyframe].sort((a, b) => a.time - b.time);
            }
            return { ...t, keyframes: newKeyframes };
          }
          return t;
        }),
      };
    });
  },

  updateKeyframe: (trackId, keyframeId, updates) => {
    get().saveCheckpoint();
    set((state) => ({
      tracks: state.tracks.map((track) =>
        track.id === trackId
          ? { ...track, keyframes: track.keyframes.map((kf) => kf.id === keyframeId ? { ...kf, ...updates } : kf) }
          : track
      ),
      selectedKeyframe: state.selectedKeyframe?.id === keyframeId ? { ...state.selectedKeyframe, ...updates } : state.selectedKeyframe,
    }));
  },

  removeKeyframe: (trackId, keyframeId) => {
    get().saveCheckpoint();
    set((state) => ({
      tracks: state.tracks.map((track) =>
        track.id === trackId ? { ...track, keyframes: track.keyframes.filter((kf) => kf.id !== keyframeId) } : track
      ),
      selectedKeyframe: state.selectedKeyframe?.id === keyframeId ? null : state.selectedKeyframe,
    }));
  },

  applyKeyframesAtTime: (time) => {
    const { tracks, canvas, selectedObject, isPlaying, selectedTrackId, setSelectedObject } = get();
    // Only animate tracks that belong to the currently active scene
    const activeSceneId = (get() as any).activeSceneId as string | undefined;
    const activeTracks = tracks.filter(t => !t.sceneId || t.sceneId === activeSceneId);

    // Helper: given a list of sequence steps and elapsed time, return which animation is active.
    // Correctly advances the cursor through completed steps and returns the last step's animation
    // when elapsed has passed all steps.
    const findActiveAnimation = (steps: import("../../types").SequenceStep[], elapsed: number): string => {
      let cursor = 0;
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        if (elapsed < cursor + step.duration || i === steps.length - 1) {
          return step.animation;
        }
        cursor += step.duration;
      }
      return steps[steps.length - 1].animation;
    };

    if (isPlaying && selectedTrackId) {
      const currentTrack = activeTracks.find(t => t.id === selectedTrackId);
      if (currentTrack && time >= currentTrack.endTime) {
        const nextTrack = activeTracks.find(t => Math.abs(t.startTime - currentTrack.endTime) < 0.1 && t.id !== currentTrack.id);
        if (nextTrack) {
          setSelectedObject(nextTrack.id, nextTrack.fabricObject, nextTrack.type);
        }
      }
    }

    activeTracks.forEach((track) => {
      if (track.type === "audio" && track.audioElement) {
        if (!isPlaying) {
          const isInRange = time >= track.startTime && time <= track.endTime;
          if (isInRange) {
            const relativeTime = time - track.startTime;
            const targetFileTime = relativeTime + (track.mediaOffset || 0);
            if (Math.abs(track.audioElement.currentTime - targetFileTime) > 0.1) {
              track.audioElement.currentTime = targetFileTime;
            }
          } else {
            if (!track.audioElement.paused) track.audioElement.pause();
          }
        }
        return;
      }

      if (!track.fabricObject) return;
      track.fabricObject.set({ selectable: true, evented: true });

      // For tracks with a path animation (or sequence action), never cull after endTime —
      // the character must stay at the destination so the arrival
      // animation (e.g. Idle) keeps playing instead of disappearing.
      const hasPath = !!(track.pathAnimation && track.pathAnimation.points.length > 1);
      const hasSequence = !!((track as any).sequenceAction?.steps?.length);
      const hasMotion = hasPath || hasSequence;

      if (time < track.startTime || (!hasMotion && time > track.endTime)) {
        // For character/prop tracks: NEVER call canvas.remove() because
        // that fires object:removed which disposes & nulls the armatureDisplay.
        // Instead just hide the fabric proxy and the PIXI armature.
        // Never call canvas.remove() for tracks that have objects with
        // lifecycle state attached (armature, lottie anim, gif).
        // canvas.remove() fires object:removed which permanently destroys them.
        // Instead, hide via opacity=0 and restore when back in range.
        const isArmatureTrack = (track.fabricObject as any)?.armatureDisplay != null ||
          (track.fabricObject as any)?.customType === "character" ||
          (track.fabricObject as any)?.customType === "prop";
        const isLottieTrack   = (track.fabricObject as any)?.customType === "scene";
        const isGifTrack      = (track.fabricObject as any)?.customType === "gif";

        if (isArmatureTrack || isLottieTrack || isGifTrack) {
          // Hide without removing — preserves the attached anim/display
          if (track.fabricObject) {
            track.fabricObject.set({ opacity: 0, evented: false, selectable: false });
          }
        } else {
          if (canvas && canvas.contains(track.fabricObject)) {
            canvas.remove(track.fabricObject);
          }
        }
        // Hide the PIXI armature so it doesn't linger on the overlay
        const displayHide = (track.fabricObject as any)?.armatureDisplay;
        if (displayHide) displayHide.visible = false;
        return;
      }

      // Guard: only add if the exact object instance is not already on the canvas.
      // Also check by _customId because after loadFromJSON re-linking, contains()
      // may return false for the new instance even though an object with the same
      // ID is already present (the restored one). Without this, scrubbing back to
      // t=0 after path playback would add a second copy → visible ghost duplicate.
      // Also skip entirely while a scene restore is in progress (canvas is being
      // cleared + repopulated by loadFromJSON) to prevent stale refs being re-added.
      if (canvas && track.fabricObject && !isSceneRestoring) {
        const alreadyOnCanvas =
          canvas.contains(track.fabricObject) ||
          canvas.getObjects().some((o: any) => o._customId && o._customId === (track.fabricObject as any)._customId && o !== track.fabricObject);
        if (!alreadyOnCanvas) {
          canvas.add(track.fabricObject);
          const bg = canvas.getObjects().find((o) => (o as any).customType === "background");
          if (bg) canvas.moveObjectTo(bg, 0);
        }
      }

      // Restore visibility for tracks hidden via opacity=0 (armature, lottie, gif)
      if (
        (track.fabricObject as any)?.customType === "character" ||
        (track.fabricObject as any)?.customType === "prop"    ||
        (track.fabricObject as any)?.customType === "scene"   ||
        (track.fabricObject as any)?.customType === "gif"
      ) {
        const savedOpacity = (track.fabricObject as any)._savedOpacity ?? (track.initialState as any)?.opacity ?? 1;
        if ((track.fabricObject.opacity ?? 1) === 0) {
          track.fabricObject.set({
            opacity: savedOpacity,
            evented: true,
            selectable: true,
          });
        }
      }

      // Always ensure the armatureDisplay is visible and synced whenever the
      // fabric object is in range. This covers the case where the armature was
      // hidden (e.g. by a reset to t=0) but the fabric proxy was never removed
      // from canvas (because hasMotion=true), so the canvas.add branch above
      // is never entered — and the armature would stay invisible without this.
      {
        const displayShow = (track.fabricObject as any).armatureDisplay;
        if (displayShow && !displayShow.visible) {
          displayShow.visible = true;
          const dbScale = (track.fabricObject as any).dbScale ?? 1;
          const isProp  = (track.fabricObject as any).customType === "prop";
          if (isProp) {
            const offsetX = (track.fabricObject as any).propOffsetX ?? 0;
            const offsetY = (track.fabricObject as any).propOffsetY ?? 0;
            const userScale = Math.max(track.fabricObject.scaleX || 1, track.fabricObject.scaleY || 1);
            displayShow.x = (track.fabricObject.left || 0) + offsetX * userScale;
            displayShow.y = (track.fabricObject.top  || 0) + offsetY * userScale;
            displayShow.scale.set(dbScale * userScale);
          } else {
            const charW = (track.fabricObject as any).charW ?? (track.fabricObject.width  || 103);
            const charH = (track.fabricObject as any).charH ?? (track.fabricObject.height || 300);
            const usx   = track.fabricObject.scaleX || 1;
            const usy   = track.fabricObject.scaleY || 1;
            displayShow.x = (track.fabricObject.left || 0) + (charW * usx) / 2;
            displayShow.y = (track.fabricObject.top  || 0) +  charH * usy;
            displayShow.scale.set(dbScale * Math.max(usx, usy));
          }
        }
      }

      if (track.keyframes.length > 0) {
        const props = interpolateProperties(track.keyframes, time);
        if (props) {
          Object.keys(props).forEach((key) => {
            track.fabricObject!.set(key as any, (props as any)[key]);
          });
          track.fabricObject.setCoords();
          track.fabricObject.dirty = true;
        }
      } else if (!hasPath && hasSequence) {
        // Stationary sequence with no keyframes: position from initialState
        const s = track.initialState as any;
        if (s) {
          track.fabricObject.set({
            left:    s.left    ?? track.fabricObject.left,
            top:     s.top     ?? track.fabricObject.top,
            scaleX:  s.scaleX  ?? track.fabricObject.scaleX,
            scaleY:  s.scaleY  ?? track.fabricObject.scaleY,
            angle:   s.angle   ?? track.fabricObject.angle,
            opacity: s.opacity ?? track.fabricObject.opacity,
          });
          track.fabricObject.setCoords();
          track.fabricObject.dirty = true;
          // Also sync DragonBones display position for stationary characters
          const dispStatic = (track.fabricObject as any).armatureDisplay;
          if (dispStatic) {
            const dbScale = (track.fabricObject as any).dbScale ?? 1;
            const charW   = (track.fabricObject as any).charW   ?? (track.fabricObject.width  || 103);
            const charH   = (track.fabricObject as any).charH   ?? (track.fabricObject.height || 300);
            const usx = track.fabricObject.scaleX || 1;
            const usy = track.fabricObject.scaleY || 1;
            dispStatic.x = (s.left ?? 0) + (charW * usx) / 2;
            dispStatic.y = (s.top  ?? 0) +  charH * usy;
            dispStatic.scale.set(dbScale * Math.max(usx, usy));
          }
        }
      }

      // ── Standalone sequence action (no path) ─────────────────────────────
      // Handles prop actions like "sit on chair" or "hold cup" where the
      // character stays in place but cycles through animation steps over time.
      const standaloneSeq = (track as any).sequenceAction as import("../../types").CharacterSequenceAction | null;
      if (standaloneSeq && standaloneSeq.steps.length > 0 && !hasPath) {
        const display = (track.fabricObject as any).armatureDisplay;
        if (display) {
          const elapsed = Math.max(0, time - track.startTime);
          const activeAnim = findActiveAnimation(standaloneSeq.steps, elapsed);
          if (display.animation.lastAnimationName !== activeAnim) {
            display.animation.play(activeAnim, playTimes(activeAnim));
          }
        }
      }

      if (track.pathAnimation && track.pathAnimation.points.length > 1) {
        const pa       = track.pathAnimation;
        const action   = (track as any).pendingPathAction as { travelAnim: string; arrivalBehavior: "keep" | "idle" } | null;
        const seqAction = (track as any).sequenceAction as import("../../types").CharacterSequenceAction | null;
        const trackDur = track.endTime - track.startTime;
        const elapsed  = Math.max(0, time - track.startTime);

        // Determine effective T (0..1) along the path
        let clampedT: number;
        if (seqAction && seqAction.steps.length > 0) {
          // Walk through sequence steps to find current position along path
          let cursor = 0;
          let effectiveT = 0;
          // Find the last path segment reached (for stationary steps)
          let lastReachedPathEnd = 0;

          for (let si = 0; si < seqAction.steps.length; si++) {
            const step = seqAction.steps[si];
            const stepEnd = cursor + step.duration;

            if (elapsed <= stepEnd) {
              // We are inside this step
              if (step.pathSegment) {
                // Moving step: interpolate within the segment
                const stepProgress = step.duration > 0 ? (elapsed - cursor) / step.duration : 1;
                effectiveT = step.pathSegment.from + Math.min(1, stepProgress) * (step.pathSegment.to - step.pathSegment.from);
              } else {
                // Stationary step: hold at last reached path position
                effectiveT = lastReachedPathEnd;
              }
              break;
            }

            // Step is complete — advance
            if (step.pathSegment) {
              lastReachedPathEnd = step.pathSegment.to;
            }
            cursor = stepEnd;

            // If this is the last step and we're past it, clamp at end
            if (si === seqAction.steps.length - 1) {
              effectiveT = step.pathSegment ? step.pathSegment.to : lastReachedPathEnd;
            }
          }
          clampedT = Math.max(0, Math.min(1, effectiveT));
        } else {
          // speed > 1 means animation completes before track ends; clamp at 1
          const rawT  = trackDur > 0 ? elapsed / trackDur : 0;
          clampedT    = Math.min(1, rawT * (pa.speed ?? 1));
        }

        const cumLengths    = buildCumulativeLengths(pa.points);
        const { x, y, angle } = getPositionAtT(pa.points, cumLengths, clampedT);
        const offset  = pa.originOffset ?? { x: 0, y: 0 };
        const newLeft = x + offset.x;
        const newTop  = y + offset.y;

        track.fabricObject.set({ left: newLeft, top: newTop });
        if (pa.orientToPath) track.fabricObject.set({ angle });
        track.fabricObject.setCoords();
        track.fabricObject.dirty = true;

        // Sync PIXI DragonBones display position
        const display = (track.fabricObject as any).armatureDisplay;
        if (display) {
          // Always make the armature visible during path playback.
          // It may have been hidden (visible=false) by a t=0 reset and the
          // conditional re-show block above only fires when visible===false,
          // which can race with this block on the very first frame.
          display.visible = true;
          const dbScale = (track.fabricObject as any).dbScale ?? 1;
          const charW   = (track.fabricObject as any).charW   ?? (track.fabricObject.width  || 103);
          const charH   = (track.fabricObject as any).charH   ?? (track.fabricObject.height || 300);
          const usx = track.fabricObject.scaleX || 1;
          const usy = track.fabricObject.scaleY || 1;
          display.x = newLeft + (charW * usx) / 2;
          display.y = newTop  +  charH * usy;
          display.scale.set(dbScale * Math.max(usx, usy));

          // ── Sequence action ──────────────────────────────────────────────
          if (seqAction && seqAction.steps.length > 0) {
            const activeAnim = findActiveAnimation(seqAction.steps, elapsed);
            if (display.animation.lastAnimationName !== activeAnim) {
              display.animation.play(activeAnim, playTimes(activeAnim));
            }
          } else if (action) {
            if (clampedT >= 1) {
              // Path complete → switch to arrival animation.
              // No isPlaying guard here — this must fire even on the final
              // frame when isPlaying has just flipped to false.
              const arrivalAnim = action.arrivalBehavior === "idle" ? "Idle" : action.travelAnim;
              if (display.animation.lastAnimationName !== arrivalAnim) {
                display.animation.play(arrivalAnim, playTimes(arrivalAnim));
              }
            } else if (isPlaying) {
              // Path in progress → only switch during active playback,
              // not while scrubbing, so pausing doesn't snap the anim.
              if (display.animation.lastAnimationName !== action.travelAnim) {
                display.animation.play(action.travelAnim, playTimes(action.travelAnim));
              }
            }
          }
        }
      }
    });

    if (selectedObject && canvas) {
      canvas.discardActiveObject();
      canvas.setActiveObject(selectedObject);
    }
    canvas?.requestRenderAll();
  },

  addAudioTrack: (name, audioSrc) => {
    get().saveCheckpoint();
    const audio = new Audio(audioSrc);
    audio.preload = "auto";
    audio.crossOrigin = "anonymous";
    const id = `audio_${Date.now()}`;
    const defaultDuration = 5;

    const newTrack: TrackObject = {
      id, name, fabricObject: null, startTime: 0, endTime: defaultDuration, keyframes: [], color: "purple",
      initialState: { left: 0, top: 0, scaleX: 1, scaleY: 1, angle: 0, opacity: 1 },
      type: "audio", audioElement: audio, audioSrc, volume: 1,
    };

    const setDuration = () => {
      const newDuration = audio.duration;
      if (newDuration && isFinite(newDuration)) {
        get().updateTrack(id, { endTime: newDuration, mediaDuration: newDuration });
      } else {
        get().updateTrack(id, { endTime: defaultDuration, mediaDuration: defaultDuration });
      }
    };

    if (audio.readyState > 0) {
      setDuration();
    } else {
      audio.addEventListener("loadedmetadata", setDuration);
    }
    set((state) => ({ tracks: [...state.tracks, { ...newTrack, volume: 1 }] }));
  },

  addTTSTrack: (name, ttsParams, duration) => {
    get().saveCheckpoint();
    const id = `tts_${Date.now()}`;
    const newTrack: TrackObject = {
      id, name, fabricObject: null, startTime: 0, endTime: duration, keyframes: [], color: "purple",
      initialState: { left: 0, top: 0, scaleX: 1, scaleY: 1, angle: 0, opacity: 1 },
      type: "audio", audioElement: null, audioSrc: "tts://", volume: 1,
      mediaDuration: duration, ttsParams,
    };
    set((state) => ({ tracks: [...state.tracks, newTrack] }));
  },

  addVideoTrack: (name, videoSrc) => {
    get().saveCheckpoint();
    const video = document.createElement("video");
    video.src = videoSrc; video.preload = "auto"; video.crossOrigin = "anonymous"; video.muted = true;
    video.playsInline = true; video.loop = false; video.style.display = "none";
    video.width = 480; video.height = 360;

    const id = `video_${Date.now()}`;
    const newTrack: TrackObject = {
      id, name, fabricObject: null, startTime: 0, endTime: 10, keyframes: [], color: "orange",
      initialState: { left: 0, top: 0, scaleX: 1, scaleY: 1, angle: 0, opacity: 1 },
      type: "video", audioElement: null, audioSrc: videoSrc, volume: 1,
    };
    set((state) => ({ tracks: [...state.tracks, newTrack] }));

    const onMetadataLoaded = () => {
      const newDuration = video.duration;
      const validDuration = newDuration && isFinite(newDuration) ? newDuration : 10;
      const width = video.videoWidth || 480; const height = video.videoHeight || 360;
      video.width = width; video.height = height;
      const targetSize = 300;
      const fitScale = Math.min(targetSize / width, targetSize / height);
      const baseLeft = 100 + Math.random() * 200;
      const baseTop = 100 + Math.random() * 200;

      const fabricVideo = new FabricImage(video, {
        left: baseLeft, top: baseTop, scaleX: fitScale, scaleY: fitScale, objectCaching: false,
      });
      (fabricVideo as any)._customId = id;
      (fabricVideo as any).customType = "video";
      (fabricVideo as any)._element = video;

      const canvas = get().canvas;
      if (canvas) {
        canvas.add(fabricVideo);
        canvas.setActiveObject(fabricVideo);
        canvas.renderAll();
      }
      get().updateTrack(id, {
        fabricObject: fabricVideo, endTime: validDuration, mediaDuration: validDuration,
      });
      video.play().catch((e) => console.log("Autoplay blocked", e));
    };

    if (video.readyState >= 1) onMetadataLoaded();
    else video.onloadedmetadata = onMetadataLoaded;

    document.body.appendChild(video);
  },

  assignPathToTrack: (trackId, pathAnim) => {
    const track = get().tracks.find((t) => t.id === trackId);
    const obj = track?.fabricObject;
    const objLeft = obj?.left ?? 0; const objTop = obj?.top ?? 0;
    const pathStart = pathAnim.points[0] ?? { x: 0, y: 0 };
    const originOffset = { x: objLeft - pathStart.x, y: objTop - pathStart.y };

    set((state) => ({
      tracks: state.tracks.map((t) =>
        t.id === trackId ? { ...t, pathAnimation: { speed: 1, ...pathAnim, originOffset } } : t
      ),
    }));
  },

  removePathFromTrack: (trackId) => {
    set((state) => ({
      tracks: state.tracks.map((t) =>
        t.id === trackId ? { ...t, pathAnimation: null } : t
      ),
    }));
  },

  setCharacterAnimation: (trackId, animName) => {
    set((state) => ({
      tracks: state.tracks.map((t) =>
        t.id === trackId ? { ...t, characterAnimation: animName } : t
      ),
    }));
    // Actually switch the DragonBones display
    const track = get().tracks.find((t) => t.id === trackId);
    const display = (track?.fabricObject as any)?.armatureDisplay;
    if (display) {
      display.animation.play(animName, playTimes(animName));
    }
  },

  commitCharacterPathAction: (trackId, travelAnim, arrivalBehavior) => {
    // Only store the intent — do NOT switch the DragonBones animation here.
    // The actual switch happens inside applyKeyframesAtTime when playback
    // starts, so the character only changes animation once Play is pressed.
    set((state) => ({
      tracks: state.tracks.map((t) =>
        t.id === trackId
          ? {
              ...t,
              // Keep characterAnimation as the current idle state so the
              // character stays visually unchanged until Play is pressed.
              pendingPathAction: { travelAnim: travelAnim as any, arrivalBehavior },
            }
          : t
      ),
    }));
  },

  commitCharacterSequenceAction: (trackId, steps) => {
    const TRAVEL_ANIMS = new Set(["walk", "run"]);
    const incomingHasTravel = steps.some((s) => TRAVEL_ANIMS.has(s.animation));

    // Only clear pathAnimation when the NEW sequence is purely stationary.
    // Walk & Sit comes in WITH travel steps and brings its own fresh path
    // (assigned just before this call), so we must not null it out.
    // For stationary follow-ups (Sit Up, Get Up, etc.) we DO clear the old
    // path so applyKeyframesAtTime stops teleporting the character back to
    // the walk start point.
    if (!incomingHasTravel) {
      const track = get().tracks.find((t) => t.id === trackId);
      if (track?.pathAnimation && track.pathAnimation.points.length > 1) {
        // The prop popup already updated initialState to the current position
        // before calling commitCharacterSequenceAction, so we just clear path.
        // Don't call addKeyframeAtCurrentTime here — the initialState pin is enough
        // and avoids creating spurious keyframes that fight with the sequence.
      }
    }

    set((state) => ({
      tracks: state.tracks.map((t) =>
        t.id === trackId
          ? {
              ...t,
              pendingPathAction: null,
              // Only wipe the path for stationary sequences.
              ...(incomingHasTravel ? {} : { pathAnimation: null }),
              sequenceAction: { steps },
            }
          : t
      ),
    }));
  },   

  applyAudioFiltersToTrack: (trackId, cleaningKeys, filterKeys, processedBlob) => {
    const processedUrl = URL.createObjectURL(processedBlob);
    const track = get().tracks.find(t => t.id === trackId);

    // Revoke previous processed URL to avoid memory leaks
    if (track?.processedAudioSrc) {
      try { URL.revokeObjectURL(track.processedAudioSrc); } catch {}
    }

    // Replace the audio element source with the processed blob
    const newAudio = new Audio(processedUrl);
    newAudio.preload = "auto";
    newAudio.crossOrigin = "anonymous";

    if (track?.audioElement) {
      track.audioElement.pause();
      track.audioElement.src = "";
    }

    set((state) => ({
      tracks: state.tracks.map(t =>
        t.id === trackId
          ? {
              ...t,
              audioFilterKeys: filterKeys,
              audioCleaningKeys: cleaningKeys,
              processedAudioSrc: processedUrl,
              audioElement: newAudio,
              // Save the original offset so we can restore it if filters are removed.
              originalMediaOffset: t.originalMediaOffset ?? (t.mediaOffset ?? 0),
              // The processed blob is pre-trimmed to the clip segment, so the
              // media no longer needs an offset — it starts at t=0 of the clip.
              mediaOffset: 0,
            }
          : t
      ),
    }));
  },

  removeAudioFiltersFromTrack: (trackId) => {
    const track = get().tracks.find(t => t.id === trackId);
    if (!track) return;

    // Revoke processed URL
    if (track.processedAudioSrc) {
      try { URL.revokeObjectURL(track.processedAudioSrc); } catch {}
    }

    // Restore original audio
    const originalSrc = track.audioSrc || "";
    const restoredAudio = originalSrc ? new Audio(originalSrc) : null;
    if (restoredAudio) {
      restoredAudio.preload = "auto";
      restoredAudio.crossOrigin = "anonymous";
    }
    if (track.audioElement) {
      track.audioElement.pause();
      track.audioElement.src = "";
    }

    set((state) => ({
      tracks: state.tracks.map(t =>
        t.id === trackId
          ? {
              ...t,
              audioFilterKeys: [],
              audioCleaningKeys: [],
              processedAudioSrc: null,
              audioElement: restoredAudio,
              // Restore the mediaOffset that was saved before filters were applied.
              mediaOffset: t.originalMediaOffset ?? t.mediaOffset ?? 0,
              originalMediaOffset: undefined,
            }
          : t
      ),
    }));
  },

  syncAudioPlayback: () => {
    const { tracks, currentTime, isPlaying } = get();
    const activeSceneId = (get() as any).activeSceneId as string | undefined;
    // Only sync audio for tracks in the active scene
    const sceneTracks = tracks.filter(t => !t.sceneId || t.sceneId === activeSceneId);

    // Handle TTS tracks separately via speechSynthesis
    const ttsTracks = sceneTracks.filter(t => t.ttsParams && t.audioSrc === "tts://");
    ttsTracks.forEach((track) => {
      if (!track.ttsParams) return;
      const isInRange = isPlaying && currentTime >= track.startTime && currentTime < track.endTime;
      const isSpeaking = window.speechSynthesis.speaking;

      if (isInRange && !isSpeaking) {
        // Only trigger at the very start of the track (within first 0.2s) to avoid re-speaking mid-playback
        const elapsed = currentTime - track.startTime;
        if (elapsed < 0.2) {
          const utt = new SpeechSynthesisUtterance(track.ttsParams.text);
          utt.lang = track.ttsParams.lang;
          utt.pitch = track.ttsParams.pitch;
          utt.rate = track.ttsParams.rate;
          utt.volume = track.volume ?? 1;
          const availableVoices = window.speechSynthesis.getVoices();
          const match = availableVoices.find(v => v.lang.startsWith(track.ttsParams!.lang.split("-")[0]));
          if (match) utt.voice = match;
          window.speechSynthesis.cancel();
          window.speechSynthesis.speak(utt);
        }
      } else if (!isPlaying || !isInRange) {
        if (window.speechSynthesis.speaking) {
          window.speechSynthesis.cancel();
        }
      }
    });

    sceneTracks.forEach((track) => {
      // Skip TTS tracks — handled above
      if (track.ttsParams && track.audioSrc === "tts://") return;

      const mediaElement: HTMLAudioElement | HTMLVideoElement | null =
        track.audioElement ?? ((track.fabricObject as any)?._element ?? null);

      if (!mediaElement || !(mediaElement instanceof HTMLAudioElement || mediaElement instanceof HTMLVideoElement)) return;

      if (mediaElement.volume !== (track.volume ?? 1)) {
        mediaElement.volume = track.volume ?? 1;
      }
      mediaElement.muted = (track.volume ?? 1) === 0;

      const isInRange = currentTime >= track.startTime && currentTime < track.endTime;

      if (isPlaying && isInRange) {
        const timeElapsedInTrack = currentTime - track.startTime;
        const targetFileTime = timeElapsedInTrack + (track.mediaOffset || 0);
        const drift = Math.abs(mediaElement.currentTime - targetFileTime);

        // FIX: If the element is currently paused but is inside an active track block,
        // OR if the internal playhead has noticeably drifted from the timeline track playhead position,
        // immediately hard-sync its internal playback destination.
        if (mediaElement.paused || drift > 0.15) {
          mediaElement.currentTime = targetFileTime;
        }

        if (mediaElement.paused) {
          const playPromise = mediaElement.play();
          if (playPromise !== undefined) {
            playPromise.catch(e => {
              if (e.name !== "AbortError") console.warn("Media play error", e);
            });
          }
        }
      } else {
        if (!mediaElement.paused) {
          mediaElement.pause();
          if (currentTime >= track.endTime) {
            const clipDuration = track.endTime - track.startTime;
            const endFileTime = clipDuration + (track.mediaOffset || 0);
            if (!isNaN(mediaElement.duration)) {
              mediaElement.currentTime = Math.min(endFileTime, mediaElement.duration);
            }
          }
        }
      }
    });
  },
});