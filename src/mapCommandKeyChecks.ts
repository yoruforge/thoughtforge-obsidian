import { MAP_COMMANDS, type MapCommandId } from './mapCommands.ts';
import type { EditPermission, PermissionStorage } from './editPermission.ts';

export const MAP_COMMAND_CHECKS_KEY = 'thoughtforge:map-command-checks:v1';
export const KEY_CHECK_LABELS = { unconfirmed: '未確認', received: '届いた', 'not-received': '届かなかった' } as const;
export type KeyCheckStatus = keyof typeof KEY_CHECK_LABELS;
export type KeyCheckSaveResult = 'saved' | 'session-only' | 'save-failed';
type Checks = Partial<Record<MapCommandId, KeyCheckStatus>>;
type RecordV1 = { version: 1; checks: Checks };
const mapCommandIds = new Set<string>(MAP_COMMANDS.map(command => command.id));
const keyCheckObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const validKeyCheckStatus = (value: unknown): value is KeyCheckStatus => typeof value === 'string' && Object.hasOwn(KEY_CHECK_LABELS, value);

function parseKeyCheckRecord(value: unknown): RecordV1 {
  if (value === null) return { version: 1, checks: {} };
  if (!keyCheckObject(value) || Object.keys(value).length !== 2 || value.version !== 1 || !keyCheckObject(value.checks) ||
    !Object.entries(value.checks).every(([id, status]) => mapCommandIds.has(id) && validKeyCheckStatus(status))) throw Error('invalid key check record');
  return { version: 1, checks: { ...value.checks } };
}

/** Separate diagnostic storage: never load/save plugin data.json or Markdown. */
export class MapCommandKeyChecks {
  private readonly overrides = new Map<MapCommandId, { status: KeyCheckStatus }>();
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly storage: PermissionStorage, private readonly permission: EditPermission,
    private readonly live: () => boolean) {}
  get storageAvailable(): boolean { try { this.read(); return true; } catch { return false; } }
  private read(): RecordV1 { return parseKeyCheckRecord(this.storage.loadLocalStorage(MAP_COMMAND_CHECKS_KEY)); }
  get(id: MapCommandId): KeyCheckStatus {
    const override = this.overrides.get(id); if (override) return override.status;
    try { return this.read().checks[id] ?? 'unconfirmed'; } catch { return 'unconfirmed'; }
  }
  record(id: MapCommandId, status: KeyCheckStatus): Promise<KeyCheckSaveResult> {
    if (!mapCommandIds.has(id) || !validKeyCheckStatus(status) || !this.live()) return Promise.resolve('save-failed');
    const override = { status }; this.overrides.set(id, override);
    // Capture at the user's request, never at queued execution after a new grant.
    const token = this.permission.capture();
    if (!this.permission.isCurrent(token)) return Promise.resolve('session-only');
    const task = this.tail.then(async (): Promise<KeyCheckSaveResult> => {
      try {
        if (!this.live() || !await this.permission.check(token) || !this.live()) return 'session-only';
        await this.permission.run(token, async () => {
          if (!this.live()) throw Error('retired key check writer');
          const next = this.read(); // Merge only this explicit operation, not memory-only observations.
          if (status === 'unconfirmed') delete next.checks[id]; else next.checks[id] = status;
          this.storage.saveLocalStorage(MAP_COMMAND_CHECKS_KEY, next);
          if (JSON.stringify(this.read()) !== JSON.stringify(next)) throw Error('key check readback failed');
        });
        if (this.overrides.get(id) === override) this.overrides.delete(id);
        return 'saved';
      } catch { return 'save-failed'; }
    });
    this.tail = task; return task;
  }
}
