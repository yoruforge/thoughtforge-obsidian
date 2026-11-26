import { describe, expect, it } from 'vitest';
import {
  editableMap,
  planBranchExtraction,
  sanitizeNoteFileStem,
  validateVaultNotePath,
} from '../../src/core/patch/extractBranch';

function plan(raw: string, title: string) {
  const doc = editableMap(raw, 'Map');
  const node = [...doc.nodes.values()].find((n) => n.titleRaw === title);
  if (!node) throw new Error('missing fixture topic');
  return planBranchExtraction(raw, doc, node, '[[Extracted]]');
}

describe('Markdown branch extraction', () => {
  it.each(['\n', '\r\n'])(
    'preserves heading descendants, protected lines and line endings',
    (eol) => {
      const lines = [
        '# Map',
        '## A ^a',
        'body',
        '```md',
        '### inside',
        '```',
        '### B',
        '- C',
        '## Other',
      ];
      const result = plan(lines.join(eol), 'A');
      expect(result.output).toBe(
        ['# A', 'body', '```md', '### inside', '```', '## B', '- C', ''].join(eol),
      );
      expect(result.after).toBe(['# Map', '## [[Extracted]] ^a', '## Other'].join(eol));
    },
  );
  it.each([
    ['- Top', '    - A', '      note', '      - Child', '    - [[Extracted]]'],
    ['- Top', '  - [x] A ^a', '    note', '    - Child', '  - [x] [[Extracted]] ^a'],
    ['1. Top', '   10. [ ] A ^a', '       note', '       - Child', '   10. [ ] [[Extracted]] ^a'],
    ['- Top', '\t10. A', '\t\tnote', '\t\t- Child', '\t10. [[Extracted]]'],
  ])('normalizes nested lists while retaining source markers', (top, head, note, child, link) => {
    const result = plan(['# Map', top, head, note, child, '- Tail', ''].join('\n'), 'A');
    expect(result.output).toBe('# A\nnote\n- Child\n');
    expect(result.after).toContain(link);
  });
  it('moves a second H1 and preserves frontmatter, table, callout and comment bytes', () => {
    const prefix = '---\ntitle: Keep\n---\n# Map\n';
    const blocks = [
      'summary',
      '',
      '| A | B |',
      '|---|---|',
      '| 1 | 2 |',
      '',
      '> [!note]',
      '> Keep  spacing',
      '',
      '<!-- keep -->',
      '## Sub',
      '- Child',
    ].join('\n');
    const raw = prefix + '# A ^id\n' + blocks + '\n# Other\n';
    const result = plan(raw, 'A');
    expect(result.output).toBe('# A\n' + blocks + '\n');
    expect(result.after).toBe(prefix + '# [[Extracted]] ^id\n# Other\n');
  });
  it('extracts a final leaf without adding a trailing newline', () => {
    expect(plan('# Map\n- A', 'A').output).toBe('# A');
  });
  it('rejects virtual/real roots, readonly files, and indent-sensitive blocks', () => {
    for (const raw of ['# Map\n- A', '- A']) expect(() => plan(raw, 'Map')).toThrow();
    expect(() => plan('# Map\n- A\r\n', 'A')).toThrow();
    expect(() => plan('# Map\n- A\n  ```\n  x\n  ```\n', 'A')).toThrow();
  });
  it('rejects unsafe destinations, including case aliases of the source', () => {
    for (const path of ['../X', '/X', '.obsidian/test', 'Sources/CON.md', 'X#Y', 'Map.MD'])
      expect(() => validateVaultNotePath(path, 'map.md')).toThrow();
    expect(validateVaultNotePath('Archive/設計案', 'Map.md')).toBe('Archive/設計案.md');
    expect(sanitizeNoteFileStem('CON')).toBe('Extracted Branch');
  });
});
