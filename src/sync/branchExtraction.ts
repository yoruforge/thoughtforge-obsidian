import {
  editableMap,
  planBranchExtraction,
  validateVaultNotePath,
  type ReferenceEdit,
} from '../core/patch/extractBranch';
import { createHistoryAnchor, resolveHistoryAnchor } from '../core/view/topicResolver';
import type { MapHistoryAnchor } from '../core/view/navigationHistory';
import { checkMarkdownEditorGate } from './MarkdownEditorGate';
import type { ObsidianHostPort } from './ports';

export interface ExtractionRecord {
  readonly id: string;
  readonly source: string;
  readonly destination: string;
  readonly anchor: MapHistoryAnchor;
  readonly originalBranch: string;
  readonly output: string;
  readonly before: string;
  readonly after: string;
  readonly line: number;
  readonly phase: 'prepared' | 'created' | 'replacing';
}

export interface ExtractionHost
  extends Pick<ObsidianHostPort, 'readFile' | 'processFile' | 'inspectOpenMarkdownEditors'> {
  existingPath(path: string): string | null;
  createNote(path: string, text: string): Promise<void>;
  version(path: string): number;
  linkTo(destination: string, source: string, alias: string): string;
  referenceEdits(
    source: string,
    before: string,
    anchor: MapHistoryAnchor,
    destination: string,
  ): Promise<readonly ReferenceEdit[]>;
  records(): readonly ExtractionRecord[];
  put(record: ExtractionRecord): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface ExtractionRequest {
  source: string;
  destination: string;
  before: string;
  anchor: MapHistoryAnchor;
  retryId?: string;
  /** Explicit confirmation of a user-selected branch during ambiguous recovery. */
  confirmedRecovery?: boolean;
}

function clean(host: ExtractionHost, path: string): void {
  const gate = checkMarkdownEditorGate(host, path);
  if (!gate.allowed) throw new Error(gate.rejectCode);
}

function basename(path: string): string {
  return path.split('/').pop()!.replace(/\.md$/i, '');
}

async function checkDestination(host: ExtractionHost, record: ExtractionRecord): Promise<number> {
  const { destination, output } = record;
  const version = host.version(destination);
  if (host.existingPath(destination) !== destination)
    throw new Error('destination-missing-or-renamed');
  clean(host, destination);
  if ((await host.readFile(destination)) !== output || host.version(destination) !== version) {
    throw new Error('destination-changed');
  }
  return version;
}

/** Shared by the initial replacement and Redo. Never remove or overwrite the destination. */
export async function commitExtraction(
  host: ExtractionHost,
  record: ExtractionRecord,
): Promise<void> {
  await checkDestination(host, record);
  const current = await host.readFile(record.source);
  if (current !== record.before) throw new Error('stale-target');
  const doc = editableMap(current, basename(record.source));
  const targetId = resolveHistoryAnchor(doc, record.anchor);
  const target = targetId && doc.nodes.get(targetId);
  if (!target) throw new Error('stale-target');
  const refs = await host.referenceEdits(record.source, current, record.anchor, record.destination);
  const link = host.linkTo(record.destination, record.source, target.displayTitle);
  const verified = planBranchExtraction(current, doc, target, link, refs);
  if (verified.after !== record.after || verified.output !== record.output)
    throw new Error('unsafe-reference');
  await host.put(record);
  const version = await checkDestination(host, record);
  const { source, destination, before, after } = record;
  clean(host, source);
  try {
    await host.processFile(source, (current) => {
      clean(host, source);
      clean(host, destination);
      if (current !== before) throw new Error('stale-target');
      if (host.version(destination) !== version || host.existingPath(destination) !== destination) {
        throw new Error('destination-changed');
      }
      return after;
    });
  } catch (error) {
    // A write can reach disk before an I/O error is reported.
    if ((await host.readFile(source)) !== after) throw error;
  }
  await confirmExtraction(host, record);
}

/** May run after a restart if a replacement reached disk before its journal entry was cleared. */
export async function confirmExtraction(
  host: ExtractionHost,
  record: ExtractionRecord,
): Promise<void> {
  if ((await host.readFile(record.source)) !== record.after) throw new Error('recovery-required');
  try {
    await checkDestination(host, record);
  } catch (error) {
    clean(host, record.source);
    await host.processFile(record.source, (current) => {
      clean(host, record.source);
      if (current !== record.after) throw new Error('recovery-required');
      return record.before;
    });
    throw error;
  }
  if ((await host.readFile(record.source)) !== record.after) throw new Error('recovery-required');
  await host.remove(record.id);
}

export async function extractBranch(
  host: ExtractionHost,
  request: ExtractionRequest,
): Promise<ExtractionRecord> {
  const { source, before } = request;
  const destination = validateVaultNotePath(request.destination, source);
  clean(host, source);
  if (host.existingPath(source) !== source || (await host.readFile(source)) !== before)
    throw new Error('stale-target');
  const doc = editableMap(before, basename(source));
  const id = resolveHistoryAnchor(doc, request.anchor);
  const target = id && doc.nodes.get(id);
  if (!target || target.id === doc.rootId) throw new Error('stale-target');
  const records = host.records();
  const retry = request.retryId ? records.find((r) => r.id === request.retryId) : undefined;
  if (request.retryId && (!retry || retry.source !== source || retry.destination !== destination))
    throw new Error('recovery-required');
  if (
    retry &&
    !request.confirmedRecovery &&
    (retry.phase === 'prepared' || resolveHistoryAnchor(doc, retry.anchor) !== id)
  )
    throw new Error('ambiguous-recovery');
  for (const other of records) {
    if (other.id === retry?.id) continue;
    if (other.destination.toLowerCase() === destination.toLowerCase())
      throw new Error('pending-extraction');
    if (other.source !== source) continue;
    const matched = resolveHistoryAnchor(doc, other.anchor);
    if (matched === id || (matched === null && other.anchor.titleRaw === target.titleRaw)) {
      throw new Error('pending-extraction');
    }
  }
  const anchor = createHistoryAnchor(doc, target);
  const edits = await host.referenceEdits(source, before, anchor, destination);
  const preflight = planBranchExtraction(before, doc, target, '[[Extracted Branch]]', edits);
  if (
    retry &&
    (retry.output !== preflight.output || retry.originalBranch !== preflight.originalBranch)
  )
    throw new Error('branch-changed');
  let record: ExtractionRecord = {
    id: retry?.id ?? crypto.randomUUID(),
    source,
    destination,
    before,
    after: '',
    line: target.headerLine,
    anchor,
    output: preflight.output,
    originalBranch: preflight.originalBranch,
    phase: 'prepared',
  };
  const recreateConfirmed =
    retry?.phase === 'prepared' &&
    request.confirmedRecovery &&
    host.existingPath(destination) === null;
  if (retry && !recreateConfirmed) {
    await checkDestination(host, retry);
  } else {
    if (host.existingPath(destination) !== null) throw new Error('target-already-exists');
    await host.put(record);
    clean(host, source);
    if ((await host.readFile(source)) !== before) throw new Error('stale-target');
    await host.createNote(destination, record.output);
  }
  record = { ...record, phase: 'created' };
  await host.put(record);
  const link = host.linkTo(destination, source, target.displayTitle);
  const final = planBranchExtraction(before, doc, target, link, edits);
  record = { ...record, phase: 'replacing', after: final.after };
  await commitExtraction(host, record);
  return record;
}

export function isExtractionRecord(value: unknown): value is ExtractionRecord {
  if (!value || typeof value !== 'object') return false;
  const r = value as Partial<ExtractionRecord>;
  const a = r.anchor;
  return (
    typeof r.id === 'string' &&
    typeof r.source === 'string' &&
    typeof r.destination === 'string' &&
    typeof r.output === 'string' &&
    typeof r.before === 'string' &&
    typeof r.after === 'string' &&
    typeof r.originalBranch === 'string' &&
    Number.isInteger(r.line) &&
    (r.phase === 'prepared' || r.phase === 'created' || r.phase === 'replacing') &&
    !!a &&
    typeof a.titleRaw === 'string' &&
    typeof a.baseContentHash === 'string' &&
    typeof a.ownRangeHash === 'string' &&
    Number.isInteger(a.headerLine) &&
    typeof a.hadDuplicateBlockId === 'boolean' &&
    typeof a.hadIdenticalSibling === 'boolean' &&
    (a.preservedBlockId === null || typeof a.preservedBlockId === 'string') &&
    Array.isArray(a.ancestorPath) &&
    a.ancestorPath.every((x) => typeof x === 'string')
  );
}
