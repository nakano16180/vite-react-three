export const VIEWPORT_STATE_STORAGE_KEY = "vite-react-three:viewport";

export interface ViewportState {
  cameraX: number;
  cameraY: number;
  targetX: number;
  targetY: number;
}

interface ReadableStorage {
  getItem(key: string): string | null;
}

interface WritableStorage {
  setItem(key: string, value: string): void;
}

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export const loadViewportState = (storage: ReadableStorage): ViewportState | null => {
  try {
    const value = storage.getItem(VIEWPORT_STATE_STORAGE_KEY);
    if (value === null) return null;

    const parsed = JSON.parse(value) as Partial<ViewportState>;
    if (
      !isFiniteNumber(parsed.cameraX) ||
      !isFiniteNumber(parsed.cameraY) ||
      !isFiniteNumber(parsed.targetX) ||
      !isFiniteNumber(parsed.targetY)
    ) {
      return null;
    }

    return {
      cameraX: parsed.cameraX,
      cameraY: parsed.cameraY,
      targetX: parsed.targetX,
      targetY: parsed.targetY,
    };
  } catch {
    return null;
  }
};

export const saveViewportState = (storage: WritableStorage, state: ViewportState): void => {
  try {
    storage.setItem(VIEWPORT_STATE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Viewport persistence is optional and must not block geometry work.
  }
};
