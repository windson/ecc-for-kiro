// Reader and writer for the Markdown frontmatter shapes ECC uses.
//
// Reads: top-level `key: value` pairs; plain, double- and single-quoted scalars;
// one-line flow lists/maps; block lists (indented or not); one-level block maps;
// folded/literal block scalars (`>`, `>-`, `|`, `|+` ...). Anything else throws a
// FrontmatterError that names the line. Writes: JSON-style YAML (strings always quoted).

import {
  FrontmatterError,
  assertOnlyComment,
  parseDoubleQuoted,
  parseFlow,
  parsePlainScalar,
  parseSingleQuoted,
  withLine,
} from './yaml-lite.mjs';

export { FrontmatterError };

const FENCE = /^---[ \t]*$/;
const KEY_LINE = /^([A-Za-z_][A-Za-z0-9_.-]*)[ \t]*:(?:[ \t]+(.*))?$/;
const LIST_ITEM = /^-(?:[ \t]+(.*))?$/;
const BLOCK_SCALAR_HEADER = /^([|>])([+-]?)[ \t]*(?:[ \t]#.*)?$/;

const isBlank = (line) => /^[ \t]*$/.test(line);
const isComment = (line) => /^[ \t]*#/.test(line);

function indentOf(line, lineNo) {
  const leading = /^[ \t]*/.exec(line)[0];
  if (leading.includes('\t')) {
    throw new FrontmatterError('tabs are not allowed for indentation', { line: lineNo });
  }
  return leading.length;
}

/** A key's inline value; a value that is only a comment counts as empty. */
function effectiveRest(raw) {
  const text = (raw ?? '').trim();
  return text.startsWith('#') ? '' : text;
}

function assertSafeKey(key, lineNo) {
  if (key === '__proto__') {
    throw new FrontmatterError('the key "__proto__" is not allowed', { line: lineNo });
  }
}

// ---- document splitting -----------------------------------------------------

/**
 * Split a document into frontmatter lines and a verbatim body.
 * @param {string} input
 * @returns {{ hasFrontmatter: boolean, bom: boolean, eol: string, lines: string[], body: string }}
 */
export function splitDocument(input) {
  if (typeof input !== 'string') throw new TypeError('document must be a string');
  let text = input;
  let bom = false;
  if (text.charCodeAt(0) === 0xfeff) {
    bom = true;
    text = text.slice(1);
  }

  const firstBreak = text.indexOf('\n');
  const firstRaw = firstBreak === -1 ? text : text.slice(0, firstBreak);
  const eol = firstRaw.endsWith('\r') ? '\r\n' : '\n';
  const firstLine = firstRaw.endsWith('\r') ? firstRaw.slice(0, -1) : firstRaw;
  if (!FENCE.test(firstLine)) {
    return { hasFrontmatter: false, bom, eol, lines: [], body: text };
  }

  const lines = [];
  let pos = firstBreak === -1 ? text.length : firstBreak + 1;
  while (pos < text.length) {
    const lineBreak = text.indexOf('\n', pos);
    const rawLine = lineBreak === -1 ? text.slice(pos) : text.slice(pos, lineBreak);
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    const next = lineBreak === -1 ? text.length : lineBreak + 1;
    if (FENCE.test(line)) {
      return { hasFrontmatter: true, bom, eol, lines, body: text.slice(next) };
    }
    lines.push(line);
    pos = next;
  }
  throw new FrontmatterError('frontmatter is not closed with "---"', { line: 1 });
}

// ---- values -----------------------------------------------------------------

function parseInline(text) {
  const first = text[0];
  if (first === '"') {
    const { value, end } = parseDoubleQuoted(text, 0);
    assertOnlyComment(text.slice(end));
    return { value, style: 'double' };
  }
  if (first === "'") {
    const { value, end } = parseSingleQuoted(text, 0);
    assertOnlyComment(text.slice(end));
    return { value, style: 'single' };
  }
  if (first === '[' || first === '{') {
    return { value: parseFlow(text), style: 'flow' };
  }
  return { value: parsePlainScalar(text), style: 'plain' };
}

function parseListItem(text, lineNo) {
  try {
    if (text === '') return null;
    if (text === '-' || text.startsWith('- ')) {
      throw new FrontmatterError('nested lists are not supported');
    }
    if (text[0] === '|' || text[0] === '>') {
      throw new FrontmatterError('block scalars inside lists are not supported');
    }
    if (!/^["'[{]/.test(text) && /^[^\s"'[{][^:]*:(?:[ \t]|$)/.test(text)) {
      throw new FrontmatterError('lists of maps are not supported');
    }
    return parseInline(text).value;
  } catch (error) {
    throw withLine(error, lineNo);
  }
}

function readBlockList(lines, startIdx) {
  const items = [];
  let listIndent = null;
  let lastIdx = startIdx - 1;
  let i = startIdx;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line) || isComment(line)) {
      i += 1;
      continue;
    }
    const lineNo = i + 2;
    const indent = indentOf(line, lineNo);
    if (listIndent === null) listIndent = indent;
    if (indent < listIndent) break;
    if (indent > listIndent) {
      throw new FrontmatterError('unsupported nesting inside a list', { line: lineNo });
    }
    const match = LIST_ITEM.exec(line.slice(indent));
    if (!match) break;
    items.push(parseListItem((match[1] ?? '').trim(), lineNo));
    lastIdx = i;
    i += 1;
  }
  return { items, lastIdx };
}

