import { describe, expect, it } from 'vitest';
import { maskObsidianInlineComments } from '../../src/core/parser/inlineMarkdown';
import {
  editableMap,
  planBranchExtraction,
  sanitizeNoteFileStem,
  validateVaultNotePath,
} from '../../src/core/patch/extractBranch';
import { formatExtractionError, getMessages } from '../../src/i18n';

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
  it('rejects preserved list paragraphs that would become indented code', () => {
    const raw = '# Map\n- Top\n  - Branch\n    %% c %%\n\n    Trailing paragraph\n';
    expect(() => plan(raw, 'Branch')).toThrow('indent-sensitive-unmapped-block');
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
  it('rejects list branches whose indented protected blocks would become indented code blocks', () => {
    const trailingPara = '# Map\n- Top\n  - Branch\n    %% c %%\n\n    Trailing paragraph\n';
    expect(() => plan(trailingPara, 'Branch')).toThrow('indent-sensitive-unmapped-block');

    const indentedComment = '# Map\n- Top\n  - Branch\n    %% keep comment %%\n    - Child\n';
    expect(() => plan(indentedComment, 'Branch')).toThrow('indent-sensitive-unmapped-block');
  });
  it('masks Obsidian inline comments outside code spans while preserving column offsets', () => {
    const line = '## Topic %% [[Ignored]] %% and [[Real]]';
    const masked = maskObsidianInlineComments(line);
    expect(masked.length).toBe(line.length);
    expect(masked.indexOf('[[Real]]')).toBe(line.indexOf('[[Real]]'));
    expect(masked).not.toContain('[[Ignored]]');

    const withCode = 'Use `%%` and [[Real]] %% [[Hidden]] %%';
    const maskedCode = maskObsidianInlineComments(withCode);
    expect(maskedCode.indexOf('[[Real]]')).toBe(withCode.indexOf('[[Real]]'));
    expect(maskedCode).toContain('`%%`');
    expect(maskedCode).not.toContain('[[Hidden]]');
  });
  it('localizes all extraction error codes in ja and en without leaking internal tokens', () => {
    const codes = [
      'editor-dirty',
      'editor-state-unknown',
      'read-only-document',
      'blocked-document',
      'stale-target',
      'indent-sensitive-unmapped-block',
      'cannot-extract',
      'invalid-extracted-structure',
      'invalid-target-path',
      'target-same-as-source',
      'target-already-exists',
      'ambiguous-path',
      'destination-missing-or-renamed',
      'destination-changed',
      'pending-extraction',
      'ambiguous-recovery',
      'recovery-required',
      'branch-changed',
      'metadata-updating',
      'unresolved-reference',
      'ambiguous-reference',
      'unsafe-reference',
      'invalid-link',
      'storage-unavailable',
      'history-changed',
    ] as const;
    const jaMsg = getMessages('ja');
    const enMsg = getMessages('en');
    for (const code of codes) {
      const jaOut = formatExtractionError(jaMsg, code);
      const enOut = formatExtractionError(enMsg, code);
      expect(jaOut.length).toBeGreaterThan(0);
      expect(enOut.length).toBeGreaterThan(0);
      expect(jaOut).not.toContain(code);
      expect(enOut).not.toContain(code);
    }
  });
});
