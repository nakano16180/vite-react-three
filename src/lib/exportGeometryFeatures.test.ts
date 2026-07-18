import { describe, expect, it, vi } from "vitest";
import { DEFAULT_LAYER, createGeometryFeature, type FeatureGeometry } from "../domain/geometryFeature";
import { createPromiseQueue } from "./promiseQueue";
import { loadExportFeatureCollection } from "./exportGeometryFeatures";

const geometry: FeatureGeometry = {
  type: "LineString",
  coordinates: [
    [0, 0],
    [1, 1],
  ],
};

describe("loadExportFeatureCollection", () => {
  it("React stateではなくrepositoryからfeatureとlayerを読み取る", async () => {
    const fresh = createGeometryFeature({ id: "fresh", geometry });
    const repository = {
      listFeatures: vi.fn().mockResolvedValue([fresh]),
      listLayers: vi.fn().mockResolvedValue([DEFAULT_LAYER]),
    };

    const collection = await loadExportFeatureCollection(repository);

    expect(repository.listFeatures).toHaveBeenCalledOnce();
    expect(repository.listLayers).toHaveBeenCalledOnce();
    expect(collection.features[0].id).toBe("fresh");
  });

  it("同じqueueのpending mutation完了後のstateをexportする", async () => {
    const enqueue = createPromiseQueue();
    const stale = createGeometryFeature({ id: "stale", geometry });
    const fresh = createGeometryFeature({ id: "fresh", geometry });
    let features = [stale];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const repository = {
      listFeatures: vi.fn(async () => features),
      listLayers: vi.fn().mockResolvedValue([DEFAULT_LAYER]),
    };

    const mutation = enqueue(async () => {
      await gate;
      features = [fresh];
    });
    const exported = enqueue(() => loadExportFeatureCollection(repository));

    release();
    await mutation;

    expect((await exported).features[0].id).toBe("fresh");
  });
});
