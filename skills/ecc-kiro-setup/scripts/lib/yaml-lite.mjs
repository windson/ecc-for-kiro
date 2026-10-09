// A deliberately small YAML reader for scalars and single-line flow collections.
//
// Supported: plain scalars (true/false/null/JSON numbers are typed), double- and
// single-quoted strings on one line, and flow lists/maps on one line (nested).
// Everything else throws FrontmatterError so unsupported input never passes silently.

export class FrontmatterError extends Error {
  /**
   * @param {string} message
   * @param {{ line?: number | null }} [options] 1-based document line
   */
  constructor(message, { line = null } = {}) {
    super(line === null ? message : `line ${line}: ${message}`);
    this.name = 'FrontmatterError';
    this.detail = message;
    this.line = line;
  }
}

/** Attach a line number to a FrontmatterError that does not have one yet. */
export function withLine(error, line) {
  if (error instanceof FrontmatterError && error.line === null) {
    return new FrontmatterError(error.detail, { line });
  }
  return error;
}

const DQ_SIMPLE_ESCAPES = new Map([
  ['0', '\0'],
  ['a', '\x07'],
  ['b', '\b'],
  ['t', '\t'],
  ['\t', '\t'],
  ['n', '\n'],
  ['v', '\v'],
  ['f', '\f'],
  ['r', '\r'],
  ['e', '\x1b'],
  [' ', ' '],
  ['"', '"'],
  ['/', '/'],
  ['\\', '\\'],
  ['N', '\u0085'],
  ['_', '\u00a0'],
  ['L', '\u2028'],
  ['P', '\u2029'],
]);
const DQ_HEX_ESCAPES = { x: 2, u: 4, U: 8 };

/**
 * Parse a double-quoted string that starts at text[start] === '"'.
 * @returns {{ value: string, end: number }} end is the index after the closing quote
 */
export function parseDoubleQuoted(text, start = 0) {
  let out = '';
  let i = start + 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') return { value: out, end: i + 1 };
    if (ch !== '\\') {
      out += ch;
      i += 1;
      continue;
    }
    const next = text[i + 1];
    if (next === undefined) break;
    if (DQ_SIMPLE_ESCAPES.has(next)) {
      out += DQ_SIMPLE_ESCAPES.get(next);
      i += 2;
      continue;
    }
    const width = DQ_HEX_ESCAPES[next];
    if (width === undefined) {
      throw new FrontmatterError(`unsupported escape "\\${next}" in double-quoted string`);
    }
    const hex = text.slice(i + 2, i + 2 + width);
    if (hex.length !== width || !/^[0-9a-fA-F]+$/.test(hex)) {
      throw new FrontmatterError(`invalid "\\${next}" escape in double-quoted string`);
    }
    const codePoint = Number.parseInt(hex, 16);
    if (codePoint > 0x10ffff) {
      throw new FrontmatterError(`code point out of range in "\\${next}" escape`);
    }
    out += String.fromCodePoint(codePoint);
    i += 2 + width;
  }
  throw new FrontmatterError('unterminated double-quoted string (multi-line strings are not supported)');
}

/**
 * Parse a single-quoted string that starts at text[start] === "'".
 * @returns {{ value: string, end: number }}
 */
export function parseSingleQuoted(text, start = 0) {
  let out = '';
  let i = start + 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "'") {
      if (text[i + 1] === "'") {
        out += "'";
        i += 2;
        continue;
      }
      return { value: out, end: i + 1 };
    }
    out += ch;
    i += 1;
  }
  throw new FrontmatterError('unterminated single-quoted string (multi-line strings are not supported)');
}

