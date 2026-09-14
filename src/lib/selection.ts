export type SelectionIdentity =
  | { kind: "persistent"; featureId: string }
  | { kind: "temporary"; queryKey: string; rowIndex: number };

export const persistentSelection = (featureId: string): SelectionIdentity => ({
  kind: "persistent",
  featureId,
});

export const temporarySelection = (queryKey: string, rowIndex: number): SelectionIdentity => ({
  kind: "temporary",
  queryKey,
  rowIndex,
});

export const selectionIdentityKey = (identity: SelectionIdentity): string =>
  identity.kind === "persistent"
    ? `persistent:${identity.featureId}`
    : `temporary:${identity.queryKey}:${identity.rowIndex}`;

export const sameSelectionIdentity = (left: SelectionIdentity, right: SelectionIdentity): boolean =>
  selectionIdentityKey(left) === selectionIdentityKey(right);

export const toggleSelection = (
  current: SelectionIdentity[],
  next: SelectionIdentity,
  additive: boolean
): SelectionIdentity[] => {
  if (!additive) return [next];
  const existingIndex = current.findIndex((identity) => sameSelectionIdentity(identity, next));
  if (existingIndex < 0) return [...current, next];
  return current.filter((_, index) => index !== existingIndex);
};

export const reconcileSelection = (
  current: SelectionIdentity[],
  persistentFeatureIds: ReadonlySet<string>,
  temporaryIdentityKeys: ReadonlySet<string>
): SelectionIdentity[] =>
  current.filter((identity) =>
    identity.kind === "persistent"
      ? persistentFeatureIds.has(identity.featureId)
      : temporaryIdentityKeys.has(selectionIdentityKey(identity))
  );

export const describeSelection = (identity: SelectionIdentity): string =>
  identity.kind === "persistent"
    ? `persistent:${identity.featureId}`
    : `temporary:${identity.queryKey}:row-${identity.rowIndex + 1}`;
