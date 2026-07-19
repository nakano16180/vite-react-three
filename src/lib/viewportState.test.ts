import { describe, expect, it, vi } from "vitest";
import { loadViewportState, saveViewportState, VIEWPORT_STATE_STORAGE_KEY } from "./viewportState";

describe("viewport state", () => {
  it("finiteなcameraとtargetを復元する", () => {
    const storage = {
      getItem: vi.fn(() => JSON.stringify({ cameraX: 12, cameraY: -8, targetX: 12, targetY: -8 })),
    };

    expect(loadViewportState(storage)).toEqual({
      cameraX: 12,
      cameraY: -8,
      targetX: 12,
      targetY: -8,
    });
    expect(storage.getItem).toHaveBeenCalledWith(VIEWPORT_STATE_STORAGE_KEY);
  });

  it.each([
    ["missing", null],
    ["malformed JSON", "{"],
    ["missing property", JSON.stringify({ cameraX: 1, cameraY: 2, targetX: 3 })],
    ["non-finite property", JSON.stringify({ cameraX: 1, cameraY: 2, targetX: 3, targetY: "NaN" })],
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
    const state = { cameraX: 4, cameraY: 5, targetX: 6, targetY: 7 };

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
        { cameraX: 4, cameraY: 5, targetX: 6, targetY: 7 }
      )
    ).not.toThrow();
  });
});
