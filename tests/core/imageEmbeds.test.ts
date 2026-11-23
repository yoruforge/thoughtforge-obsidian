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
});
