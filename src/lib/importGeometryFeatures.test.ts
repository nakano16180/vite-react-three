import { describe, expect, it } from "vitest";
import { createGeometryFeature, type GeometryFeature, type Layer } from "../domain/geometryFeature";
import { createPromiseQueue } from "./promiseQueue";
import { importGeometryFeatures } from "./importGeometryFeatures";

const geoJSON = (id: string) =>
  JSON.stringify({
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        id,
        geometry: {
          type: "LineString",
          coordinates: [
            [0, 0],
            [1, 1],
          ],
        },
        properties: {},
      },
    ],
  });

class FakeImportRepository {
  features: GeometryFeature[] = [];

  async listFeatures() {
    return [...this.features];
  }

  async importGeoJSON(_layers: Layer[], features: GeometryFeature[]) {
    this.features.push(...features);
  }

  async clearFeatures() {
    this.features = [];
  }
}

describe("importGeometryFeatures", () => {
  it("Import後に投入されたClearより先にfileを読み終えてimportする", async () => {
    const repository = new FakeImportRepository();
    const enqueue = createPromiseQueue();
    let releaseRead!: () => void;
    const readGate = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });

    const importing = enqueue(() =>
      importGeometryFeatures(repository, async () => {
        await readGate;
        return geoJSON("shared");
      })
    );
    const clearing = enqueue(() => repository.clearFeatures());

    await Promise.resolve();
    expect(repository.features).toEqual([]);
    releaseRead();
    await Promise.all([importing, clearing]);
    expect(repository.features).toEqual([]);
  });

  it("連続importは直前commit後のlatest IDsから重複IDを置換する", async () => {
    const repository = new FakeImportRepository();

    await importGeometryFeatures(repository, async () => geoJSON("shared"));
    await importGeometryFeatures(repository, async () => geoJSON("shared"));

    expect(repository.features).toHaveLength(2);
    expect(repository.features[0].id).toBe("shared");
    expect(repository.features[1].id).not.toBe("shared");
  });

  it("repository.listFeaturesのexisting IDsをimport前に取得する", async () => {
    const repository = new FakeImportRepository();
    repository.features.push(
      createGeometryFeature({
        id: "existing",
        geometry: {
          type: "LineString",
          coordinates: [
            [0, 0],
            [1, 1],
          ],
        },
      })
    );

    await importGeometryFeatures(repository, async () => geoJSON("existing"));

    expect(repository.features.at(-1)?.id).not.toBe("existing");
  });
});
