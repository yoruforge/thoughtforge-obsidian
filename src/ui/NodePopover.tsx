import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
} from 'react';
import type { DraftEntry, MindMapDocument, TopicLink, TopicNode } from '../core/model';
import type { Messages } from '../i18n';
import type { CommandDispatchOutcome } from '../sync/ports';
import { createNoteEditingSession, type NoteEditingSession } from './editSession';
import { ImeGuard, type GuardableKeyEvent } from './imeGuard';
import { shouldHandlePopoverDocumentEscape } from './keyboardGuard';

export interface NoteCommitOutcome extends CommandDispatchOutcome {
  readonly rescuedDraftId?: string;
  readonly rescuedDraftRevision?: number;
}

export interface NodePopoverProps {
  readonly filePath: string;
  readonly document: MindMapDocument;
  readonly node: TopicNode;
  readonly messages: Messages;
  readonly isReadOnly: boolean;
  readonly canEdit: boolean;
  readonly imeGuardWindowMs: number;
  readonly startEditingNoteToken: number;
  readonly onConsumeNoteEditRequest?: () => void;
  readonly nodeDrafts: readonly DraftEntry[];
  readonly ambiguousDrafts?: readonly DraftEntry[];
  readonly unpersistedDraftIds?: ReadonlySet<string>;
  readonly draftRevisions?: ReadonlyMap<string, number>;
  readonly noteCommitTriggerRef?: MutableRefObject<((event: GuardableKeyEvent) => boolean) | null>;
  readonly onGetDraftSnapshotRevision?: () => number;
  readonly onCommitNote?: (
    session: NoteEditingSession,
    nextNoteBody: string,
  ) => Promise<NoteCommitOutcome>;
  readonly onRescueNoteDraft?: (session: NoteEditingSession, unsavedBody: string) => void;
  readonly onRestoreTitleDraft?: (
    nodeId: string,
    draftText: string,
    draftId: string,
    draftRevision?: number,
  ) => void;
  readonly onDeleteDraft?: (draftId: string, expectedRevision?: number) => void;
  readonly onCopyDraftText?: (draftText: string) => void;
  readonly onClose: () => void;
  readonly onJumpToSource: (line: number) => void;
  readonly onOpenLink: (link: TopicLink, newTab: boolean) => void;
}

