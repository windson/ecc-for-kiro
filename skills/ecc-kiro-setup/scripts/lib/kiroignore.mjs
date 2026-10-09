// The managed block in .kiroignore: the lines that hide the folders of other harnesses from Kiro.
//
// Pure. Only the lines from the begin marker to the end marker belong to the installer. Every other
// byte of the file is the user's and is never rewritten, not even its line endings.

import { HARNESS_DIRS, KIROIGNORE_BLOCK_BEGIN, KIROIGNORE_BLOCK_END } from './constants.mjs';
import { CodedError } from './exit.mjs';
import { compareStrings } from './paths.mjs';

const INTRO = '# Folders of other harnesses. Kiro would otherwise read their instructions next to the ECC steering.';

/**
 * The text of the block for these folders: marker lines around one pattern per folder, with no final
 * newline. A trailing slash makes each pattern match a folder, at any depth.
 * @param {string[]} folders names from HARNESS_DIRS
 */
export function buildBlock(folders) {
  if (folders.length === 0) throw new TypeError('a block needs at least one folder');
  for (const name of folders) {
    if (!HARNESS_DIRS.includes(name)) throw new TypeError(`${JSON.stringify(name)} is not a known harness folder`);
  }
  const names = [...new Set(folders)].sort(compareStrings);
  return [KIROIGNORE_BLOCK_BEGIN, INTRO, ...names.map((name) => `${name}/`), KIROIGNORE_BLOCK_END].join('\n');
}

/** Each line with the offsets where it starts and ends; the end includes the line break. */
function* linesOf(text) {
  let start = 0;
  while (start < text.length) {
    const newline = text.indexOf('\n', start);
    const end = newline === -1 ? text.length : newline + 1;
    yield { start, end, content: text.slice(start, newline === -1 ? end : newline).replace(/\r$/, '') };
    start = end;
  }
}

/**
 * Find the block. A marker line is a whole line; the block is the lines from the begin marker to the
 * end marker. `problem` is set when the markers are not exactly one begin line followed by one end line.
 * @param {string} text the content of .kiroignore
 * @returns {{ found: null | { start: number, end: number, text: string }, problem: string | null }}
 *   `text` is the block with line breaks as \n and no final one, whatever the file uses
 */
export function findBlock(text) {
  const begins = [];
  const ends = [];
  for (const line of linesOf(text)) {
    const mark = line.content.trim();
    if (mark === KIROIGNORE_BLOCK_BEGIN) begins.push(line);
    else if (mark === KIROIGNORE_BLOCK_END) ends.push(line);
  }
  if (begins.length === 0 && ends.length === 0) return { found: null, problem: null };
  if (begins.length !== 1 || ends.length !== 1 || ends[0].start < begins[0].start) {
    return { found: null, problem: 'the ECC marker lines are damaged (expected one begin line followed by one end line)' };
  }
  const { start } = begins[0];
  const { end } = ends[0];
  return { found: { start, end, text: text.slice(start, end).replace(/\r\n/g, '\n').replace(/\n$/, '') }, problem: null };
}

const damaged = (problem) => new CodedError('kiroignore-damaged', `.kiroignore: ${problem}`, { fix: 'Fix the two marker lines by hand, or remove the lines between them, and run again.' });
const lineBreakOf = (text) => (text.includes('\r\n') ? '\r\n' : '\n');

/**
 * The file with the block in it: replaced where it is, or added at the end after one blank line.
 * @param {string} text the current content of .kiroignore ('' when there is none)
 * @param {string} block from buildBlock
 */
export function withBlock(text, block) {
  const { found, problem } = findBlock(text);
  if (problem !== null) throw damaged(problem);
  // A new block follows the file; a block that is replaced keeps the line breaks it had.
  const eol = lineBreakOf(found === null ? text : text.slice(found.start, found.end));
  const lines = `${block.split('\n').join(eol)}${eol}`;
  if (found !== null) return text.slice(0, found.start) + lines + text.slice(found.end);
  if (text === '') return lines;
  return `${text.endsWith('\n') ? text : text + eol}${eol}${lines}`;
}

/**
 * The file without the block, and without the one blank line that withBlock put before it.
 * @param {string} text the current content of .kiroignore
 */
export function withoutBlock(text) {
  const { found, problem } = findBlock(text);
  if (problem !== null) throw damaged(problem);
  if (found === null) return text;
  const before = text.slice(0, found.start);
  const blank = /(?:^|\n)(\r?\n)$/.exec(before);
  return (blank === null ? before : before.slice(0, before.length - blank[1].length)) + text.slice(found.end);
}