/** After a quoted or flow value only whitespace or a " # comment" may follow. */
export function assertOnlyComment(rest) {
  if (/^[ \t]*$/.test(rest) || /^[ \t]+#/.test(rest)) return;
  throw new FrontmatterError(`unexpected text after value: ${JSON.stringify(rest.trim().slice(0, 30))}`);
}

export function assertPlainStart(text) {
  if (/^[&*!]/.test(text)) {
    throw new FrontmatterError('anchors, aliases and tags are not supported');
  }
  if (/^[%@`]/.test(text)) {
    throw new FrontmatterError(`"${text[0]}" cannot start a plain value; quote the value`);
  }
  if (/^[-?:](?:[ \t]|$)/.test(text)) {
    throw new FrontmatterError(`"${text[0]}" at the start of a value is not supported; quote the value`);
  }
}

const JSON_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/** Type a plain token: booleans, null and JSON-style numbers; everything else stays a string. */
export function coercePlain(token) {
  if (/^(?:true|True|TRUE)$/.test(token)) return true;
  if (/^(?:false|False|FALSE)$/.test(token)) return false;
  if (/^(?:null|Null|NULL|~)$/.test(token)) return null;
  if (JSON_NUMBER.test(token)) return Number(token);
  return token;
}

/**
 * Parse a block-context plain scalar, dropping a trailing " # comment".
 * A ": " inside the value is rejected because strict YAML parsers reject it too,
 * so a value this reader accepts is one Kiro's own parser will also accept.
 */
export function parsePlainScalar(text) {
  assertPlainStart(text);
  const commentAt = text.search(/[ \t]#/);
  const value = (commentAt === -1 ? text : text.slice(0, commentAt)).trimEnd();
  if (/:(?:[ \t]|$)/.test(value)) {
    throw new FrontmatterError('plain value contains ": " (or ends with ":"); quote the value');
  }
  return coercePlain(value);
}

// ---- flow collections -------------------------------------------------------

const isSpaceOrEnd = (ch) => ch === undefined || ch === ' ' || ch === '\t';

function skipSpaces(state) {
  while (state.i < state.text.length && (state.text[state.i] === ' ' || state.text[state.i] === '\t')) {
    state.i += 1;
  }
}

function takeQuoted(state, parse) {
  const result = parse(state.text, state.i);
  state.i = result.end;
  return result.value;
}

function takePlainToken(state) {
  const start = state.i;
  while (state.i < state.text.length) {
    const ch = state.text[state.i];
    if (ch === ',' || ch === ']' || ch === '}') break;
    if (ch === '[' || ch === '{') {
      throw new FrontmatterError(`unexpected "${ch}" inside a plain flow value; quote the value`);
    }
    if (ch === ':' && isSpaceOrEnd(state.text[state.i + 1])) break;
    state.i += 1;
  }
  const token = state.text.slice(start, state.i).trim();
  if (token === '') throw new FrontmatterError('empty item in flow collection');
  assertPlainStart(token);
  return token;
}

function parseFlowNode(state) {
  skipSpaces(state);
  const ch = state.text[state.i];
  if (ch === '[') return parseFlowSequence(state);
  if (ch === '{') return parseFlowMap(state);
  if (ch === '"') return takeQuoted(state, parseDoubleQuoted);
  if (ch === "'") return takeQuoted(state, parseSingleQuoted);
  return coercePlain(takePlainToken(state));
}

function parseFlowSequence(state) {
  state.i += 1;
  const items = [];
  for (;;) {
    skipSpaces(state);
    if (state.i >= state.text.length) throw new FrontmatterError('unterminated flow list (multi-line lists are not supported)');
    if (state.text[state.i] === ']') {
      state.i += 1;
      return items;
    }
    items.push(parseFlowNode(state));
    skipSpaces(state);
    const ch = state.text[state.i];
    if (ch === ',') {
      state.i += 1;
    } else if (ch === ']') {
      state.i += 1;
      return items;
    } else if (ch === undefined) {
      throw new FrontmatterError('unterminated flow list (multi-line lists are not supported)');
    } else {
      throw new FrontmatterError('expected "," or "]" in flow list');
    }
  }
}

function parseFlowKey(state) {
  skipSpaces(state);
  const ch = state.text[state.i];
  if (ch === '"') return takeQuoted(state, parseDoubleQuoted);
  if (ch === "'") return takeQuoted(state, parseSingleQuoted);
  return takePlainToken(state);
}

function parseFlowMap(state) {
  state.i += 1;
  const out = {};
  for (;;) {
    skipSpaces(state);
    if (state.i >= state.text.length) throw new FrontmatterError('unterminated flow map (multi-line maps are not supported)');
    if (state.text[state.i] === '}') {
      state.i += 1;
      return out;
    }
    const key = parseFlowKey(state);
    if (key === '__proto__') throw new FrontmatterError('the key "__proto__" is not allowed');
    skipSpaces(state);
    if (state.text[state.i] !== ':') throw new FrontmatterError('expected ":" after a key in flow map');
    state.i += 1;
    skipSpaces(state);
    const atEnd = state.text[state.i] === ',' || state.text[state.i] === '}';
    out[key] = atEnd ? null : parseFlowNode(state);
    skipSpaces(state);
    const next = state.text[state.i];
    if (next === ',') {
      state.i += 1;
    } else if (next === '}') {
      state.i += 1;
      return out;
    } else if (next === undefined) {
      throw new FrontmatterError('unterminated flow map (multi-line maps are not supported)');
    } else {
      throw new FrontmatterError('expected "," or "}" in flow map');
    }
  }
}

/** Parse a one-line flow list or map such as `["a", "b"]`. */
export function parseFlow(text) {
  const state = { text, i: 0 };
  const value = parseFlowNode(state);
  assertOnlyComment(text.slice(state.i));
  return value;
}
