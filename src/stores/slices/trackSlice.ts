import { StateCreator } from "zustand";
import { EditorState } from "../editorStore";
import { TrackObject, Keyframe, PathAnimation } from "../../types";
import { FabricImage } from "fabric";
import { interpolateProperties } from "../../utils/interpolation";
import { buildCumulativeLengths, getPositionAtT } from "../../utils/pathAnimation";

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

  addKeyframeAtCurrentTime: (trackId: string) => void;
  updateKeyframe: (trackId: string, keyframeId: string, updates: Partial<Keyframe>) => void;
  removeKeyframe: (trackId: string, keyframeId: string) => void;

  applyKeyframesAtTime: (time: number) => void;
  addAudioTrack: (name: string, audioSrc: string) => void;
  addVideoTrack: (name: string, videoSrc: string) => void;
  syncAudioPlayback: () => void;

  // Path animation
  assignPathToTrack: (trackId: string, pathAnim: PathAnimation) => void;
  removePathFromTrack: (trackId: string) => void;

  // Character animation control
  setCharacterAnimation: (trackId: string, animName: string) => void;
  commitCharacterPathAction: (trackId: string, travelAnim: string, arrivalBehavior: "keep" | "idle") => void;
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

  addTrack: (track) => set((state) => ({ tracks: [...state.tracks, { ...track, volume: track.type === 'visual' ? 0 : 1 }] })),

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

    const rightKeyframes = trackToSplit.keyframes.filter(k => k.time > splitTime);
    const leftKeyframes = trackToSplit.keyframes.filter(k => k.time <= splitTime);

    let newFabricObject = null;
    let newAudioElement = null;

    if (trackToSplit.type === "visual") {
      if (trackToSplit.fabricObject) {
        trackToSplit.fabricObject.clone().then((cloned: any) => {
          newFabricObject = cloned;
          newFabricObject.set({
            left: trackToSplit.fabricObject!.left,
            top: trackToSplit.fabricObject!.top,
            _customId: newTrackId,
            customType: (trackToSplit.fabricObject as any).customType
          });
          (newFabricObject as any)._assetName = `${trackToSplit.name}`;
          try { newFabricObject.name = `${trackToSplit.name}`; } catch (e) {}
          if (canvas) {
            canvas.add(newFabricObject);
            canvas.renderAll();
            canvas.setActiveObject(newFabricObject);
          }
          set((state) => ({
            tracks: state.tracks.map((t) =>
              t.id === newTrackId ? { ...t, fabricObject: newFabricObject } : t,
            ),
            selectedObjectId: newTrackId,
            selectedObject: newFabricObject,
          }));
        });
      }
    } else if (trackToSplit.type === "video") {
      const oldVideoEl = (trackToSplit.fabricObject as any)?._element;
      if (oldVideoEl) {
        const newVideoEl = document.createElement("video");
        newVideoEl.src = oldVideoEl.src;
        newVideoEl.crossOrigin = "anonymous";
        newVideoEl.muted = true;
        newVideoEl.width = oldVideoEl.width;
        newVideoEl.height = oldVideoEl.height;

        const fabObj = trackToSplit.fabricObject!;
        newFabricObject = new FabricImage(newVideoEl, {
          left: fabObj.left, top: fabObj.top, scaleX: fabObj.scaleX, scaleY: fabObj.scaleY, angle: fabObj.angle, opacity: fabObj.opacity, objectCaching: false,
        });
        (newFabricObject as any)._customId = newTrackId;
        (newFabricObject as any).customType = "video";
        (newFabricObject as any)._element = newVideoEl;
        (newFabricObject as any)._assetName = `${trackToSplit.name}`;
        try { (newFabricObject as any).name = `${trackToSplit.name}`; } catch (e) {}
        if (canvas) canvas.add(newFabricObject);
      }
    } else if (trackToSplit.type === "audio") {
      if (trackToSplit.audioElement) {
        newAudioElement = new Audio(trackToSplit.audioElement.src);
        newAudioElement.preload = "auto";
        newAudioElement.crossOrigin = "anonymous";
        newAudioElement.currentTime = 0;
      }
    }

    const rightTrack: TrackObject = {
      ...trackToSplit,
      id: newTrackId,
      startTime: splitTime + 1,
      endTime: oldEndTime,
      keyframes: rightKeyframes,
      fabricObject: newFabricObject,
      audioElement: newAudioElement,
      mediaOffset: newMediaOffset,
      name: `${trackToSplit.name}`,
      volume: trackToSplit.volume ?? 1,
    };

    const updatedLeftTrack = {
      ...trackToSplit,
      endTime: splitTime,
      keyframes: leftKeyframes
    };

    set(state => {
      const parentIdx = state.tracks.findIndex(t => t.id === trackToSplit.id);
      const updatedTracks = state.tracks.map(t =>
        t.id === trackToSplit.id ? updatedLeftTrack : t
      );
      updatedTracks.splice(parentIdx + 1, 0, rightTrack);
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
            const existingIndex = t.keyframes.findIndex((kf) => Math.abs(kf.time - state.currentTime) < 0.05);
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

    if (isPlaying && selectedTrackId) {
      const currentTrack = tracks.find(t => t.id === selectedTrackId);
      if (currentTrack && time >= currentTrack.endTime) {
        const nextTrack = tracks.find(t => Math.abs(t.startTime - currentTrack.endTime) < 0.1 && t.id !== currentTrack.id);
        if (nextTrack) {
          setSelectedObject(nextTrack.id, nextTrack.fabricObject, nextTrack.type);
        }
      }
    }

    tracks.forEach((track) => {
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

      // For tracks with a path animation, never cull after endTime —
      // the character must stay at the destination so the arrival
      // animation (e.g. Idle) keeps playing instead of disappearing.
      const hasPath = !!(track.pathAnimation && track.pathAnimation.points.length > 1);
      if (time < track.startTime || (!hasPath && time > track.endTime)) {
        if (canvas && canvas.contains(track.fabricObject)) {
          canvas.remove(track.fabricObject);
        }
        return;
      }
      // Hide path-animated tracks that haven't started yet
      if (hasPath && time < track.startTime) {
        if (canvas && canvas.contains(track.fabricObject)) {
          canvas.remove(track.fabricObject);
        }
        return;
      }

      if (canvas && !canvas.contains(track.fabricObject)) {
        canvas.add(track.fabricObject);
        const bg = canvas.getObjects().find((o) => (o as any).customType === "background");
        if (bg) canvas.moveObjectTo(bg, 0);
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
      }

      if (track.pathAnimation && track.pathAnimation.points.length > 1) {
        const pa       = track.pathAnimation;
        const action   = (track as any).pendingPathAction as { travelAnim: string; arrivalBehavior: "keep" | "idle" } | null;
        const trackDur = track.endTime - track.startTime;
        const rawT     = trackDur > 0 ? (time - track.startTime) / trackDur : 0;
        const clampedT = Math.max(0, Math.min(1, rawT * (pa.speed ?? 1)));

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
          const dbScale = (track.fabricObject as any).dbScale ?? 1;
          const charW   = (track.fabricObject as any).charW   ?? (track.fabricObject.width  || 103);
          const charH   = (track.fabricObject as any).charH   ?? (track.fabricObject.height || 300);
          const usx = track.fabricObject.scaleX || 1;
          const usy = track.fabricObject.scaleY || 1;
          display.x = newLeft + (charW * usx) / 2;
          display.y = newTop  +  charH * usy;
          display.scale.set(dbScale * Math.max(usx, usy));

          if (action) {
            if (clampedT >= 1) {
              // Path complete → switch to arrival animation.
              // No isPlaying guard here — this must fire even on the final
              // frame when isPlaying has just flipped to false.
              const arrivalAnim = action.arrivalBehavior === "idle" ? "Idle" : action.travelAnim;
              if (display.animation.lastAnimationName !== arrivalAnim) {
                display.animation.play(arrivalAnim, 0);
              }
            } else if (isPlaying) {
              // Path in progress → only switch during active playback,
              // not while scrubbing, so pausing doesn't snap the anim.
              if (display.animation.lastAnimationName !== action.travelAnim) {
                display.animation.play(action.travelAnim, 0);
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
      display.animation.play(animName, 0);
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

  syncAudioPlayback: () => {
    const { tracks, isPlaying, currentTime } = get();
    tracks.forEach((track) => {
      const mediaElement = track.audioElement || (track.fabricObject as any)?._element;
      if (!mediaElement || !(mediaElement instanceof HTMLAudioElement || mediaElement instanceof HTMLVideoElement)) return;

      if (mediaElement.volume !== track.volume) {
        mediaElement.volume = track.volume;
      }
      mediaElement.muted = track.volume === 0;
      
      const isInRange = currentTime >= track.startTime && currentTime < track.endTime;

      if (isPlaying && isInRange) {
        const timeElapsedInTrack = currentTime - track.startTime;
        const targetFileTime = timeElapsedInTrack + (track.mediaOffset || 0);

        if (mediaElement.paused) {
          mediaElement.currentTime = targetFileTime;
          const playPromise = mediaElement.play();
          if (playPromise !== undefined) {
            playPromise.catch(e => {
              if (e.name !== "AbortError") console.warn("Media play error", e);
            });
          }
        } else {
          const drift = Math.abs(mediaElement.currentTime - targetFileTime);
          if (drift > 0.35) {
            mediaElement.currentTime = targetFileTime;
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