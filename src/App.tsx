import { Toaster } from "@/components/ui/Toaster";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AssetPanel } from "@/components/editor/AssetPanel";
import { CanvasEditor } from "@/components/editor/CanvasEditor";
import { PropertyPanel } from "@/components/editor/PropertyPanel";
import { Timeline } from "@/components/editor/Timeline";
import { Toolbar } from "@/components/ui/Toolbar";
import { useState, useEffect } from "react";

const queryClient = new QueryClient();

const App = () => {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <Toaster />
      {isMobile ? (
        /* ── Mobile Layout ──────────────────────────────────────────── */
        <div className="h-[100dvh] flex flex-col overflow-hidden bg-background">
          <Toolbar />
          <div className="flex-1 overflow-hidden relative min-h-0">
            <CanvasEditor />
          </div>
          {/* Timeline gets padding-bottom so content isn't hidden behind AssetPanel tab bar */}
          <div className="pb-14 flex-shrink-0">
            <Timeline />
          </div>
          {/* AssetPanel and PropertyPanel render as fixed overlays on mobile */}
          <AssetPanel />
          <PropertyPanel />
        </div>
      ) : (
        /* ── Desktop Layout ─────────────────────────────────────────── */
        <div className="h-screen flex flex-col overflow-hidden bg-background">
          <Toolbar />
          <div className="flex-1 flex overflow-hidden">
            <AssetPanel />
            <div className="flex-1 flex flex-col overflow-hidden min-h-0">
              <CanvasEditor />
              <Timeline />
            </div>
            <PropertyPanel />
          </div>
        </div>
      )}
    </QueryClientProvider>
  );
};

export default App;