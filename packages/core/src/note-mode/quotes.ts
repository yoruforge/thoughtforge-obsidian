/*
Copyright (c) 2014 Vitaly Puzrin, Alex Kocharin.

Permission is hereby granted, free of charge, to any person
obtaining a copy of this software and associated documentation
files (the "Software"), to deal in the Software without
restriction, including without limitation the rights to use,
copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.

*/
// Adapted from markdown-it 14.3.0 lib/rules_block/blockquote.mjs and
// lib/parser_block.mjs. Boundary rules are unchanged; only quote recursion is
// replaced by suspended frames driven by an explicit stack. List/block rules
// remain the pinned dependency's implementation.
import type { BlockRule, BlockState } from "markdown-it";
const isSpace = (code: number) => code === 0x20 || code === 0x09;
type Job = Generator<Job, boolean | void, boolean | void>;

export const iterativeQuote: BlockRule = (state, start, end, silent) => {
  const jobs: Job[] = [quoteFrame(state, start, end, silent)];
  let value: boolean | void = undefined;
  while (jobs.length) {
    const step = jobs[jobs.length - 1].next(value);
    value = undefined;
    if (step.done) { jobs.pop(); value = step.value; }
    else jobs.push(step.value);
  }
  return value === true;
};

function* bodyFrame(state: BlockState, start: number, end: number): Job {
  const rules = state.md.block.ruler.getRules("");
  let line = start, hasEmptyLines = false;
  while (line < end) {
    state.line = line = state.skipEmptyLines(line);
    if (line >= end || state.sCount[line] < state.blkIndent) break;
    if (state.level >= state.md.options.maxNesting) {
      // This is the dependency's bounded nesting recovery. Signal uncertainty
      // rather than returning editable after skipping opaque nested structure.
      state.env.noteNestingTruncated = true;
      state.line = end;
      break;
    }
    const previous = state.line;
    let matched = false;
    for (const rule of rules) {
      matched = rule === iterativeQuote
        ? Boolean(yield quoteFrame(state, line, end, false))
        : rule(state, line, end, false);
      if (matched) {
        if (previous >= state.line) throw new Error("block rule did not advance");
        break;
      }
    }
    if (!matched) throw new Error("no block rule matched");
    state.tight = !hasEmptyLines;
    if (state.isEmpty(state.line - 1)) hasEmptyLines = true;
    line = state.line;
    if (line < end && state.isEmpty(line)) {
      hasEmptyLines = true;
      state.line = ++line;
    }
  }
}

