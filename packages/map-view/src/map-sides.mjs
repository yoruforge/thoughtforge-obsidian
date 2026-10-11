/**
 * Deterministic left/right placement of a mind map's main branches.
 * The first ceil(n / 2) branches in document order go right, the rest go left.
 * Only the number of main branches changes a side, so deep edits never move branches.
 * Kept closure-free so the webview can embed it with Function.prototype.toString().
 */
export function splitMapMainBranches(nodeIds) {
  const ids = Array.isArray(nodeIds) ? nodeIds : [];
  const rightCount = Math.ceil(ids.length / 2);
  return { right: ids.slice(0, rightCount), left: ids.slice(rightCount) };
}
