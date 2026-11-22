import type { BranchSide } from '../model';

/**
 * Deterministically assigns each main branch (direct child of central root)
 * to the right or left side without storing any layout coordinates in Markdown.
 *
 * - 1..2 main branches stay on the right side for clean initial brainstorming.
 * - 3+ main branches split clockwise: first ceil(n / 2) on the right, rest on the left.
 */
export function assignMainBranchSides(
  mainBranchIds: readonly string[],
): ReadonlyMap<string, Exclude<BranchSide, 'center'>> {
  const result = new Map<string, Exclude<BranchSide, 'center'>>();
  const count = mainBranchIds.length;
  const rightCount = count <= 2 ? count : Math.ceil(count / 2);

  for (let i = 0; i < count; i += 1) {
    const id = mainBranchIds[i];
    if (id === undefined) continue;
    result.set(id, i < rightCount ? 'right' : 'left');
  }
  return result;
}