export function NodePopover({
  filePath,
  document: doc,
  node,
  messages,
  isReadOnly,
  canEdit,
  imeGuardWindowMs,
  startEditingNoteToken,
  onConsumeNoteEditRequest,
  nodeDrafts,
  ambiguousDrafts = [],
  unpersistedDraftIds,
  draftRevisions,
  noteCommitTriggerRef,
  onGetDraftSnapshotRevision,
  onCommitNote,
  onRescueNoteDraft,
  onRestoreTitleDraft,
  onDeleteDraft,
  onCopyDraftText,
  onClose,
  onJumpToSource,
  onOpenLink,
}: NodePopoverProps) {
  const editable = canEdit && !isReadOnly && onCommitNote !== undefined;
  const [noteSession, setNoteSession] = useState<NoteEditingSession | null>(null);
  const [draftText, setDraftText] = useState<string>(node.noteText ?? '');
  const [isSaving, setIsSaving] = useState(false);

  const popoverRef = useRef<HTMLElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const imeGuardRef = useRef(new ImeGuard());
  const imeGuardWindowMsRef = useRef(imeGuardWindowMs);
  imeGuardWindowMsRef.current = imeGuardWindowMs;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const noteSessionRef = useRef(noteSession);
  noteSessionRef.current = noteSession;
  const draftTextRef = useRef(draftText);
  draftTextRef.current = draftText;
  const isSavingRef = useRef(isSaving);
  isSavingRef.current = isSaving;
  const onRescueNoteDraftRef = useRef(onRescueNoteDraft);
  onRescueNoteDraftRef.current = onRescueNoteDraft;
  const lastStartTokenRef = useRef(0);

  const cancelNoteEditExplicitly = useCallback(() => {
    if (isSavingRef.current) return;
    noteSessionRef.current = null;
    setNoteSession(null);
  }, []);

  // Rescue unsaved note text to DraftStore if the user switches topics/files or an
  // external edit shifts node IDs before they commit or explicitly cancel.
  useEffect(() => {
    return () => {
      const pendingSession = noteSessionRef.current;
      const pendingText = draftTextRef.current;
      if (
        !isSavingRef.current &&
        pendingSession !== null &&
        pendingText.trim().length > 0 &&
        pendingText !== pendingSession.initialNoteText
      ) {
        onRescueNoteDraftRef.current?.(pendingSession, pendingText);
      }
      noteSessionRef.current = null;
    };
  }, [filePath, node.id]);

  // Reset local note edit state when switching to a different topic or file
  useEffect(() => {
    setNoteSession(null);
    setIsSaving(false);
    imeGuardRef.current.reset();
  }, [filePath, node.id]);

  // Keep preview text synced when not actively editing
  useEffect(() => {
    if (noteSession === null) {
      setDraftText(node.noteText ?? '');
    }
  }, [node.noteText, noteSession]);

  const beginNoteEdit = useCallback(
    (prefill?: string, restoredDraftId?: string, restoredDraftRevision?: number) => {
      if (!editable || isSavingRef.current) return;
      const snapshotRev = onGetDraftSnapshotRevision?.();
      const session = createNoteEditingSession(
        filePath,
        doc,
        node,
        restoredDraftId,
        restoredDraftRevision,
        restoredDraftRevision ?? snapshotRev,
      );
      setNoteSession(session);
      setDraftText(prefill !== undefined ? prefill : (node.noteText ?? ''));
    },
    [editable, filePath, doc, node, onGetDraftSnapshotRevision],
  );

  // Triggered when user invokes Cmd/Ctrl+Shift+T or Command Palette "Edit topic note"
  useEffect(() => {
    if (startEditingNoteToken === 0) {
      lastStartTokenRef.current = 0;
      return;
    }
    if (startEditingNoteToken !== lastStartTokenRef.current) {
      lastStartTokenRef.current = startEditingNoteToken;
      onConsumeNoteEditRequest?.();
      if (editable) {
        const existingNoteDraft = nodeDrafts.find((d) => d.field === 'note');
        if (existingNoteDraft) {
          beginNoteEdit(
            existingNoteDraft.text,
            existingNoteDraft.draftId,
            draftRevisions?.get(existingNoteDraft.draftId),
          );
        } else {
          beginNoteEdit(node.noteText ?? '');
        }
      }
    }
  }, [
    startEditingNoteToken,
    onConsumeNoteEditRequest,
    editable,
    beginNoteEdit,
    node.noteText,
    nodeDrafts,
    draftRevisions,
  ]);

  // Focus textarea when note edit mode opens
  useEffect(() => {
    if (noteSession !== null) {
      const ta = textareaRef.current;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
      }
    }
  }, [noteSession]);

  const commitNoteNow = useCallback(async (): Promise<void> => {
    const activeSession = noteSessionRef.current;
    if (!activeSession || !onCommitNote || isSavingRef.current) return;
    isSavingRef.current = true;
    setIsSaving(true);
    try {
      const outcome = await onCommitNote(activeSession, draftTextRef.current);
      if (outcome.accepted || outcome.rejectCode === 'boundary-no-op') {
        noteSessionRef.current = null;
        setNoteSession(null);
      } else if (
        outcome.rescuedDraftId !== undefined &&
        outcome.rescuedDraftRevision !== undefined &&
        noteSessionRef.current === activeSession
      ) {
        const updatedSession: NoteEditingSession = {
          ...activeSession,
          restoredDraftId: outcome.rescuedDraftId,
          restoredDraftRevision: outcome.rescuedDraftRevision,
          draftSnapshotRevision: outcome.rescuedDraftRevision,
        };
        noteSessionRef.current = updatedSession;
        setNoteSession(updatedSession);
      }
      // On failure (dirty editor, stale target, block syntax, etc.) keep textarea open with
      // the user's text intact while App/DraftStore persists the field:'note' draft.
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  }, [onCommitNote]);

  // Register Mod+Enter trigger for MindMapView.scope (Obsidian intercepts Mod+Enter globally)
  useEffect(() => {
    if (!noteCommitTriggerRef) return;
    if (noteSession === null) {
      noteCommitTriggerRef.current = null;
      return;
    }
    noteCommitTriggerRef.current = (event: GuardableKeyEvent): boolean => {
      if (imeGuardRef.current.isKeyGuarded(event, Date.now(), imeGuardWindowMsRef.current)) {
        return false;
      }
      void commitNoteNow();
      return true;
    };
    return () => {
      noteCommitTriggerRef.current = null;
    };
  }, [noteCommitTriggerRef, noteSession, commitNoteNow]);

  // Scoped Escape listener on ownerDocument (never steals from Obsidian overlays or other panes)
  useEffect(() => {
    const el = popoverRef.current;
    if (!el) return;
    const ownerDoc = el.ownerDocument;
    const rootEl = el.closest('.ito-root');
    const handleDocKeyDown = (event: KeyboardEvent): void => {
      if (!shouldHandlePopoverDocumentEscape(ownerDoc, rootEl, event)) {
        return;
      }
      if (noteSessionRef.current !== null && imeGuardRef.current.isCompositionActive(event)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (noteSessionRef.current !== null) {
        cancelNoteEditExplicitly();
      } else {
        onCloseRef.current();
      }
    };
    ownerDoc.addEventListener('keydown', handleDocKeyDown, true);
    return () => ownerDoc.removeEventListener('keydown', handleDocKeyDown, true);
  }, [cancelNoteEditExplicitly]);

  const handlePopoverKeyDown = (event: ReactKeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Escape') {
      if (noteSession !== null && imeGuardRef.current.isCompositionActive(event.nativeEvent)) {
        event.stopPropagation();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (noteSession !== null) {
        cancelNoteEditExplicitly();
      } else {
        onCloseRef.current();
      }
      return;
    }
    // Keep Tab/Enter/Space/Arrow keys strictly inside the dialog
    event.stopPropagation();
  };

  const handleTextareaKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      if (imeGuardRef.current.isCompositionActive(event.nativeEvent)) {
        return;
      }
      event.preventDefault();
      cancelNoteEditExplicitly();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !event.shiftKey && !event.altKey) {
      if (imeGuardRef.current.isKeyGuarded(event.nativeEvent, Date.now(), imeGuardWindowMsRef.current)) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      void commitNoteNow();
    }
  };

  return (
    <aside
      ref={popoverRef}
      className="ito-popover"
      role="dialog"
      aria-label={messages.popover.title}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={handlePopoverKeyDown}
    >
      <div className="ito-popover-header">
        <div className="ito-popover-title-wrap">
          <strong className="ito-popover-title">
            {node.displayTitle.length > 0 ? node.displayTitle : '(untitled)'}
          </strong>
          <span className="ito-popover-meta">
            {messages.popover.sourceLine} {node.headerLine + 1}
          </span>
        </div>
        <button
          type="button"
          className="ito-btn ito-btn-icon"
          aria-label={messages.popover.close}
          disabled={isSaving}
          onClick={() => {
            if (!isSavingRef.current) onClose();
          }}
        >
          ×
        </button>
      </div>

      {nodeDrafts.length > 0 && (
        <div className="ito-draft-banner" role="region" aria-label={messages.popover.draftBannerTitle}>
          <div className="ito-draft-banner-title">{messages.popover.draftBannerTitle}</div>
          {nodeDrafts.map((draft) => (
            <div key={draft.draftId} className="ito-draft-item">
              <div className="ito-draft-item-meta">
                <span className="ito-draft-field-badge">
                  {draft.field === 'note'
                    ? messages.popover.draftFieldNote
                    : messages.popover.draftFieldTitle}
                </span>
                {unpersistedDraftIds?.has(draft.draftId) && (
                  <span className="ito-draft-unpersisted-badge">
                    {messages.popover.draftUnpersistedBadge}
                  </span>
                )}
                <span className="ito-draft-preview-text">{draft.text.slice(0, 80)}</span>
              </div>
              <div className="ito-draft-item-actions">
                {draft.field === 'note' && editable && (
                  <button
                    type="button"
                    className="ito-btn ito-btn-primary ito-draft-restore-btn"
                    onClick={() =>
                      beginNoteEdit(draft.text, draft.draftId, draftRevisions?.get(draft.draftId))
                    }
                  >
                    {messages.popover.draftRestoreButton}
                  </button>
                )}
                {draft.field === 'title' && editable && onRestoreTitleDraft && (
                  <button
                    type="button"
                    className="ito-btn ito-btn-primary ito-draft-restore-btn"
                    onClick={() =>
                      onRestoreTitleDraft(
                        node.id,
                        draft.text,
                        draft.draftId,
                        draftRevisions?.get(draft.draftId),
                      )
                    }
                  >
                    {messages.popover.draftRestoreButton}
                  </button>
                )}
                {onCopyDraftText && (
                  <button
                    type="button"
                    className="ito-btn ito-draft-copy-btn"
                    onClick={() => onCopyDraftText(draft.text)}
                  >
                    {messages.popover.draftCopyButton}
                  </button>
                )}
                {onDeleteDraft && (
                  <button
                    type="button"
                    className="ito-btn ito-draft-discard-btn"
                    onClick={() => onDeleteDraft(draft.draftId, draftRevisions?.get(draft.draftId))}
                  >
                    {messages.popover.draftDiscardButton}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {ambiguousDrafts.length > 0 && (
        <div
          className="ito-draft-banner ito-draft-banner-ambiguous"
          role="region"
          aria-label={messages.popover.draftAmbiguousTitle}
        >
          <div className="ito-draft-banner-title">{messages.popover.draftAmbiguousTitle}</div>
          <p className="ito-draft-banner-hint">{messages.popover.draftAmbiguousHint}</p>
          {ambiguousDrafts.map((draft) => {
            const contextParts: string[] = [];
            if (draft.targetTitleRaw.length > 0) {
              contextParts.push(
                `${messages.popover.draftSavedContextTopic}: ${draft.targetTitleRaw}`,
              );
            }
            if (draft.targetHeaderLine !== undefined) {
              contextParts.push(
                `${messages.popover.draftSavedContextLine} ${draft.targetHeaderLine + 1}`,
              );
            }
            if (draft.targetAncestorPath !== undefined && draft.targetAncestorPath.length > 0) {
              contextParts.push(
                `${messages.popover.draftSavedContextParent}: ${draft.targetAncestorPath.join(' / ')}`,
              );
            }
            return (
              <div key={draft.draftId} className="ito-draft-item">
                <div className="ito-draft-item-meta">
                  <span className="ito-draft-field-badge">
                    {draft.field === 'note'
                      ? messages.popover.draftFieldNote
                      : messages.popover.draftFieldTitle}
                  </span>
                  {unpersistedDraftIds?.has(draft.draftId) && (
                    <span className="ito-draft-unpersisted-badge">
                      {messages.popover.draftUnpersistedBadge}
                    </span>
                  )}
                  <span className="ito-draft-preview-text">{draft.text.slice(0, 80)}</span>
                </div>
                {contextParts.length > 0 && (
                  <div className="ito-draft-context-meta">{contextParts.join(' ・ ')}</div>
                )}
                <div className="ito-draft-item-actions">
                  {draft.field === 'note' && editable && (
                    <button
                      type="button"
                      className="ito-btn ito-btn-primary ito-draft-restore-btn"
                      onClick={() =>
                        beginNoteEdit(draft.text, draft.draftId, draftRevisions?.get(draft.draftId))
                      }
                    >
                      {messages.popover.draftRestoreHereButton}
                    </button>
                  )}
                  {draft.field === 'title' && editable && onRestoreTitleDraft && (
                    <button
                      type="button"
                      className="ito-btn ito-btn-primary ito-draft-restore-btn"
                      onClick={() =>
                        onRestoreTitleDraft(
                          node.id,
                          draft.text,
                          draft.draftId,
                          draftRevisions?.get(draft.draftId),
                        )
                      }
                    >
                      {messages.popover.draftRestoreHereButton}
                    </button>
                  )}
                  {onCopyDraftText && (
                    <button
                      type="button"
                      className="ito-btn ito-draft-copy-btn"
                      onClick={() => onCopyDraftText(draft.text)}
                    >
                      {messages.popover.draftCopyButton}
                    </button>
                  )}
                  {onDeleteDraft && (
                    <button
                      type="button"
                      className="ito-btn ito-draft-discard-btn"
                      onClick={() =>
                        onDeleteDraft(draft.draftId, draftRevisions?.get(draft.draftId))
                      }
                    >
                      {messages.popover.draftDiscardButton}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="ito-popover-section">
        <div className="ito-popover-section-header">
          <div className="ito-popover-section-title">{messages.popover.noteHeading}</div>
          {editable && noteSession === null && (
            <button
              type="button"
              className="ito-btn ito-note-edit-btn"
              onClick={() => beginNoteEdit()}
            >
              {messages.popover.noteEditButton}
            </button>
          )}
        </div>

        {noteSession !== null ? (
          <div className="ito-note-editor-wrap">
            <textarea
              ref={textareaRef}
              className="ito-note-editor-textarea"
              rows={5}
              value={draftText}
              readOnly={isSaving}
              placeholder={messages.popover.noteEditPlaceholder}
              aria-label={messages.popover.noteHeading}
              onChange={(event) => setDraftText(event.target.value)}
              onCompositionStart={() => imeGuardRef.current.onCompositionStart()}
              onCompositionEnd={() => imeGuardRef.current.onCompositionEnd(Date.now())}
              onKeyDown={handleTextareaKeyDown}
            />
            <div className="ito-note-editor-footer">
              <span className="ito-note-shortcut-hint">{messages.popover.noteShortcutHint}</span>
              <div className="ito-note-editor-actions">
                <button
                  type="button"
                  className="ito-btn ito-note-cancel-btn"
                  disabled={isSaving}
                  onClick={cancelNoteEditExplicitly}
                >
                  {messages.popover.noteCancelButton}
                </button>
                <button
                  type="button"
                  className="ito-btn ito-btn-primary ito-note-save-btn"
                  disabled={isSaving}
                  onClick={() => void commitNoteNow()}
                >
                  {messages.popover.noteSaveButton}
                </button>
              </div>
            </div>
          </div>
        ) : node.noteText !== null ? (
          <pre
            className="ito-popover-note-preview"
            onDoubleClick={() => {
              if (editable) beginNoteEdit();
            }}
          >
            {node.noteText}
          </pre>
        ) : (
          <p className="ito-popover-empty">{messages.popover.noteEmpty}</p>
        )}
      </div>

      {node.links.length > 0 && (
        <div className="ito-popover-section">
          <div className="ito-popover-section-title">{messages.popover.linksHeading}</div>
          <ul className="ito-popover-list">
            {node.links.map((link, index) => (
              <li key={`${link.kind}-${link.target}-${index}`}>
                <button
                  type="button"
                  className="ito-link-button"
                  onClick={(event) => onOpenLink(link, event.metaKey || event.ctrlKey)}
                >
                  {link.label} ({link.target})
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {node.unmappedBlocks.length > 0 && (
        <div className="ito-popover-section">
          <div className="ito-popover-section-title">{messages.popover.unmappedHeading}</div>
          <ul className="ito-popover-list">
            {node.unmappedBlocks.map((block, index) => {
              const count = block.range.endLine - block.range.startLine;
              return (
                <li
                  key={`${block.kind}-${block.range.startLine}-${index}`}
                  className="ito-unmapped-item"
                >
                  <span>
                    {block.kind} ({count} {messages.popover.lineUnit}, L{block.range.startLine + 1})
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="ito-popover-footer">
        <button
          type="button"
          className="ito-btn"
          onClick={() => onJumpToSource(node.headerLine)}
        >
          {messages.popover.jumpToSource}
        </button>
      </div>
    </aside>
  );
}