function hasDeeperContent(lines, idx, indent) {
  let j = idx + 1;
  while (j < lines.length && (isBlank(lines[j]) || isComment(lines[j]))) j += 1;
  return j < lines.length && indentOf(lines[j], j + 2) > indent;
}

function readBlockMap(lines, startIdx, parentIndent) {
  const map = {};
  let mapIndent = null;
  let lastIdx = startIdx - 1;
  let i = startIdx;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line) || isComment(line)) {
      i += 1;
      continue;
    }
    const lineNo = i + 2;
    const indent = indentOf(line, lineNo);
    if (mapIndent === null) {
      if (indent <= parentIndent) break;
      mapIndent = indent;
    }
    if (indent < mapIndent) break;
    if (indent > mapIndent) {
      throw new FrontmatterError('nesting deeper than one level is not supported', { line: lineNo });
    }
    const match = KEY_LINE.exec(line.slice(indent));
    if (!match) {
      throw new FrontmatterError('cannot parse line; expected "key: value"', { line: lineNo });
    }
    const key = match[1];
    assertSafeKey(key, lineNo);
    if (Object.prototype.hasOwnProperty.call(map, key)) {
      throw new FrontmatterError(`duplicate key "${key}"`, { line: lineNo });
    }
    const rest = effectiveRest(match[2]);
    if (rest === '') {
      if (hasDeeperContent(lines, i, mapIndent)) {
        throw new FrontmatterError(`nesting deeper than one level is not supported under "${key}"`, { line: lineNo });
      }
      map[key] = null;
    } else if (rest[0] === '|' || rest[0] === '>') {
      throw new FrontmatterError(`block scalars are only supported for top-level keys ("${key}")`, { line: lineNo });
    } else {
      try {
        map[key] = parseInline(rest).value;
      } catch (error) {
        throw withLine(error, lineNo);
      }
    }
    lastIdx = i;
    i += 1;
  }
  return { map, lastIdx };
}

function foldLines(lines) {
  let out = '';
  let previous = null;
  let blanks = 0;
  for (const line of lines) {
    if (line === '') {
      blanks += 1;
      continue;
    }
    if (previous === null) {
      out += '\n'.repeat(blanks) + line;
    } else {
      const moreIndented = /^[ \t]/.test(line) || /^[ \t]/.test(previous);
      if (blanks > 0) out += '\n'.repeat(blanks + (moreIndented ? 1 : 0)) + line;
      else out += (moreIndented ? '\n' : ' ') + line;
    }
    previous = line;
    blanks = 0;
  }
  return out;
}

function readBlockScalar(lines, headerIdx, parentIndent, header) {
  const match = BLOCK_SCALAR_HEADER.exec(header);
  if (!match) {
    throw new FrontmatterError(`unsupported block scalar header ${JSON.stringify(header)}`);
  }
  const [, indicator, chomp] = match;

  const content = [];
  let contentIndent = null;
  let lastContentIdx = headerIdx;
  let i = headerIdx + 1;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      content.push({ text: '', blank: true });
      i += 1;
      continue;
    }
    const indent = indentOf(line, i + 2);
    if (contentIndent === null) {
      if (indent <= parentIndent) break;
      contentIndent = indent;
    } else if (indent < contentIndent) {
      if (indent > parentIndent) {
        throw new FrontmatterError('inconsistent indentation inside a block scalar', { line: i + 2 });
      }
      break;
    }
    content.push({ text: line.slice(contentIndent), blank: false });
    lastContentIdx = i;
    i += 1;
  }

  let trailingBlanks = 0;
  while (content.length > 0 && content[content.length - 1].blank) {
    content.pop();
    trailingBlanks += 1;
  }

  const texts = content.map((entry) => entry.text);
  let value = '';
  if (texts.length > 0) {
    value = indicator === '|' ? texts.join('\n') : foldLines(texts);
    if (chomp === '') value += '\n';
    if (chomp === '+') value += '\n'.repeat(1 + trailingBlanks);
  } else if (chomp === '+') {
    value = '\n'.repeat(trailingBlanks);
  }
  return {
    value,
    style: indicator === '|' ? 'literal' : 'folded',
    endIdx: lastContentIdx,
  };
}

