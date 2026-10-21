// Minimal routing: "/?project=<id>" opens the editor, anything else shows the home screen.
export const subscribeNav = (cb: () => void) => {
  window.addEventListener('popstate', cb);
  return () => window.removeEventListener('popstate', cb);
};

export const currentProjectId = () => new URLSearchParams(window.location.search).get('project');

export const navigate = (projectId: string | null) => {
  const url = projectId ? `/?project=${encodeURIComponent(projectId)}` : '/';
  window.history.pushState(null, '', url);
  window.dispatchEvent(new PopStateEvent('popstate'));
};
