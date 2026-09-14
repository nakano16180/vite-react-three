import { describe, expect, it } from "vitest";
import {
  persistentSelection,
  reconcileSelection,
  selectionIdentityKey,
  temporarySelection,
  toggleSelection,
} from "./selection";

describe("selection identities", () => {
  it("canonical persistent IDとtemporary namespaceを分離する", () => {
    const persistent = persistentSelection("feature-1");
    const temporary = temporarySelection("query-1", 0);

    expect(selectionIdentityKey(persistent)).toBe("persistent:feature-1");
    expect(selectionIdentityKey(temporary)).toBe("temporary:query-1:0");
    expect(selectionIdentityKey(persistent)).not.toBe(selectionIdentityKey(temporary));
  });

  it("通常クリックは単一、modifierクリックは追加・解除する", () => {
    const first = persistentSelection("feature-1");
    const second = persistentSelection("feature-2");
    expect(toggleSelection([], first, false)).toEqual([first]);
    expect(toggleSelection([first], second, true)).toEqual([first, second]);
    expect(toggleSelection([first, second], first, true)).toEqual([second]);
    expect(toggleSelection([first, second], first, false)).toEqual([first]);
  });

  it("削除済みpersistentと古いqueryのtemporaryをcleanupする", () => {
    const persistent = persistentSelection("feature-1");
    const deleted = persistentSelection("deleted");
    const currentTemporary = temporarySelection("query-2", 0);
    const staleTemporary = temporarySelection("query-1", 1);

    expect(
      reconcileSelection(
        [persistent, deleted, currentTemporary, staleTemporary],
        new Set(["feature-1"]),
        new Set([selectionIdentityKey(currentTemporary)])
      )
    ).toEqual([persistent, currentTemporary]);
  });
});
