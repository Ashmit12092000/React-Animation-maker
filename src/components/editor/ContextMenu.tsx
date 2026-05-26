import { useEffect, useRef, useCallback } from "react";
import { useEditorStore } from "@/stores/editorStore";
import {
  BringToFront,
  SendToBack,
  Lock,
  Unlock,
  Trash2,
  Copy,
  ClipboardPaste,
  Scissors,
  CopyPlus, // Changed to CopyPlus for better visual distinction
  RotateCw,
  Image,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
}

export function ContextMenu({ x, y, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  
  // 1. Destructure necessary store actions
  const {
    selectedObject,
    moveObjectUp,
    moveObjectDown,
    toggleLock,
    deleteSelected,
    copyObject,
    pasteObject,
    duplicateObject,
    rotateImage,
    setAsBackground,
    clipboard,
    splitTrack,
    selectedObjectId,
    selectedObjectType,
    audioClipboard,
  } = useEditorStore();

  // 2. Handle Clicking Outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  // Duplicate Handler
  const handleDuplicate = useCallback(() => {
    if (!selectedObjectId) return;
    duplicateObject();
    onClose();
  }, [selectedObjectId, duplicateObject, onClose]);

  const isLocked = selectedObject?.lockMovementX;
  const isImage = !!selectedObject && ((selectedObject as any).type === "image" || (selectedObject as any).customType === "image");
  const isAudioTrack = selectedObjectType === "audio";
  const canPaste = isAudioTrack ? !!audioClipboard : !!clipboard;

  return (
    <div
      ref={menuRef}
      className="fixed z-50 w-48 bg-[#1e1e2e] border border-gray-700 rounded-lg shadow-xl py-1 flex flex-col text-sm animate-in fade-in zoom-in-95 duration-100 max-h-[450px] overflow-y-auto"
      style={{ top: y, left: x }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {selectedObject && (
        <>
          <MenuItem
            icon={<SendToBack className="w-4 h-4" />}
            label="Send Backward"
            onClick={() => {
              moveObjectDown();
              onClose();
            }}
          />
          <MenuItem
            icon={<BringToFront className="w-4 h-4" />}
            label="Bring Forward"
            onClick={() => {
              moveObjectUp();
              onClose();
            }}
          />

          <div className="h-px bg-gray-700 my-1 mx-2" />

          <MenuItem
            icon={
              isLocked ? (
                <Unlock className="w-4 h-4" />
              ) : (
                <Lock className="w-4 h-4" />
              )
            }
            label={isLocked ? "Unlock" : "Lock"}
            onClick={() => {
              toggleLock();
              onClose();
            }}
          />

          <div className="h-px bg-gray-700 my-1 mx-2" />

          <MenuItem
            icon={<Copy className="w-4 h-4" />}
            label="Copy"
            onClick={() => {
              copyObject();
              onClose();
            }}
            shortcut="Ctrl+C"
          />
          
          {/* Updated Duplicate Button */}
          <MenuItem
            icon={<CopyPlus className="w-4 h-4" />}
            label="Duplicate"
            onClick={handleDuplicate}
          />

          {isImage && (
            <>
              <div className="h-px bg-gray-700 my-1 mx-2" />
              <MenuItem
                icon={<RotateCw className="w-4 h-4" />}
                label="Rotate 90°"
                onClick={() => {
                  rotateImage();
                  onClose();
                }}
              />
              <MenuItem
                icon={<Image className="w-4 h-4" />}
                label="Set as Background"
                onClick={() => {
                  setAsBackground();
                  onClose();
                }}
                disabled={(selectedObject as any)?.customType === "background"}
              />
            </>
          )}
        </>
      )}

      {isAudioTrack && (
        <>
          <MenuItem
            icon={<Copy className="w-4 h-4" />}
            label="Copy"
            onClick={() => {
              copyObject();
              onClose();
            }}
            shortcut="Ctrl+C"
          />
          <MenuItem
            icon={<CopyPlus className="w-4 h-4" />}
            label="Duplicate"
            onClick={handleDuplicate}
          />
          <div className="h-px bg-gray-700 my-1 mx-2" />
        </>
      )}

      <MenuItem
        icon={<ClipboardPaste className="w-4 h-4" />}
        label="Paste"
        onClick={() => {
          pasteObject();
          onClose();
        }}
        disabled={!canPaste}
        shortcut="Ctrl+V"
      />

      {(selectedObject || isAudioTrack) && (
        <MenuItem
          icon={<Scissors className="w-4 h-4" />}
          label="Split"
          onClick={() => {
            splitTrack(selectedObjectId);
            onClose();
          }}
        />
      )}

      {(selectedObject || isAudioTrack) && (
        <>
          <div className="h-px bg-gray-700 my-1 mx-2" />
          <MenuItem
            icon={<Trash2 className="w-4 h-4 text-red-400" />}
            label="Delete"
            onClick={() => {
              deleteSelected();
              onClose();
            }}
            className="text-red-400 hover:bg-red-900/20"
            shortcut="Del"
          />
        </>
      )}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  shortcut,
  disabled = false,
  className = "",
}: any) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "w-full flex items-center gap-3 px-3 py-2 text-gray-200 hover:bg-gray-700/50 transition-colors text-left",
        disabled && "opacity-50 cursor-not-allowed hover:bg-transparent",
        className,
      )}
    >
      {icon}
      <span className="flex-1">{label}</span>
      {shortcut && (
        <span className="text-xs text-gray-500 font-mono">{shortcut}</span>
      )}
    </button>
  );
}