function* quoteFrame(state: BlockState, startLine: number, endLine: number, silent: boolean): Job {
  let pos = state.bMarks[startLine] + state.tShift[startLine]
  let max = state.eMarks[startLine]
  // Record the actual block start before quote/list/task offsets are restored.
  // A '>' inside a task marker or quoted body is not the quote opener.
  const noteCallout = /^>[ \t]*\[!/.test(state.src.slice(pos, max))

  const oldLineMax = state.lineMax

  // if it's indented more than 3 spaces, it should be a code block
  if (state.sCount[startLine] - state.blkIndent >= 4) { return false }

  // check the block quote marker
  if (state.src.charCodeAt(pos) !== 0x3E/* > */) { return false }

  // we know that it's going to be a valid blockquote,
  // so no point trying to find the end of it in silent mode
  if (silent) { return true }

  const oldBMarks: number[] = []
  const oldBSCount: number[] = []
  const oldSCount: number[] = []
  const oldTShift: number[] = []

  const terminatorRules = state.md.block.ruler.getRules('blockquote')

  const oldParentType = state.parentType
  state.parentType = 'blockquote'
  let lastLineEmpty = false
  let nextLine = startLine

  // Search the end of the block
  //
  // Block ends with either:
  //  1. an empty line outside:
  //     ```
  //     > test
  //
  //     ```
  //  2. an empty line inside:
  //     ```
  //     >
  //     test
  //     ```
  //  3. another tag:
  //     ```
  //     > test
  //      - - -
  //     ```
  for (nextLine = startLine; nextLine < endLine; nextLine++) {
    // check if it's outdented, i.e. it's inside list item and indented
    // less than said list item:
    //
    // ```
    // 1. anything
    //    > current blockquote
    // 2. checking this line
    // ```
    const isOutdented = state.sCount[nextLine] < state.blkIndent

    pos = state.bMarks[nextLine] + state.tShift[nextLine]
    max = state.eMarks[nextLine]

    if (pos >= max) {
      // Case 1: line is not inside the blockquote, and this line is empty.
      break
    }

    if (state.src.charCodeAt(pos++) === 0x3E/* > */ && !isOutdented) {
      // This line is inside the blockquote.

      // set offset past spaces and ">"
      let initial = state.sCount[nextLine] + 1
      let spaceAfterMarker
      let adjustTab

      // skip one optional space after '>'
      if (state.src.charCodeAt(pos) === 0x20 /* space */) {
        // ' >   test '
        //     ^ -- position start of line here:
        pos++
        initial++
        adjustTab = false
        spaceAfterMarker = true
      } else if (state.src.charCodeAt(pos) === 0x09 /* tab */) {
        spaceAfterMarker = true

        if ((state.bsCount[nextLine] + initial) % 4 === 3) {
          // '  >\t  test '
          //       ^ -- position start of line here (tab has width===1)
          pos++
          initial++
          adjustTab = false
        } else {
          // ' >\t  test '
          //    ^ -- position start of line here + shift bsCount slightly
          //         to make extra space appear
          adjustTab = true
        }
      } else {
        spaceAfterMarker = false
      }

      let offset = initial
      oldBMarks.push(state.bMarks[nextLine])
      state.bMarks[nextLine] = pos

      while (pos < max) {
        const ch = state.src.charCodeAt(pos)

        if (isSpace(ch)) {
          if (ch === 0x09) {
            offset += 4 - (offset + state.bsCount[nextLine] + (adjustTab ? 1 : 0)) % 4
          } else {
            offset++
          }
        } else {
          break
        }

        pos++
      }

      lastLineEmpty = pos >= max

      oldBSCount.push(state.bsCount[nextLine])
      state.bsCount[nextLine] = state.sCount[nextLine] + 1 + (spaceAfterMarker ? 1 : 0)

      oldSCount.push(state.sCount[nextLine])
      state.sCount[nextLine] = offset - initial

      oldTShift.push(state.tShift[nextLine])
      state.tShift[nextLine] = pos - state.bMarks[nextLine]
      continue
    }

    // Case 2: line is not inside the blockquote, and the last line was empty.
    if (lastLineEmpty) { break }

    // Case 3: another tag found.
    let terminate = false
    for (let i = 0, l = terminatorRules.length; i < l; i++) {
      if (terminatorRules[i](state, nextLine, endLine, true)) {
        terminate = true
        break
      }
    }

    if (terminate) {
      // Quirk to enforce "hard termination mode" for paragraphs;
      // normally if you call `tokenize(state, startLine, nextLine)`,
      // paragraphs will look below nextLine for paragraph continuation,
      // but if blockquote is terminated by another tag, they shouldn't
      state.lineMax = nextLine

      if (state.blkIndent !== 0) {
        // state.blkIndent was non-zero, we now set it to zero,
        // so we need to re-calculate all offsets to appear as
        // if indent wasn't changed
        oldBMarks.push(state.bMarks[nextLine])
        oldBSCount.push(state.bsCount[nextLine])
        oldTShift.push(state.tShift[nextLine])
        oldSCount.push(state.sCount[nextLine])
        state.sCount[nextLine] -= state.blkIndent
      }

      break
    }

    oldBMarks.push(state.bMarks[nextLine])
    oldBSCount.push(state.bsCount[nextLine])
    oldTShift.push(state.tShift[nextLine])
    oldSCount.push(state.sCount[nextLine])

    // A negative indentation means that this is a paragraph continuation
    //
    state.sCount[nextLine] = -1
  }

  const oldIndent = state.blkIndent
  state.blkIndent = 0

  const token_o = state.push('blockquote_open', 'blockquote', 1)
  token_o.markup = '>'
  token_o.meta = { noteCallout }
  const lines: [number, number] = [startLine, 0]
  token_o.map = lines

  yield bodyFrame(state, startLine, nextLine)

  const token_c = state.push('blockquote_close', 'blockquote', -1)
  token_c.markup = '>'

  state.lineMax = oldLineMax
  state.parentType = oldParentType
  lines[1] = state.line

  // Restore original tShift; this might not be necessary since the parser
  // has already been here, but just to make sure we can do that.
  for (let i = 0; i < oldTShift.length; i++) {
    state.bMarks[i + startLine] = oldBMarks[i]
    state.tShift[i + startLine] = oldTShift[i]
    state.sCount[i + startLine] = oldSCount[i]
    state.bsCount[i + startLine] = oldBSCount[i]
  }
  state.blkIndent = oldIndent

  return true
}
