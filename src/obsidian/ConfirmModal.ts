import { Modal, type App } from 'obsidian';

export interface ConfirmDialogOptions {
  readonly title: string;
  readonly body: string;
  readonly cancelLabel: string;
  readonly confirmLabel: string;
}

/**
 * Non-blocking Obsidian Modal used to confirm destructive branch deletion
 * when preserved unmapped Markdown blocks exist inside the subtree.
 * Uses only safe Obsidian DOM helpers (no innerHTML).
 */
export class ConfirmDeleteBranchModal extends Modal {
  private settled = false;

  constructor(
    app: App,
    private readonly options: ConfirmDialogOptions,
    private readonly onResult: (confirmed: boolean) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('ito-confirm-modal');

    contentEl.createEl('h3', { text: this.options.title });
    contentEl.createEl('p', { text: this.options.body });

    const actionsEl = contentEl.createDiv({ cls: 'ito-confirm-modal-actions' });
    const cancelBtn = actionsEl.createEl('button', {
      text: this.options.cancelLabel,
      cls: 'ito-btn',
      attr: { type: 'button' },
    });
    const confirmBtn = actionsEl.createEl('button', {
      text: this.options.confirmLabel,
      cls: 'ito-btn ito-btn-danger',
      attr: { type: 'button' },
    });

    cancelBtn.addEventListener('click', () => {
      this.finish(false);
    });
    confirmBtn.addEventListener('click', () => {
      this.finish(true);
    });

    // Focus cancel by default so accidental Enter presses never confirm deletion.
    cancelBtn.focus();
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.settled) {
      this.settled = true;
      this.onResult(false);
    }
  }

  private finish(confirmed: boolean): void {
    if (this.settled) return;
    this.settled = true;
    this.close();
    this.onResult(confirmed);
  }
}

export function promptConfirmDeleteBranch(
  app: App,
  options: ConfirmDialogOptions,
): Promise<boolean> {
  return new Promise((resolve) => {
    const modal = new ConfirmDeleteBranchModal(app, options, resolve);
    modal.open();
  });
}
