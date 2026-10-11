import type { DraftSaveMessage, DraftSaveResultMessage } from './draftTypes.ts';

type DraftInput = Omit<DraftSaveMessage, 'final'>;
/** Existing final-save contract, independent of the still-pending renderer flush handshake. */
export class DraftNavigationGate {
  private active = true;
  private running = false;
  private cancelSend?: () => void;
  private readonly issued = new Map<string, number>();
  private pending?: { draftId: string; revision: number; resolve: (ok: boolean) => void };
  private equal(a: any, b: any): boolean {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every(k => Object.hasOwn(b, k) && this.equal(a[k], b[k]));
  }
  accept(result: DraftSaveResultMessage): void {
    const p = this.pending;
    if (!this.active || result.source !== 'extension' || result.type !== 'thoughtforge.draft.save.result' ||
      result.protocolVersion !== 2 || !p || result.draftId !== p.draftId || result.revision !== p.revision) return;
    this.pending = undefined; p.resolve(result.ok === true);
    if (result.ok !== true) this.cancelSend?.();
  }
  close(): void { this.active = false; this.cancelSend?.(); this.pending?.resolve(false); this.pending = undefined; }
  /** All autosave sends must be recorded; the caller must reserve a fresh revision for final sends. */
  recordSent(message: DraftSaveMessage): void {
    this.issued.set(message.draftId, Math.max(this.issued.get(message.draftId) ?? -1, message.revision));
  }
  async navigate(readDraft: () => DraftInput | undefined, send: (message: DraftSaveMessage) => boolean | void | Promise<boolean | void>,
    navigate: () => void | Promise<void>, valid: () => boolean,
    reserveFinal?: (draft: DraftInput, minimumExclusive: number) => DraftInput): Promise<boolean> {
    if (!this.active || this.running || !valid()) return false;
    this.running = true;
    try {
      while (this.active && valid()) {
        const draft = readDraft();
        if (!draft) { await navigate(); return true; }
        let captured = structuredClone(draft);
        const issued = this.issued.get(captured.draftId) ?? -1;
        // The renderer owns its monotone counter. Reservation must also update readDraft's current revision.
        if (reserveFinal) {
          const reserved = structuredClone(reserveFinal(structuredClone(captured), Math.max(issued, captured.revision - 1)));
          if (!this.equal({ ...reserved, revision: captured.revision, savedAt: captured.savedAt }, captured) || !Number.isFinite(Date.parse(reserved.savedAt))) return false;
          captured = reserved;
        }
        if (!Number.isSafeInteger(captured.revision) || captured.revision < 0 ||
          captured.revision <= (this.issued.get(captured.draftId) ?? -1)) return false;
        this.recordSent({ ...captured, final: true });
        const ack = new Promise<boolean>(resolve => { this.pending = { draftId: captured.draftId, revision: captured.revision, resolve }; });
        const cancelled = new Promise<false>(resolve => { this.cancelSend = () => resolve(false); });
        try {
          // Cancellation retires navigation, not an already admitted store save.
          const sent = Promise.resolve(send({ ...captured, final: true })).then(value => value !== false, () => false);
          if (!await Promise.race([sent, cancelled])) {
            this.pending?.resolve(false); this.pending = undefined; return false;
          }
          this.cancelSend = undefined;
        }
        catch { this.pending?.resolve(false); this.pending = undefined; return false; }
        if (!await ack || !this.active || !valid()) return false;
        const latest = readDraft();
        if (!latest) { await navigate(); return true; }
        if (latest.draftId !== captured.draftId || latest.revision > captured.revision) continue;
        // Never accept changed input carried under an obsolete or reused revision.
        if (latest.revision !== captured.revision || latest.text !== captured.text ||
          !this.equal(latest.target, captured.target) || latest.savedAt !== captured.savedAt || latest.documentUri !== captured.documentUri) return false;
        await navigate(); return true;
      }
      return false;
    } finally { this.cancelSend = undefined; this.running = false; }
  }
}
