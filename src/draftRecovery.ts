import { cloneDraftTarget, isDraftExpired, type DraftRecord, type DraftTarget, type PluginDataV2 } from "./draftData.ts";
export type DraftRecoverySnapshot = Readonly<{
  contentHash: string;
  nodes: readonly Readonly<{ nodeId: string; titleSource: string; ownRangeHash: string }>[];
  center: Readonly<{ kind: "h1" | "filename" | "map-md"; titleSource: string; anchorHash?: string }>;
}>;
export type DraftMatch = Readonly<{ kind: "same-version" | "unique"; target: string }> | Readonly<{ kind: "none" }>;
export type RestoredDraft = Readonly<Pick<DraftRecord, "draftId" | "revision" | "target" | "text" | "savedAt"> &
  { expired: boolean; match: DraftMatch }>;

/** Produces candidates only. Applying them still requires the host's ordinary write gates. */
export function matchDraftTarget(target: DraftTarget, current: DraftRecoverySnapshot): DraftMatch {
  if (target.kind === "pending-child") return { kind: "none" };
  if (target.baseHash === current.contentHash) {
    if (target.kind === "node") {
      const matches = current.nodes.filter((node) => node.nodeId === target.nodeId && node.titleSource === target.titleSource);
      return matches.length === 1 ? { kind: "same-version", target: matches[0]!.nodeId } : { kind: "none" };
    }
    return current.center.kind === target.centerKind && current.center.titleSource === target.titleSource ?
      { kind: "same-version", target: "center" } : { kind: "none" };
  }
  if (target.kind === "node") {
    const matches = current.nodes.filter((node) => node.titleSource === target.titleSource && node.ownRangeHash === target.ownRangeHash);
    return matches.length === 1 ? { kind: "unique", target: matches[0]!.nodeId } : { kind: "none" };
  }
  if (target.centerKind !== current.center.kind) return { kind: "none" };
  const sameCenter = target.centerKind === "h1" ? target.anchorHash !== undefined && current.center.anchorHash === target.anchorHash :
    current.center.titleSource === target.titleSource;
  return sameCenter ? { kind: "unique", target: "center" } : { kind: "none" };
}

export function restoreDrafts(data: PluginDataV2, deviceId: string | undefined, path: string,
  current: DraftRecoverySnapshot, now: number, automatic = true): Readonly<{ drafts: readonly RestoredDraft[]; otherDeviceCount: number }> {
  // Unavailable is distinct from another device; do not expose content or reclassify it.
  if (!deviceId) return { drafts: [], otherDeviceCount: 0 };
  const drafts = data.drafts.filter((draft) => draft.deviceId === deviceId && draft.path === path).map((draft) => ({
    draftId: draft.draftId, revision: draft.revision, target: cloneDraftTarget(draft.target), text: draft.text, savedAt: draft.savedAt,
    expired: isDraftExpired(draft.savedAt, now), match: matchDraftTarget(draft.target, current),
  }));
  return { drafts: automatic ? drafts.filter((draft) => !draft.expired) : drafts,
    otherDeviceCount: data.drafts.filter((draft) => draft.path === path && draft.deviceId !== deviceId).length };
}

/** Caption projection only: deliberately cannot be saved, serialized or restored as a DraftRecord. */
export type RemainingDraftListItem = Readonly<{ draftId: string; revision: number; path: string; text: string;
  target: Readonly<{ titleSource: string }>; expired: boolean }>;
export function listRemainingDrafts(data: PluginDataV2, deviceId: string | undefined, now: number): readonly RemainingDraftListItem[] {
  return deviceId ? data.drafts.filter(draft => draft.deviceId === deviceId).map(draft => ({
    draftId: draft.draftId, revision: draft.revision, path: draft.path, text: draft.text,
    target: { titleSource: draft.target.kind === "pending-child" ? `${draft.target.parentChain.at(-1)!.titleSource} の未作成の子` : draft.target.titleSource },
    expired: isDraftExpired(draft.savedAt, now),
  })) : [];
}

/** Explicit host-only recovery: carries no save/clear/restore identity or target proof. */
export type ReadonlyDraftListItem = Readonly<{ deviceId: string; path: string; text: string; savedAt: string;
  target: Readonly<{ kind: DraftTarget["kind"]; field: "title" | "note"; titleSource: string }>; expired: boolean }>;
export function listReadonlyDrafts(data: PluginDataV2, deviceId: string | undefined, now: number): readonly ReadonlyDraftListItem[] {
  // The caller supplies a validated store snapshot. Unknown identity means all IDs,
  // without inferring which one belonged to this device before recovery.
  return data.drafts.filter(draft => !deviceId || draft.deviceId !== deviceId).map(draft => ({
    deviceId: draft.deviceId, path: draft.path, text: draft.text, savedAt: draft.savedAt,
    target: { kind: draft.target.kind, field: draft.target.field,
      titleSource: draft.target.kind === "pending-child" ? `${draft.target.parentChain.at(-1)!.titleSource} の未作成の子` : draft.target.titleSource },
    expired: isDraftExpired(draft.savedAt, now),
  }));
}
