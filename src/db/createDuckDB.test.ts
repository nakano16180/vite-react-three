import type { AsyncDuckDB, AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import { describe, expect, it, vi } from "vitest";
import { bootstrapDuckDB } from "./createDuckDB";

describe("DuckDB bootstrap cleanup", () => {
  it("metadata failureでconnectionとdatabaseをbest-effort cleanupする", async () => {
    const close = vi.fn().mockRejectedValue(new Error("close failed"));
    const statementClose = vi.fn().mockResolvedValue(undefined);
    const connection = {
      query: vi.fn().mockResolvedValue({ toArray: () => [] }),
      prepare: vi.fn().mockResolvedValue({
        query: vi.fn().mockRejectedValue(new Error("metadata read failed")),
        close: statementClose,
      }),
      close,
    } as unknown as AsyncDuckDBConnection;
    const terminate = vi.fn().mockResolvedValue(undefined);
    const db = {
      instantiate: vi.fn().mockResolvedValue(undefined),
      open: vi.fn().mockResolvedValue(undefined),
      connect: vi.fn().mockResolvedValue(connection),
      terminate,
    } as unknown as AsyncDuckDB;

    await expect(
      bootstrapDuckDB(db, {
        mainModule: "duckdb.wasm",
        mainWorker: "duckdb.worker.js",
        pthreadWorker: null,
      })
    ).rejects.toThrow("metadata read failed");
    expect(statementClose).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(terminate).toHaveBeenCalledOnce();
  });

  it("connection前のfailureでもdatabaseをterminateする", async () => {
    const terminate = vi.fn().mockResolvedValue(undefined);
    const db = {
      instantiate: vi.fn().mockRejectedValue(new Error("instantiate failed")),
      terminate,
    } as unknown as AsyncDuckDB;

    await expect(
      bootstrapDuckDB(db, {
        mainModule: "duckdb.wasm",
        mainWorker: "duckdb.worker.js",
        pthreadWorker: null,
      })
    ).rejects.toThrow("instantiate failed");
    expect(terminate).toHaveBeenCalledOnce();
  });
});
