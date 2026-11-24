import { describe, expect, it } from 'vitest';
import { computeLayout, THUMBNAIL_SLOT_HEIGHT } from '../../src/core/layout/treeLayout';
import { parseMarkdownToMap } from '../../src/core/parser';
import {
  extractImageEmbeds,
  extractNodeImageEmbeds,
  isSafeVaultImagePath,
} from '../../src/core/view/imageEmbeds';

function parseOk(md: string) {
  const res = parseMarkdownToMap(md, 'Root');
  if (res.status !== 'ok') throw new Error(`parse failed: ${res.detail}`);
  return res.document;
}

describe('imageEmbeds (M4-b safe embed extraction & layout reservation)', () => {
  it('extracts deduplicated Obsidian wiki and Markdown image embeds while skipping inline code', () => {
    const text = [
      'Overview ![[assets/diagram.png|240]]',
      'Alias ![[photos/hero.webp|Hero Banner|320x180]]',
      'Duplicate ![[ASSETS/DIAGRAM.PNG]]',
      'Markdown ![Floor Plan](plans/floor%201.jpg "optional")',
      'Code span `![[ignored.png]]` and `![ignored](ignored.jpg)`',
    ].join(' ');

    expect(extractImageEmbeds(text)).toEqual([
      { target: 'assets/diagram.png', alt: 'diagram.png', requestedWidth: 240 },
      { target: 'photos/hero.webp', alt: 'Hero Banner', requestedWidth: 320 },
      { target: 'plans/floor 1.jpg', alt: 'Floor Plan' },
    ]);
  });

  it('preserves literal %20 in wiki embeds while decoding percent-encoded Markdown image URLs (Codex #afabc3ec)', () => {
    const wikiMixed = '![[Visual%20X.png]] and ![[Visual X.png]]';
    expect(extractImageEmbeds(wikiMixed)).toEqual([
      { target: 'Visual%20X.png', alt: 'Visual%20X.png' },
      { target: 'Visual X.png', alt: 'Visual X.png' },
    ]);

    const mdMixed = '![space](Visual%20X.png) and ![percent](Visual%2520X.png)';
    expect(extractImageEmbeds(mdMixed)).toEqual([
      { target: 'Visual X.png', alt: 'space' },
      { target: 'Visual%20X.png', alt: 'percent' },
    ]);
  });

  it('supports CommonMark balanced parentheses, angle-bracket destinations, and multi-backtick code spans (Codex PR #17 P2)', () => {
    const validTricky = [
      'Paren ![diagram](pic(1).png)',
      'Angle ![space diagram](<pic one.png>)',
      'AngleParen ![both](<dir/pic (2).png> "title")',
    ].join(' ');
    expect(extractImageEmbeds(validTricky)).toEqual([
      { target: 'pic(1).png', alt: 'diagram' },
      { target: 'pic one.png', alt: 'space diagram' },
      { target: 'dir/pic (2).png', alt: 'both' },
    ]);

    // Double-backtick code span containing a single backtick MUST NOT leak as a real image embed!
    const multiBacktickCode =
      'Example ``code ` with ![[pic.png]] and ![diagram](pic(1).png)`` and ```inner `` ![[pic.png]]```';
    expect(extractImageEmbeds(multiBacktickCode)).toEqual([]);
  });

  it('strictly blocks path traversal, percent-encoded traversal, absolute paths, external URLs, and non-image embeds', () => {
    expect(isSafeVaultImagePath('assets/ok.png')).toBe(true);
    expect(isSafeVaultImagePath('nested/img.svg')).toBe(true);
    expect(isSafeVaultImagePath('../secret.png')).toBe(false);
    expect(isSafeVaultImagePath('%2e%2e%2fsecret.png')).toBe(false);
    expect(isSafeVaultImagePath('/etc/passwd.png')).toBe(false);
    expect(isSafeVaultImagePath('\\windows\\pic.png')).toBe(false);
    expect(isSafeVaultImagePath('https://example.com/a.png')).toBe(false);
    expect(isSafeVaultImagePath('javascript:alert(1).png')).toBe(false);
    expect(isSafeVaultImagePath('data:image/png;base64,AAAA')).toBe(false);
    expect(isSafeVaultImagePath('notes/linked.md')).toBe(false);
    expect(isSafeVaultImagePath('docs/manual.pdf')).toBe(false);

    const malicious =
      '![[../secret.png]] ![[%2e%2e%2fescape.jpg]] ![[/abs.png]] ![[https://evil.test/x.png]] ![[note.md]] ![bad](file:///tmp/a.png)';
    expect(extractImageEmbeds(malicious)).toEqual([]);
  });

  it('merges title and topic-note image embeds and reserves exact thumbnail height in layout with zero sibling overlap', () => {
    const doc = parseOk(
      [
        '# Map Root',
        '## Image Branch ![[a.png]]',
        '  Note referencing ![[b.jpg]] and duplicate ![[a.png]]',
        '## Next Sibling',
        '',
      ].join('\n'),
    );

    const imgBranch = [...doc.nodes.values()].find((n) => n.titleRaw.includes('Image Branch'));
    const nextSibling = [...doc.nodes.values()].find((n) => n.titleRaw === 'Next Sibling');
    expect(imgBranch && nextSibling).toBeTruthy();
    if (!imgBranch || !nextSibling) return;

    expect(extractNodeImageEmbeds(imgBranch).map((e) => e.target)).toEqual(['a.png', 'b.jpg']);

    const visibleIds = new Set(doc.nodes.keys());
    const layoutWithoutThumb = computeLayout(doc, visibleIds, undefined, undefined, {
      layoutMode: 'right',
    });
    const layoutWithThumb = computeLayout(doc, visibleIds, undefined, undefined, {
      layoutMode: 'right',
      thumbnailNodeIds: new Set([imgBranch.id]),
    });

    const lnWithout = layoutWithoutThumb.nodes.get(imgBranch.id);
    const lnWith = layoutWithThumb.nodes.get(imgBranch.id);
    const sibWith = layoutWithThumb.nodes.get(nextSibling.id);
    expect(lnWithout && lnWith && sibWith).toBeTruthy();
    if (!lnWithout || !lnWith || !sibWith) return;

    expect(lnWith.height - lnWithout.height).toBe(THUMBNAIL_SLOT_HEIGHT);
    // Sibling below MUST never overlap the taller thumbnail card
    expect(sibWith.y).toBeGreaterThanOrEqual(lnWith.y + lnWith.height);
  });

  it('extracts leading body images on H1-less central-virtual root notes while skipping virtual title (Codex PR #17 P2)', () => {
    const doc = parseOk(['Diagram ![[pic.png]]', '', '- Child A', '- Child B', ''].join('\n'));
    const root = doc.nodes.get(doc.rootId);
    expect(root).toBeDefined();
    if (!root) return;
    expect(root.kind).toBe('central-virtual');
    expect(root.noteRange).toEqual({ startLine: 0, endLine: 1 });
    expect(extractNodeImageEmbeds(root)).toEqual([{ target: 'pic.png', alt: 'pic.png' }]);
  });
});
