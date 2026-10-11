import type { ProposalFile, ProposalItem } from "@thoughtforge/core";

export type ProposalPanelItem = {
  id: string; op: ProposalItem["op"]; targetLabel: string; text: string;
  provenance: ProposalItem["provenance"];
  state: "pending" | "applied" | "rejected" | "invalid" | "display";
  reason?: string; dependsOn: string[]; rationale?: string;
  sources?: NonNullable<ProposalItem["sources"]>[number][];
  status?: ProposalItem["status"]; targetNodeId?: string; editableField?: "text" | "note";
};
export type ProposalPanelSnapshot = {
  files: { id: string; filename: string; task?: ProposalFile["task"]; createdAt?: string;
    status: "ready" | "invalid" | "stale"; reason?: string; baseVersion: string; items: ProposalPanelItem[] }[];
  selectedId?: string; trusted: boolean; busy?: boolean; error?: { message: string; itemId?: string };
};
export type ProposalUpdateMessage = {
  source: "extension"; type: "thoughtforge.proposal.update"; protocolVersion: 1;
  documentUri: string; state: ProposalPanelSnapshot; styles?: string;
};
type Envelope = { source: "webview"; type: "thoughtforge.proposal.action"; protocolVersion: 1; documentUri: string };
export type ProposalActionMessage = Envelope & (
  | { action: "list" | "close" }
  | { action: "select" | "confirm-stale" | "recreate"; proposalId: string }
  | { action: "approve"; proposalId: string; itemIds: string[]; baseVersion: string }
  | { action: "reject" | "restore"; proposalId: string; itemIds: string[] }
  | { action: "edit"; proposalId: string; itemId: string; text: string }
);
const hash = (value: unknown): value is string => typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
const itemId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
/** Strict envelope: extra fields and values outside the bounded contract are rejected. */
export function isProposalActionMessage(value: unknown): value is ProposalActionMessage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  if (v.source !== "webview" || v.type !== "thoughtforge.proposal.action" || v.protocolVersion !== 1
    || typeof v.documentUri !== "string" || v.documentUri.length < 1 || v.documentUri.length > 16_384) return false;
  const base = ["source", "type", "protocolVersion", "documentUri", "action"];
  const exact = (...keys: string[]) => Object.keys(v).every((key) => [...base, ...keys].includes(key));
  if (v.action === "list" || v.action === "close") return exact();
  if (!hash(v.proposalId)) return false;
  if (["select", "confirm-stale", "recreate"].includes(v.action as string)) return exact("proposalId");
  if (v.action === "edit") return exact("proposalId", "itemId", "text") && itemId(v.itemId)
    && typeof v.text === "string" && [...v.text].length >= 1 && [...v.text].length <= 4000;
  if (["approve", "reject", "restore"].includes(v.action as string)) {
    return exact("proposalId", "itemIds", ...(v.action === "approve" ? ["baseVersion"] : []))
      && Array.isArray(v.itemIds) && v.itemIds.length > 0 && v.itemIds.length <= 200
      && v.itemIds.every(itemId) && new Set(v.itemIds).size === v.itemIds.length
      && (v.action !== "approve" || hash(v.baseVersion));
  }
  return false;
}
