const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** Reject the whole file before any field can reach render, patch, clipboard, or trace. */
export function privacyFailure(value: unknown): boolean {
  const sensitiveKey = /(?:password|passwd|passphrase|pwd|secret|credential|authorization|cookie|(?:api|access|refresh|private|session)[ _-]?(?:key|token)|token)/i;
  const valuePatterns = [
    /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/,
    /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|glpat-[A-Za-z0-9_-]{20,}|npm_[A-Za-z0-9]{20,})\b/,
    /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
    /\b(?:Bearer|Basic)\s+[A-Za-z0-9+/_=.-]{8,}/i,
    /["']?\b[A-Za-z0-9_-]*(?:password|passwd|passphrase|pwd|api[ _-]?key|access[ _-]?(?:key|token)|refresh[ _-]?token|private[ _-]?key|secret|token|authorization|cookie|credentials?)[A-Za-z0-9_-]*\b["']?\s*[:=]\s*\S+/i,
    /\b[a-z][a-z\d+.-]*:\/\/[^\s/@:]+:[^\s/@]+@/i,
    /(?:^|[\/\\\s"'`])\.env(?:\.[A-Za-z0-9_-]+)?(?:$|[\/\\\s#"'`:=])/i,
    /(?:thoughtforge\.debug\.trace|window\.__thoughtforge|"(?:tool_calls?|function_call|chain_of_thought|reasoning_content)"\s*:)/i,
    /(?:^|\n)\s*(?:stdout|stderr|raw[_ -]?(?:ci[_ -]?)?logs?)\s*[:=]\s*\S/i,
    /(?:^|\n)(?:##\[(?:group|error|warning)\]|\d{4}-\d{2}-\d{2}T\S+\s+.*\n.*\n)/i
  ];
  const stack: unknown[] = [value];
  const seen = new Set<object>();
  while (stack.length) {
    const next = stack.pop();
    if (typeof next === "string") {
      if (valuePatterns.some((pattern) => pattern.test(next))) return true;
      // Raw DebugTraceRecord/JSONL is excluded even without its console prefix.
      // Parse only JSON-shaped snippets; ordinary prose about tracing is not a record.
      const isTraceRecord = (record: unknown): boolean => object(record)
        && typeof record.ts === "string" && typeof record.scope === "string"
        && typeof record.event === "string" && (record.source === undefined || ["extension", "webview", "core", "test"].includes(String(record.source)));
      for (const candidate of [next, ...next.split(/\r?\n/)]) {
        const first = candidate.indexOf("{"), last = candidate.lastIndexOf("}");
        const snippets = [candidate.trim(), ...(first >= 0 && last > first ? [candidate.slice(first, last + 1)] : [])];
        for (const snippet of snippets) {
          if (!snippet.startsWith("{") && !snippet.startsWith("[")) continue;
          try {
            const parsed: unknown = JSON.parse(snippet);
            if (isTraceRecord(parsed) || (Array.isArray(parsed) && parsed.some(isTraceRecord))) return true;
          } catch { /* Not a raw JSON record. */ }
        }
      }
    } else if (next && typeof next === "object") {
      if (seen.has(next)) continue;
      seen.add(next);
      if (Array.isArray(next)) { for (const field of next) stack.push(field); }
      else for (const [key, field] of Object.entries(next)) {
        if (sensitiveKey.test(key)) return true;
        stack.push(field);
      }
    }
  }
  return false;
}
