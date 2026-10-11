import MarkdownIt, { type BlockState, type Token } from "markdown-it";
import reference from "markdown-it/lib/rules_block/reference.mjs";
import { iterativeQuote } from "./quotes.js";

export class TopicLimit extends Error {}

/** Retain block boundaries, including definitions which CommonMark normally erases. */
function opaqueRule(state: BlockState, start: number, end: number, silent: boolean): boolean {
  if (state.sCount[start] - state.blkIndent >= 4) return false;
  const content = (line: number) => state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]);
  const first = content(start);
  const delimiter = first.startsWith("$$") ? "$$" : first.startsWith("%%") ? "%%" : undefined;
  const footnote = /^\[\^[^\]\n]+\]:/.test(first);
  if (!delimiter && !footnote) return false;
  if (silent) return true;
  let next = start + 1;
  if (delimiter && first.slice(2).includes(delimiter)) {
    // An entire math/comment block on one line.
  } else if (delimiter) {
    while (next < end) {
      if (state.sCount[next] < state.blkIndent && !state.isEmpty(next)) break;
      if (content(next++).includes(delimiter)) break;
    }
  } else {
    while (next < end && (state.isEmpty(next) || state.sCount[next] >= state.blkIndent + 4)) next++;
    while (next > start + 1 && state.isEmpty(next - 1)) next--;
  }
  const token = state.push(delimiter === "$$" ? "note_math" : delimiter === "%%" ? "note_comment" : "note_footnote", "", 0);
  token.map = [start, next];
  state.line = next;
  return true;
}

/** Only tokenize blocks: inline parsing and rendering cannot change raw labels. */
export function tokenizeNoteBlocks(text: string, maxTopics: number): Token[] {
  // Each list depth emits both list and item containers. The default nesting
  // limit (20) would silently omit topic 11 before our topic counter sees it.
  const md = new MarkdownIt("commonmark", { html: true, maxNesting: Math.max(20, maxTopics * 2 + 2) }).enable("table");
  md.block.ruler.at("blockquote", iterativeQuote, { alt: ["paragraph", "reference", "blockquote", "list"] });
  md.block.ruler.before("fence", "note_opaque", opaqueRule, { alt: ["paragraph", "reference", "blockquote", "list"] });
  md.block.ruler.before("reference", "note_reference", (state, start, end, silent) => {
    const matched = reference(state, start, end, silent);
    if (matched && !silent) {
      const token = state.push("note_reference", "", 0);
      token.map = [start, state.line];
    }
    return matched;
  });
  const tokenize = md.block.tokenize;
  let recursiveCalls = 0;
  // Hook this parser instance's block state, never a shared prototype. Count while
  // tokens are emitted, and throw at the first excess topic before parsing the tail.
  md.block.tokenize = function(state, start, end) {
    // Native list rules re-enter this path even inside an iterative quote.
    // Record their nesting recovery as well as the quote frame's recovery.
    if (state.level >= md.options.maxNesting || recursiveCalls >= 512) {
      // Native list recursion can exhaust the JS stack well below maxTopics.
      // Consume only this physical line; outer list frames can still discover
      // later outdented topics. Preserve the raw title and disable writing.
      state.env.noteNestingTruncated = true;
      const token = state.push("paragraph_open", "p", 1);
      token.map = [start, start + 1];
      const inline = state.push("inline", "", 0);
      inline.map = [start, start + 1];
      inline.content = state.src.slice(state.bMarks[start] + state.tShift[start], state.eMarks[start]);
      state.push("paragraph_close", "p", -1);
      state.line = start + 1;
      return;
    }
    if (!state.env.noteCounting) {
      state.env.noteCounting = true;
      const push = state.push;
      let quoteDepth = 0, itemDepth = 0, centerSeen = false, topics = 0;
      const listTopicLines = new Set<number>();
      state.push = function(type, tag, nesting) {
        if (type === "blockquote_close") quoteDepth--;
        if (type === "list_item_close") itemDepth--;
        let topic = !quoteDepth && type === "list_item_open" && !listTopicLines.has(state.line);
        if (topic) listTopicLines.add(state.line);
        if (!quoteDepth && !itemDepth && type === "heading_open" && /^h[1-6]$/.test(tag)) {
          // Setext headings are opaque and not topics. heading_open alone does not
          // distinguish them: the raw start line identifies ATX before markup is set.
          const previous = state.line - 1; // ATX rule advances to the next line before push.
          const line = state.src.slice(state.bMarks[previous] + state.tShift[previous], state.eMarks[previous]);
          if (/^#{1,6}(?:[ \t]|$)/.test(line)) {
            if (tag === "h1" && !centerSeen) centerSeen = true;
            else topic = true;
          }
        }
        if (topic && ++topics > maxTopics) throw new TopicLimit();
        if (type === "blockquote_open") quoteDepth++;
        if (type === "list_item_open") itemDepth++;
        return push.call(this, type, tag, nesting);
      };
    }
    const item = state.tokens.at(-1);
    const contentStart = state.bMarks[start] + state.tShift[start];
    const task = state.parentType === "list" && item?.type === "list_item_open" && item.map?.[0] === start
      ? /^\[[^\]\r\n]\](?:[ \t]+|$)/.exec(state.src.slice(contentStart, state.eMarks[start])) : null;
    // Supplement 11 also detects block syntax after an Obsidian task marker.
    // Ignore the task for structural tokenization; keep physical source offsets
    // and the item's original content indent for all subsequent lines.
    const shift = state.tShift[start];
    if (task) state.tShift[start] += task[0].length;
    recursiveCalls++;
    try { tokenize.call(this, state, start, end); }
    finally { recursiveCalls--; state.tShift[start] = shift; }
  };
  const tokens: Token[] = [];
  const env: Record<string, unknown> = {};
  md.block.parse(text, md, env, tokens);
  if (env.noteNestingTruncated) tokens.push({ type: "note_unclassified", tag: "", nesting: 0, level: 0, map: null, markup: "", content: "" });
  return tokens;
}
