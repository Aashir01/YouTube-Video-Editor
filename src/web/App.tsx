import React, { useEffect, useSyncExternalStore } from 'react';
import { Tooltip } from 'radix-ui';
import { Toaster } from 'sonner';
import { useStudio } from './lib/store';
import { Home } from './components/home/Home';
import { Editor } from './components/editor/Editor';
import { SettingsDialog } from './components/settings/SettingsDialog';
import { currentProjectId, subscribeNav } from './lib/nav';

export const App: React.FC = () => {
  const projectId = useSyncExternalStore(subscribeNav, currentProjectId);
  const refreshSystem = useStudio((s) => s.refreshSystem);

  useEffect(() => {
    void refreshSystem();
  }, [refreshSystem]);

  return (
    <Tooltip.Provider>
      {projectId ? <Editor key={projectId} projectId={projectId} /> : <Home />}
      <SettingsDialog />
      <Toaster theme="dark" position="bottom-right" richColors closeButton toastOptions={{ style: { fontSize: 13 } }} />
    </Tooltip.Provider>
  );
};
