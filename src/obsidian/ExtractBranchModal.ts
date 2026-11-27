import { Modal, Notice, type App } from 'obsidian';
import type { Messages } from '../i18n';
import type { ExtractionRecord } from '../sync/branchExtraction';
import { validateVaultNotePath } from '../core/patch/extractBranch';
import { ImeGuard } from '../ui/imeGuard';
import type { ExtractionAdapter } from './ExtractionAdapter';

export interface ExtractChoice {
  destination: string;
  openMap: boolean;
  confirmedRecovery: boolean;
  retryId?: string;
}
interface Options {
  source: string;
  title: string;
  folder: string;
  name: string;
  descendants: number;
  protectedBlocks: number;
  retries: readonly ExtractionRecord[];
  ambiguous: boolean;
  adapter: ExtractionAdapter;
  messages: Messages['extraction'];
  imeWindow: number;
}
export class ExtractBranchModal extends Modal {
  constructor(
    app: App,
    private readonly options: Options,
    private readonly done: (choice: ExtractChoice | null) => void,
  ) {
    super(app);
  }
  onOpen() {
    const o = this.options,
      m = o.messages,
      el = this.contentEl;
    el.addClass('ito-extract-modal');
    this.setTitle(m.title);
    el.createEl('p', {
      text:
        o.title +
        ' · ' +
        m.children +
        ' ' +
        o.descendants +
        ' · ' +
        m.blocks +
        ' ' +
        o.protectedBlocks,
    });
    const retrySelect =
      o.retries.length > 1 ? el.createEl('select', { attr: { 'aria-label': m.saved } }) : null;
    if (retrySelect)
      for (const r of o.retries)
        retrySelect.createEl('option', { text: r.destination, value: r.id });
    const field = (caption: string, type: string) => {
      const label = el.createEl('label', { cls: 'ito-extract-field', text: caption });
      return label.createEl('input', { type });
    };
    const folder = field(m.folder, 'text'),
      name = field(m.name, 'text');
    folder.value = o.folder;
    name.value = o.name;
    const confirmed = o.ambiguous ? field(m.confirm, 'checkbox') : null;
    const open = field(m.open, 'checkbox');
    const status = el.createEl('p', { attr: { role: 'status' } });
    const submit = el.createEl('button', {
      text: o.retries.length ? m.retry : m.create,
      cls: 'mod-cta ito-extract-submit',
    });
    const cancel = el.createEl('button', { text: m.cancel });
    let generation = 0;
    let choice: ExtractChoice | null = null;
    const refresh = async () => {
      const seq = ++generation;
      choice = null;
      submit.disabled = true;
      const retry = o.retries.find((r) => r.id === retrySelect?.value) ?? o.retries[0];
      if (retry) {
        const path = retry.destination.split('/');
        name.value = path.pop()!;
        folder.value = path.join('/');
        folder.readOnly = true;
        name.readOnly = true;
      }
      try {
        const dest = validateVaultNotePath(
          (folder.value.trim() ? folder.value.trim() + '/' : '') + name.value.trim(),
          o.source,
          this.app.vault.configDir,
        );
        const existing = o.adapter.existingPath(dest);
        const valid = retry
          ? (existing === null && retry.phase === 'prepared') ||
            (existing === dest && (await o.adapter.readFile(dest)) === retry.output)
          : existing === null;
        if (seq !== generation) return;
        status.setText(valid ? (retry ? m.saved + ' ' + dest : m.ready) : m.conflict);
        if (!valid || (confirmed && !confirmed.checked)) return;
        choice = {
          destination: dest,
          openMap: open.checked,
          confirmedRecovery: confirmed?.checked ?? false,
          retryId: retry?.id,
        };
        submit.disabled = false;
      } catch {
        if (seq === generation) status.setText(m.conflict);
      }
    };
    for (const control of [folder, name, confirmed, open, retrySelect])
      control?.addEventListener('input', () => void refresh());
    const guard = new ImeGuard();
    el.addEventListener('compositionstart', () => guard.onCompositionStart());
    el.addEventListener('compositionend', () => guard.onCompositionEnd(Date.now()));
    el.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'Enter' && guard.isKeyGuarded(e, Date.now(), o.imeWindow)) {
          e.preventDefault();
          e.stopPropagation();
        }
      },
      true,
    );
    submit.onclick = () => {
      if (choice) {
        this.done(choice);
        this.close();
      }
    };
    cancel.onclick = () => this.close();
    void refresh();
  }
  onClose() {
    this.contentEl.empty();
    this.done(null);
  }
}

export function showExtractionRecovery(
  app: App,
  records: readonly ExtractionRecord[],
  m: Messages['extraction'],
  onDismiss?: (record: ExtractionRecord) => Promise<void>,
) {
  const modal = new Modal(app);
  modal.setTitle(m.recovery);
  modal.contentEl.addClass('ito-extract-recovery-modal');
  const renderEmptyIfNeeded = () => {
    if (!modal.contentEl.querySelector('.ito-extract-recovery-card')) {
      modal.contentEl.createEl('p', { text: m.none });
    }
  };
  if (!records.length) {
    modal.contentEl.createEl('p', { text: m.none });
    modal.open();
    return;
  }
  for (const r of records) {
    const card = modal.contentEl.createDiv({ cls: 'ito-extract-recovery-card' });
    card.createEl('h4', { text: r.source + ' → ' + r.destination });
    card.createEl('p', {
      text: r.anchor.ancestorPath.concat(r.anchor.titleRaw).join(' / '),
    });
    const area = card.createEl('textarea', {
      cls: 'ito-extract-recovery',
      attr: { 'aria-label': m.original, readonly: '' },
    });
    area.value = r.originalBranch;
    area.onfocus = () => area.select();

    const copyBtn = card.createEl('button', {
      text: m.copyOriginal,
      cls: 'ito-btn ito-extract-copy',
      attr: { type: 'button' },
    });
    copyBtn.addEventListener('click', () => {
      const clipboard = card.ownerDocument.defaultView?.navigator?.clipboard;
      if (clipboard && typeof clipboard.writeText === 'function') {
        void clipboard
          .writeText(r.originalBranch)
          .then(() => {
            new Notice(m.copiedNotice);
          })
          .catch(() => {
            area.focus();
            area.select();
          });
      } else {
        area.focus();
        area.select();
      }
    });

    if (onDismiss) {
      const dismissWrap = card.createDiv({ cls: 'ito-extract-recovery-dismiss' });
      const confirmLabel = dismissWrap.createEl('label', { cls: 'ito-extract-field' });
      const confirmBox = confirmLabel.createEl('input', {
        type: 'checkbox',
        cls: 'ito-extract-dismiss-confirm',
      });
      confirmLabel.createSpan({ text: m.dismissConfirm });

      const dismissBtn = dismissWrap.createEl('button', {
        text: m.dismissButton,
        cls: 'ito-btn ito-btn-danger ito-extract-dismiss',
        attr: { type: 'button' },
      });
      dismissBtn.disabled = true;
      confirmBox.addEventListener('change', () => {
        dismissBtn.disabled = !confirmBox.checked;
      });
      dismissBtn.addEventListener('click', () => {
        if (!confirmBox.checked) return;
        dismissBtn.disabled = true;
        confirmBox.disabled = true;
        void onDismiss(r)
          .then(() => {
            card.remove();
            renderEmptyIfNeeded();
            new Notice(m.dismissedNotice);
          })
          .catch(() => {
            confirmBox.disabled = false;
            dismissBtn.disabled = !confirmBox.checked;
            new Notice(m.dismissFailedNotice);
          });
      });
    }
  }
  modal.open();
}
