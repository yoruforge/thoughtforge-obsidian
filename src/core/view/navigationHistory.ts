export interface MapHistoryEntry {
  readonly filePath: string;
  readonly targetLine?: number;
  readonly targetSubpath?: string;
}

const MAX_HISTORY_ENTRIES = 50;

function isSameHistoryEntry(a: MapHistoryEntry, b: MapHistoryEntry): boolean {
  return (
    a.filePath === b.filePath &&
    a.targetLine === b.targetLine &&
    a.targetSubpath === b.targetSubpath
  );
}

/**
 * Pure per-view navigation history stack for mind-map-to-mind-map link traversal
 * with Back / Forward support, vault rename tracking, and deleted-note pruning.
 */
export class MapNavigationHistory {
  private entries: MapHistoryEntry[] = [];
  private cursor = -1;

  get current(): MapHistoryEntry | null {
    return this.cursor >= 0 && this.cursor < this.entries.length
      ? (this.entries[this.cursor] ?? null)
      : null;
  }

  get length(): number {
    return this.entries.length;
  }

  canGoBack(): boolean {
    return this.cursor > 0;
  }

  canGoForward(): boolean {
    return this.cursor >= 0 && this.cursor < this.entries.length - 1;
  }

  peekBack(): MapHistoryEntry | null {
    return this.canGoBack() ? (this.entries[this.cursor - 1] ?? null) : null;
  }

  peekForward(): MapHistoryEntry | null {
    return this.canGoForward() ? (this.entries[this.cursor + 1] ?? null) : null;
  }

  /**
   * Records a newly visited map location, truncating any forward branch when navigating
   * from the middle of the history stack.
   */
  recordVisit(entry: MapHistoryEntry): void {
    const cur = this.current;
    if (cur !== null && isSameHistoryEntry(cur, entry)) {
      return;
    }
    if (this.cursor < this.entries.length - 1) {
      this.entries = this.entries.slice(0, this.cursor + 1);
    }
    this.entries.push(entry);
    if (this.entries.length > MAX_HISTORY_ENTRIES) {
      const overflow = this.entries.length - MAX_HISTORY_ENTRIES;
      this.entries = this.entries.slice(overflow);
    }
    this.cursor = this.entries.length - 1;
  }

  /**
   * Updates the current history entry's anchor line (for example right before jumping away)
   * so going Back restores the exact topic the user was inspecting.
   */
  updateCurrentAnchor(filePath: string, targetLine?: number): void {
    const cur = this.current;
    if (cur === null || cur.filePath !== filePath) {
      return;
    }
    this.entries[this.cursor] = {
      filePath: cur.filePath,
      ...(targetLine !== undefined ? { targetLine } : {}),
    };
  }

  stepBack(): MapHistoryEntry | null {
    if (!this.canGoBack()) {
      return null;
    }
    this.cursor -= 1;
    return this.current;
  }

  stepForward(): MapHistoryEntry | null {
    if (!this.canGoForward()) {
      return null;
    }
    this.cursor += 1;
    return this.current;
  }

  /** Updates all stored entries when a Vault note is renamed. */
  renamePath(oldPath: string, newPath: string): void {
    if (oldPath === newPath) return;
    this.entries = this.entries.map((entry) =>
      entry.filePath === oldPath ? { ...entry, filePath: newPath } : entry,
    );
  }

  /**
   * Prunes entries pointing to a deleted note while preserving relative cursor position
   * and collapsing any adjacent duplicate entries created by removal.
   */
  removePath(deletedPath: string): void {
    if (this.entries.length === 0) return;
    let nextCursor = this.cursor;
    const filtered: MapHistoryEntry[] = [];
    for (let i = 0; i < this.entries.length; i += 1) {
      const entry = this.entries[i];
      if (!entry) continue;
      if (entry.filePath === deletedPath) {
        if (i <= this.cursor) {
          nextCursor -= 1;
        }
        continue;
      }
      const prev = filtered[filtered.length - 1];
      if (prev && isSameHistoryEntry(prev, entry)) {
        if (i <= this.cursor) {
          nextCursor -= 1;
        }
        continue;
      }
      filtered.push(entry);
    }
    this.entries = filtered;
    if (filtered.length === 0) {
      this.cursor = -1;
    } else {
      this.cursor = Math.max(0, Math.min(nextCursor, filtered.length - 1));
    }
  }

  clear(): void {
    this.entries = [];
    this.cursor = -1;
  }
}
