export function isSafeVaultLinkPath(rawTarget: string): boolean {
  if (rawTarget.length === 0) return false;
  let decoded = rawTarget;
  try {
    decoded = decodeURIComponent(rawTarget);
  } catch {
    decoded = rawTarget;
  }
  for (const candidate of [rawTarget, decoded]) {
    if (/^[\\/]/.test(candidate)) return false;
    if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(candidate)) return false;
    const pathPart = candidate.split('#')[0] ?? '';
    const segments = pathPart.split(/[\\/]/);
    if (segments.includes('..')) return false;
  }
  return true;
}
