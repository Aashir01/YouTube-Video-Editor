import React, { Suspense, lazy, useEffect, useSyncExternalStore } from 'react';
import { Tooltip } from 'radix-ui';
import { Toaster } from 'sonner';
import { useStudio } from './lib/store';
import { Home } from './components/home/Home';
import { Spinner } from './components/ui';

// the editor (Remotion, timeline, panels) loads on demand so the home screen opens instantly
const Editor = lazy(() => import('./components/editor/Editor').then((m) => ({ default: m.Editor })));
import { SettingsDialog } from './components/settings/SettingsDialog';
import { currentProjectId, subscribeNav } from './lib/nav';

export const App: React.FC = () => {
  const projectId = useSyncExternalStore(subscribeNav, currentProjectId);
  const refreshSystem = useStudio((s) => s.refreshSystem);
  const refreshCloud = useStudio((s) => s.refreshCloud);

  useEffect(() => {
    void refreshSystem();
    void refreshCloud();
    // credits also change from other devices and background jobs
    const t = setInterval(() => void refreshCloud(), 120_000);
    return () => clearInterval(t);
  }, [refreshSystem, refreshCloud]);

  return (
    <Tooltip.Provider>
      {projectId ? (
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center">
              <Spinner className="size-6 text-dim" />
            </div>
          }
        >
          <Editor key={projectId} projectId={projectId} />
        </Suspense>
      ) : (
        <Home />
      )}
      <SettingsDialog />
      <Toaster theme="dark" position="bottom-right" richColors closeButton toastOptions={{ style: { fontSize: 13 } }} />
    </Tooltip.Provider>
  );
};
