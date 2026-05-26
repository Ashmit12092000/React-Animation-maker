import { useEditorStore } from '@/stores/editorStore';
import type { Keyframe } from '../../types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Diamond, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';

const easingLabels = {
  'linear': 'Linear',
  'ease-in': 'Ease In',
  'ease-out': 'Ease Out',
  'ease-in-out': 'Ease In Out',
};

export function KeyframeEditor() {
  const { selectedKeyframe, selectedTrackId, tracks, updateKeyframe, removeKeyframe, setSelectedKeyframe } = useEditorStore();

  if (!selectedKeyframe || !selectedTrackId) {
    return null;
  }

  const track = tracks.find(t => t.id === selectedTrackId);
  if (!track) return null;

  const handleUpdate = (updates: Partial<Keyframe>) => {
    updateKeyframe(selectedTrackId, selectedKeyframe.id, updates);
  };

  const handleDelete = () => {
    removeKeyframe(selectedTrackId, selectedKeyframe.id);
    toast.success('Keyframe deleted');
  };

  const handleClose = () => {
    setSelectedKeyframe(null, null);
  };

  return (
    <div className="absolute bottom-52 left-1/2 -translate-x-1/2 bg-card border border-border rounded-lg shadow-xl p-4 w-80 z-50">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Diamond className="w-4 h-4 text-playhead" />
          <h3 className="text-sm font-semibold">Edit Keyframe</h3>
        </div>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={handleClose}>
          <X className="w-4 h-4" />
        </Button>
      </div>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Time (s)</Label>
          <Input
            type="number"
            step="0.1"
            min="0"
            max="5"
            value={selectedKeyframe.time}
            onChange={(e) => handleUpdate({ time: Number(e.target.value) })}
            className="h-8 bg-secondary border-panel-border text-sm"
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Easing</Label>
          <Select
            value={selectedKeyframe.easing}
            onValueChange={(value: Keyframe['easing']) => handleUpdate({ easing: value })}
          >
            <SelectTrigger className="h-8 bg-secondary border-panel-border text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(easingLabels).map(([key, label]) => (
                <SelectItem key={key} value={key}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Display stored properties */}
        <div className="text-xs text-muted-foreground bg-secondary/50 rounded p-2 space-y-1">
          <div className="font-medium text-foreground mb-1">Stored Properties:</div>
          <div>Position: ({selectedKeyframe.properties.left.toFixed(0)}, {selectedKeyframe.properties.top.toFixed(0)})</div>
          <div>Scale: {selectedKeyframe.properties.scaleX.toFixed(2)} × {selectedKeyframe.properties.scaleY.toFixed(2)}</div>
          <div>Rotation: {selectedKeyframe.properties.angle.toFixed(0)}°</div>
          <div>Opacity: {(selectedKeyframe.properties.opacity * 100).toFixed(0)}%</div>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={handleDelete}
          className="w-full h-8 bg-destructive/10 border-destructive/30 text-destructive hover:bg-destructive/20"
        >
          <Trash2 className="w-4 h-4 mr-1" />
          Delete Keyframe
        </Button>
      </div>
    </div>
  );
}
