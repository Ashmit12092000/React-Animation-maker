import { Toaster } from "@/components/ui/Toaster";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AssetPanel } from "@/components/editor/AssetPanel";
import { CanvasEditor } from "@/components/editor/CanvasEditor";
import { PropertyPanel } from "@/components/editor/PropertyPanel";
import { Timeline } from "@/components/editor/Timeline";
import { Toolbar } from "@/components/ui/Toolbar";
const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <Toaster />
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
  </QueryClientProvider>
);

export default App;