function readEmptyValue(lines, keyIdx, parentIndent) {
  let j = keyIdx + 1;
  while (j < lines.length && (isBlank(lines[j]) || isComment(lines[j]))) j += 1;
  if (j >= lines.length) return { value: null, style: 'empty', endIdx: keyIdx };

  const indent = indentOf(lines[j], j + 2);
  if (LIST_ITEM.test(lines[j].slice(indent)) && indent >= parentIndent) {
    const { items, lastIdx } = readBlockList(lines, j);
    return { value: items, style: 'block-list', endIdx: lastIdx };
  }
  if (indent > parentIndent) {
    const { map, lastIdx } = readBlockMap(lines, j, parentIndent);
    return { value: map, style: 'block-map', endIdx: lastIdx };
  }
  return { value: null, style: 'empty', endIdx: keyIdx };
}

function parseBlockMapping(lines) {
  const data = {};
  const entries = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const lineNo = i + 2;
    if (isBlank(line) || isComment(line)) {
      i += 1;
      continue;
    }
    if (indentOf(line, lineNo) > 0) {
      throw new FrontmatterError('unexpected indentation (multi-line values are not supported)', { line: lineNo });
    }
    const match = KEY_LINE.exec(line);
    if (!match) {
      throw new FrontmatterError('cannot parse line; expected "key: value"', { line: lineNo });
    }
    const key = match[1];
    assertSafeKey(key, lineNo);
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      throw new FrontmatterError(`duplicate key "${key}"`, { line: lineNo });
    }

    const rest = effectiveRest(match[2]);
    let entry;
    try {
      if (rest === '') entry = readEmptyValue(lines, i, 0);
      else if (rest[0] === '|' || rest[0] === '>') entry = readBlockScalar(lines, i, 0, rest);
      else entry = { ...parseInline(rest), endIdx: i };
    } catch (error) {
      throw withLine(error, lineNo);
    }

    data[key] = entry.value;
    entries.push({
      key,
      style: entry.style,
      value: entry.value,
      startLine: lineNo,
      endLine: entry.endIdx + 2,
    });
    i = entry.endIdx + 1;
  }
  return { data, entries };
}

/**
 * Parse a document's frontmatter.
 * `entries[].startLine/endLine` are 1-based document lines (the opening fence is line 1),
 * so a caller can rewrite exactly the lines that belong to one key.
 * @param {string} text
 */
export function parseFrontmatter(text) {
  const doc = splitDocument(text);
  if (!doc.hasFrontmatter) {
    return { hasFrontmatter: false, data: {}, entries: [], body: doc.body, eol: doc.eol, bom: doc.bom };
  }
  const { data, entries } = parseBlockMapping(doc.lines);
  return { hasFrontmatter: true, data, entries, body: doc.body, eol: doc.eol, bom: doc.bom };
}

// ---- writing ----------------------------------------------------------------

/** Double-quote a string using only escapes every YAML parser understands. */
export function quoteString(value) {
  return JSON.stringify(value).replace(
    /[\u007f-\u009f\u2028\u2029\ufeff\ufffe\uffff]/g,
    (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

/** Format any JSON-compatible value as one-line, JSON-style YAML. */
export function formatFlow(value) {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return quoteString(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError('non-finite numbers cannot be written');
      return String(value);
    case 'object': {
      if (Array.isArray(value)) {
        return `[${value.map((item) => {
          if (item === undefined) throw new TypeError('undefined cannot be written inside a list');
          return formatFlow(item);
        }).join(', ')}]`;
      }
      const parts = [];
      for (const [key, item] of Object.entries(value)) {
        if (item === undefined) continue;
        parts.push(`${quoteString(key)}: ${formatFlow(item)}`);
      }
      return parts.length === 0 ? '{}' : `{${parts.join(', ')}}`;
    }
    default:
      throw new TypeError(`cannot write a value of type ${typeof value}`);
  }
}

/**
 * Serialize a frontmatter block, including both fences and a final line break.
 * @param {Record<string, unknown>} data
 * @param {{ eol?: string }} [options]
 */
export function serializeFrontmatter(data, { eol = '\n' } = {}) {
  const lines = ['---'];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(key) || key === '__proto__') {
      throw new TypeError(`invalid frontmatter key ${JSON.stringify(key)}`);
    }
    lines.push(`${key}: ${formatFlow(value)}`);
  }
  lines.push('---');
  return lines.join(eol) + eol;
}

/** Frontmatter followed by a body that is copied through unchanged. */
export function stringifyDocument(data, body, options = {}) {
  return serializeFrontmatter(data, options) + body;
}
