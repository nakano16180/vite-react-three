import { describe, expect, it, vi } from "vitest";
import { QueryRejectedError, QueryRuntime, validateReadOnlySql } from "./queryRuntime";

const reader = (rows: Record<string, unknown>[], fields = [{ name: "id", type: { toString: () => "VARCHAR" } }]) => {
  const value = {
    schema: { fields },
    open: vi.fn(async () => value),
    async *[Symbol.asyncIterator]() {
      yield { schema: { fields }, toArray: () => rows.map((row) => ({ toJSON: () => row })) };
    },
  };
  return value;
};

const fixture = (readers: ReturnType<typeof reader>[]) => {
  const connections = readers.map((value) => ({
    send: vi.fn().mockResolvedValue(value),
    cancelSent: vi.fn().mockResolvedValue(true),
    close: vi.fn().mockResolvedValue(undefined),
  }));
  const db = {
    connect: vi.fn(async () => {
      const connection = connections.shift();
      if (!connection) throw new Error("no connection");
      return connection;
    }),
    terminate: vi.fn().mockResolvedValue(undefined),
  };
  return { db, connections };
};

describe("read-only SQL validation", () => {
  it.each(["UPDATE x SET y=1", "DELETE FROM x", "CREATE TABLE x(i INT)", "COPY x TO 'a'", "SELECT 1; DROP TABLE x"])(
    "rejects %s before execution",
    (sql) => expect(() => validateReadOnlySql(sql)).toThrow(QueryRejectedError)
  );

  it("accepts one SELECT or WITH query and removes a trailing semicolon", () => {
    expect(validateReadOnlySql(" SELECT 1; ")).toBe("SELECT 1");
    expect(validateReadOnlySql("WITH x AS (SELECT 1) SELECT * FROM x")).toContain("WITH x");
  });
});

describe("QueryRuntime", () => {
  it("returns typed rows and truncates the 1001st row", async () => {
    const rows = Array.from({ length: 1001 }, (_, index) => ({ id: BigInt(index + 1) }));
    const { db } = fixture([reader(rows, [{ name: "id", type: { toString: () => "BIGINT" } }])]);
    const runtime = new QueryRuntime(db);

    const result = await runtime.execute("SELECT id FROM geometry_features");

    expect(result).toMatchObject({
      status: "success",
      rowCount: 1000,
      truncated: true,
      columns: [{ name: "id", type: "BIGINT" }],
    });
    expect(result?.rows[0]).toEqual({ id: "1" });
  });

  it("distinguishes empty results and propagates invalid SQL errors", async () => {
    const { db } = fixture([reader([]), reader([])]);
    const runtime = new QueryRuntime(db);

    await expect(runtime.execute("SELECT id FROM geometry_features WHERE false")).resolves.toMatchObject({
      status: "empty",
      rowCount: 0,
    });
    db.connect.mockResolvedValueOnce({
      send: vi.fn().mockRejectedValue(new Error("Parser Error")),
      cancelSent: vi.fn().mockResolvedValue(false),
      close: vi.fn().mockResolvedValue(undefined),
    });
    await expect(runtime.execute("SELECT broken")).rejects.toThrow("Parser Error");
  });

  it("cancels the active connection and uses a fresh connection next time", async () => {
    let resolveFirst!: (value: ReturnType<typeof reader>) => void;
    const first = {
      send: vi.fn(() => new Promise<ReturnType<typeof reader>>((resolve) => (resolveFirst = resolve))),
      cancelSent: vi.fn().mockResolvedValue(true),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const second = {
      send: vi.fn().mockResolvedValue(reader([{ id: "next" }])),
      cancelSent: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const db = { connect: vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second), terminate: vi.fn() };
    const runtime = new QueryRuntime(db);
    const pending = runtime.execute("SELECT 1");

    await vi.waitFor(() => expect(first.send).toHaveBeenCalled());
    await runtime.cancel();
    resolveFirst(reader([{ id: "stale" }]));

    await expect(pending).resolves.toBeNull();
    await expect(runtime.execute("SELECT 2")).resolves.toMatchObject({ rows: [{ id: "next" }] });
    expect(first.cancelSent).toHaveBeenCalledOnce();
    expect(db.connect).toHaveBeenCalledTimes(2);
  });

  it("suppresses results after dispose", async () => {
    let resolveQuery!: (value: ReturnType<typeof reader>) => void;
    const connection = {
      send: vi.fn(() => new Promise<ReturnType<typeof reader>>((resolve) => (resolveQuery = resolve))),
      cancelSent: vi.fn().mockResolvedValue(true),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const db = { connect: vi.fn().mockResolvedValue(connection), terminate: vi.fn().mockResolvedValue(undefined) };
    const runtime = new QueryRuntime(db);
    const pending = runtime.execute("SELECT 1");
    await vi.waitFor(() => expect(connection.send).toHaveBeenCalled());

    await runtime.dispose();
    resolveQuery(reader([{ id: "stale" }]));

    await expect(pending).resolves.toBeNull();
    expect(db.terminate).toHaveBeenCalledOnce();
  });
});
