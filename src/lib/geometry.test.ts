import { describe, expect, it } from "vitest";
import {
  getCentroid,
  getPolygonArea,
  getPolygonPerimeter,
  getPolylineLength,
  isPolygonCloseCandidate,
} from "./geometry";

describe("geometry helpers", () => {
  it("polyline lengthを計算する", () => {
    expect(
      getPolylineLength([
        [0, 0],
        [3, 4],
        [6, 8],
      ])
    ).toBe(10);
  });

  it("polygon areaとperimeterを計算する", () => {
    const points: [number, number][] = [
      [0, 0],
      [4, 0],
      [4, 3],
    ];
    expect(getPolygonArea(points)).toBe(6);
    expect(getPolygonPerimeter(points)).toBe(12);
  });

  it("点群のcentroidを計算する", () => {
    expect(
      getCentroid([
        [0, 0],
        [6, 0],
        [0, 6],
      ])
    ).toEqual([2, 2]);
    expect(getCentroid([])).toEqual([0, 0]);
  });

  it("4点以上で始点近傍に戻った場合だけpolygon候補にする", () => {
    expect(
      isPolygonCloseCandidate(
        [
          [0, 0],
          [20, 0],
          [20, 20],
          [2, 2],
        ],
        5
      )
    ).toBe(true);
    expect(
      isPolygonCloseCandidate(
        [
          [0, 0],
          [20, 0],
          [2, 2],
        ],
        5
      )
    ).toBe(false);
  });
});
