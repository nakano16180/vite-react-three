import { describe, expect, it } from "vitest";
import { GeometryRepository } from "../db/geometryRepository";
import { checkpointRecoveryDecision } from "./useGeometryFeatures";

describe("checkpoint recovery decision", () => {
  it("世代切替中の再読込はwarningを更新せずfailedになる", () => {
    const originalRepository = {} as GeometryRepository;
    const nextRepository = {} as GeometryRepository;

    expect(checkpointRecoveryDecision(true, 3, 4, originalRepository, nextRepository)).toEqual({
      status: "failed",
      shouldSetWarning: false,
    });
  });

  it("同じcontextで再読込が完了した場合だけcheckpoint-uncertainになる", () => {
    const repository = {} as GeometryRepository;

    expect(checkpointRecoveryDecision(true, 3, 3, repository, repository)).toEqual({
      status: "checkpoint-uncertain",
      shouldSetWarning: true,
    });
    expect(checkpointRecoveryDecision(false, 3, 3, repository, repository)).toEqual({
      status: "failed",
      shouldSetWarning: false,
    });
  });
});
