// Per-browser UI preferences (panel sizes, zoom, tabs). Storage can be unavailable; never fail.
const KEY = 'director-studio:prefs';

const read = (): Record<string, unknown> => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, unknown>;
  } catch {
    return {};
  }
};

export const prefs = {
  get<T>(name: string, fallback: T): T {
    const v = read()[name];
    return v === undefined ? fallback : (v as T);
  },
  set(name: string, value: unknown): void {
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...read(), [name]: value }));
    } catch {
      /* ignore */
    }
  },
};
