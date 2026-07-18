import { describe, expect, it } from "vitest";
import { createPromiseQueue } from "./promiseQueue";

describe("createPromiseQueue", () => {
  it("operationを投入順に直列実行する", async () => {
    const enqueue = createPromiseQueue();
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = enqueue(async () => {
      events.push("first:start");
      await firstGate;
      events.push("first:end");
    });
    const second = enqueue(async () => {
      events.push("second");
    });

    await Promise.resolve();
    expect(events).toEqual(["first:start"]);
    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(["first:start", "first:end", "second"]);
  });

  it("失敗後も次のoperationを実行する", async () => {
    const enqueue = createPromiseQueue();
    const failed = enqueue(async () => {
      throw new Error("failed");
    });
    const recovered = enqueue(async () => "recovered");

    await expect(failed).rejects.toThrow("failed");
    await expect(recovered).resolves.toBe("recovered");
  });
});
