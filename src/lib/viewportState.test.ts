import { describe, expect, it, vi } from "vitest";
import { loadViewportState, saveViewportState, VIEWPORT_STATE_STORAGE_KEY } from "./viewportState";

describe("viewport state", () => {
  it("finiteなcameraとtargetを復元する", () => {
    const storage = {
      getItem: vi.fn(() => JSON.stringify({ cameraX: 12, cameraY: -8, targetX: 12, targetY: -8, zoom: 1.5 })),
    };

    expect(loadViewportState(storage)).toEqual({
      cameraX: 12,
      cameraY: -8,
      targetX: 12,
      targetY: -8,
      zoom: 1.5,
    });
    expect(storage.getItem).toHaveBeenCalledWith(VIEWPORT_STATE_STORAGE_KEY);
  });

  it("zoomがない旧形式をzoom 1として復元する", () => {
    const storage = {
      getItem: () => JSON.stringify({ cameraX: 12, cameraY: -8, targetX: 12, targetY: -8 }),
    };

    expect(loadViewportState(storage)).toEqual({
      cameraX: 12,
      cameraY: -8,
      targetX: 12,
      targetY: -8,
      zoom: 1,
    });
  });

  it.each([
    ["missing", null],
    ["malformed JSON", "{"],
    ["missing property", JSON.stringify({ cameraX: 1, cameraY: 2, targetX: 3 })],
    ["non-finite property", JSON.stringify({ cameraX: 1, cameraY: 2, targetX: 3, targetY: "NaN" })],
    ["zero zoom", JSON.stringify({ cameraX: 1, cameraY: 2, targetX: 3, targetY: 4, zoom: 0 })],
    ["negative zoom", JSON.stringify({ cameraX: 1, cameraY: 2, targetX: 3, targetY: 4, zoom: -1 })],
    ["invalid zoom", JSON.stringify({ cameraX: 1, cameraY: 2, targetX: 3, targetY: 4, zoom: "NaN" })],
  ])("%sのviewport stateを無視する", (_label, value) => {
    expect(loadViewportState({ getItem: () => value })).toBeNull();
  });

  it("Storageの読み取り例外を無視する", () => {
    expect(
      loadViewportState({
        getItem: () => {
          throw new Error("blocked");
        },
      })
    ).toBeNull();
  });

  it("viewport stateを保存する", () => {
    const storage = { setItem: vi.fn() };
    const state = { cameraX: 4, cameraY: 5, targetX: 6, targetY: 7, zoom: 2 };

    saveViewportState(storage, state);

    expect(storage.setItem).toHaveBeenCalledWith(VIEWPORT_STATE_STORAGE_KEY, JSON.stringify(state));
  });

  it("Storageの書き込み例外を無視する", () => {
    expect(() =>
      saveViewportState(
        {
          setItem: () => {
            throw new Error("blocked");
          },
        },
        { cameraX: 4, cameraY: 5, targetX: 6, targetY: 7, zoom: 2 }
      )
    ).not.toThrow();
  });
});
