import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  FrontmatterError,
  formatFlow,
  parseFrontmatter,
  quoteString,
  serializeFrontmatter,
  splitDocument,
  stringifyDocument,
} from '../skills/ecc-kiro-setup/scripts/lib/frontmatter.mjs';

const doc = (...lines) => `---\n${lines.join('\n')}\n---\nbody\n`;
const parse = (...lines) => parseFrontmatter(doc(...lines));
const data = (...lines) => parse(...lines).data;
const throwsFm = (fn, pattern) =>
  assert.throws(fn, (error) => {
    assert.ok(error instanceof FrontmatterError, `expected FrontmatterError, got ${error}`);
    if (pattern) assert.match(error.message, pattern);
    return true;
  });

describe('splitDocument', () => {
  it('returns the whole text as body when there is no frontmatter', () => {
    const result = splitDocument('# Title\n\ntext\n');
    assert.equal(result.hasFrontmatter, false);
    assert.equal(result.body, '# Title\n\ntext\n');
  });

  it('does not treat a fence that is not on the first line as frontmatter', () => {
    assert.equal(splitDocument('\n---\na: 1\n---\n').hasFrontmatter, false);
  });

  it('splits frontmatter lines from the body', () => {
    const result = splitDocument('---\na: 1\nb: 2\n---\nBody\n');
    assert.deepEqual(result.lines, ['a: 1', 'b: 2']);
    assert.equal(result.body, 'Body\n');
    assert.equal(result.eol, '\n');
  });

  it('accepts a closing fence on the last line without a trailing newline', () => {
    const result = splitDocument('---\na: 1\n---');
    assert.deepEqual(result.lines, ['a: 1']);
    assert.equal(result.body, '');
  });

  it('accepts an empty frontmatter block', () => {
    const result = splitDocument('---\n---\nbody');
    assert.equal(result.hasFrontmatter, true);
    assert.deepEqual(result.lines, []);
    assert.equal(result.body, 'body');
  });

  it('accepts trailing spaces or tabs after a fence', () => {
    const result = splitDocument('---  \na: 1\n---\t\nx');
    assert.deepEqual(result.lines, ['a: 1']);
    assert.equal(result.body, 'x');
  });

  it('keeps the body byte-for-byte, including horizontal rules', () => {
    const body = '\nText\n\n---\n\nMore\n';
    assert.equal(splitDocument(`---\na: 1\n---\n${body}`).body, body);
  });

  it('handles CRLF documents and keeps CRLF in the body', () => {
    const result = splitDocument('---\r\na: 1\r\n---\r\nBody\r\nmore\r\n');
    assert.equal(result.eol, '\r\n');
    assert.deepEqual(result.lines, ['a: 1']);
    assert.equal(result.body, 'Body\r\nmore\r\n');
  });

  it('strips and reports a byte order mark', () => {
    const result = splitDocument('\uFEFF---\na: 1\n---\nx');
    assert.equal(result.bom, true);
    assert.deepEqual(result.lines, ['a: 1']);
  });

  it('throws when the frontmatter is not closed', () => {
    throwsFm(() => splitDocument('---\na: 1\n'), /line 1: frontmatter is not closed/);
    throwsFm(() => splitDocument('---'), /not closed/);
  });

  it('rejects non-string input', () => {
    assert.throws(() => splitDocument(null), TypeError);
  });
});

describe('parseFrontmatter scalars', () => {
  it('reads plain scalars as strings and types booleans, null and numbers', () => {
    assert.deepEqual(
      data('name: x', 'on: true', 'off: False', 'nothing: null', 'tilde: ~', 'count: 3', 'ratio: -1.5e2', 'version: 1.0.0'),
      { name: 'x', on: true, off: false, nothing: null, tilde: null, count: 3, ratio: -150, version: '1.0.0' },
    );
  });

  it('keeps unquoted text that only resembles other types as a string', () => {
    assert.deepEqual(data('a: yes', 'b: 0x10', 'c: 1_000', 'd: 1.'), { a: 'yes', b: '0x10', c: '1_000', d: '1.' });
  });

  it('reads double-quoted strings with escapes', () => {
    assert.deepEqual(data(String.raw`a: "say \"hi\" \\ \t|\n|\u00e9|\x41|\/"`), {
      a: 'say "hi" \\ \t|\n|é|A|/',
    });
  });

  it('reads single-quoted strings', () => {
    assert.deepEqual(data("a: 'it''s'", "b: ''"), { a: "it's", b: '' });
  });

  it('keeps colons, hashes and non-ASCII text inside quotes', () => {
    assert.deepEqual(data('a: "x: y # z — 1–5"'), { a: 'x: y # z — 1–5' });
  });

  it('allows a comment after a quoted value and rejects other trailing text', () => {
    assert.deepEqual(data('a: "x" # note', "b: 'y'   # note"), { a: 'x', b: 'y' });
    throwsFm(() => parse('a: "x" y'), /unexpected text after value/);
  });

  it('strips a trailing comment from plain values but keeps # without a leading space', () => {
    assert.deepEqual(data('a: foo # comment', 'b: C# and F#', 'c: x#y'), { a: 'foo', b: 'C# and F#', c: 'x#y' });
  });

  it('treats a value that is only a comment as empty', () => {
    assert.deepEqual(data('a: # nothing', 'b: 1'), { a: null, b: 1 });
  });

  it('allows a colon that is not followed by a space inside plain values', () => {
    assert.deepEqual(data('url: https://example.com/a:b'), { url: 'https://example.com/a:b' });
  });

  it('allows hints that start with < or contain *', () => {
    assert.deepEqual(data('argument-hint: <path/to/*.plan.md>'), { 'argument-hint': '<path/to/*.plan.md>' });
  });

  it('rejects plain values that strict YAML parsers reject', () => {
    throwsFm(() => parse('a: one: two'), /": "/);
    throwsFm(() => parse('a: ends with:'), /": "/);
    throwsFm(() => parse('a: *.ts'), /anchors, aliases and tags/);
    throwsFm(() => parse('a: &anchor x'), /anchors, aliases and tags/);
    throwsFm(() => parse('a: !tag x'), /anchors, aliases and tags/);
    throwsFm(() => parse('a: @user'), /cannot start a plain value/);
    throwsFm(() => parse('a: %x'), /cannot start a plain value/);
    throwsFm(() => parse('a: - x'), /quote the value/);
  });

  it('rejects unsupported double-quote escapes and broken strings', () => {
    throwsFm(() => parse(String.raw`a: "\q"`), /unsupported escape/);
    throwsFm(() => parse(String.raw`a: "\u00zz"`), /invalid "\\u" escape/);
    throwsFm(() => parse('a: "open'), /unterminated double-quoted/);
    throwsFm(() => parse("a: 'open"), /unterminated single-quoted/);
  });
});

describe('parseFrontmatter flow collections', () => {
  it('reads flow lists of mixed scalars', () => {
    assert.deepEqual(data(`a: [x, "y, z", 'w', 3, true]`), { a: ['x', 'y, z', 'w', 3, true] });
  });

  it('reads empty and trailing-comma lists', () => {
    assert.deepEqual(data('a: []', 'b: [x, y,]'), { a: [], b: ['x', 'y'] });
  });

  it('keeps a bracketed hint with pipes and spaces as one item', () => {
    assert.deepEqual(data('argument-hint: [pr-number | pr-url | blank for local review]'), {
      'argument-hint': ['pr-number | pr-url | blank for local review'],
    });
  });

  it('reads nested flow lists and maps', () => {
    assert.deepEqual(data(`a: [["x"], {"k": 1}]`, `b: {"n": 1, m: true, "l": [1, 2], z: null, e: ""}`), {
      a: [['x'], { k: 1 }],
      b: { n: 1, m: true, l: [1, 2], z: null, e: '' },
    });
  });

  it('allows a comment after a flow value', () => {
    assert.deepEqual(data('a: [x, y] # note'), { a: ['x', 'y'] });
  });

  it('rejects unterminated or malformed flow values', () => {
    throwsFm(() => parse('a: [x, y'), /unterminated flow list/);
    throwsFm(() => parse('a: {"k": 1'), /unterminated flow map/);
    throwsFm(() => parse('a: [x y: z]'), /expected ","/);
    throwsFm(() => parse('a: [x[1]]'), /quote the value/);
    throwsFm(() => parse('a: [*.ts]'), /anchors, aliases and tags/);
    throwsFm(() => parse('a: [x] y'), /unexpected text after value/);
    throwsFm(() => parse('a: {"__proto__": 1}'), /__proto__/);
  });
});

describe('parseFrontmatter block lists', () => {
  it('reads an indented list of quoted and plain items', () => {
    assert.deepEqual(data('paths:', '  - "**/*.ts"', "  - '**/*.tsx'", '  - plain item'), {
      paths: ['**/*.ts', '**/*.tsx', 'plain item'],
    });
  });

  it('reads a list indented at the same level as its key', () => {
    assert.deepEqual(data('tools:', '- Read', '- Grep', 'name: x'), { tools: ['Read', 'Grep'], name: 'x' });
  });

  it('skips blank lines and comments between items', () => {
    assert.deepEqual(data('a:', '  - one', '', '  # note', '  - two', 'b: 1'), { a: ['one', 'two'], b: 1 });
  });

  it('reads a bare dash as null and a flow list as an item', () => {
    assert.deepEqual(data('a:', '  -', '  - [x, y]'), { a: [null, ['x', 'y']] });
  });

  it('treats a key with nothing after it as null', () => {
    assert.deepEqual(data('a:', 'b: 1'), { a: null, b: 1 });
    assert.deepEqual(data('a:'), { a: null });
  });

  it('rejects lists of maps, nested lists and deeper nesting', () => {
    throwsFm(() => parse('a:', '  - key: value'), /lists of maps/);
    throwsFm(() => parse('a:', '  - - x'), /nested lists/);
    throwsFm(() => parse('a:', '  - x', '    - y'), /unsupported nesting/);
    throwsFm(() => parse('a:', '  - |'), /block scalars inside lists/);
  });
});

describe('parseFrontmatter block maps', () => {
  it('reads a one-level map', () => {
    assert.deepEqual(data('metadata:', '  origin: ECC', '  version: "1.0"', 'name: x'), {
      metadata: { origin: 'ECC', version: '1.0' },
      name: 'x',
    });
  });

  it('reads a null nested value', () => {
    assert.deepEqual(data('metadata:', '  origin:', '  other: 1'), { metadata: { origin: null, other: 1 } });
  });

  it('rejects deeper nesting, nested block scalars and duplicate nested keys', () => {
    throwsFm(() => parse('m:', '  a:', '    b: 1'), /deeper than one level/);
    throwsFm(() => parse('m:', '  a: 1', '    b: 2'), /deeper than one level/);
    throwsFm(() => parse('m:', '  a: >', '    text'), /only supported for top-level keys/);
    throwsFm(() => parse('m:', '  a: 1', '  a: 2'), /duplicate key "a"/);
    throwsFm(() => parse('m:', '  a: 1', '  not a key'), /expected "key: value"/);
  });
});

describe('parseFrontmatter block scalars', () => {
  it('folds `>-` into one line without a trailing newline', () => {
    assert.deepEqual(data('description: >-', '  Use after sample-intake has produced a set.', "  Scores each item with fixed 1–5 scales.", 'license: MIT'), {
      description: 'Use after sample-intake has produced a set. Scores each item with fixed 1–5 scales.',
      license: 'MIT',
    });
  });

  it('keeps one trailing newline for `>` (clip)', () => {
    assert.deepEqual(data('d: >', '  one', '  two', '', 'k: v'), { d: 'one two\n', k: 'v' });
  });

  it('keeps line breaks for `|` and strips for `|-`', () => {
    assert.deepEqual(data('a: |', '  one', '  two', 'b: |-', '  x', '  y'), { a: 'one\ntwo\n', b: 'x\ny' });
  });

  it('keeps all trailing newlines for `|+`', () => {
    assert.equal(parseFrontmatter('---\na: |+\n  one\n\n\n---\n').data.a, 'one\n\n\n');
  });

  it('turns blank lines in folded text into line breaks', () => {
    assert.deepEqual(data('a: >-', '  first', '', '  second'), { a: 'first\nsecond' });
    assert.deepEqual(data('a: >-', '  first', '', '', '  second'), { a: 'first\n\nsecond' });
  });

  it('keeps breaks around more-indented folded lines', () => {
    assert.deepEqual(data('a: >-', '  text', '    indented', '  more'), { a: 'text\n  indented\nmore' });
  });

  it('allows a comment after the header and uneven first-line indentation', () => {
    assert.deepEqual(data('a: >- # note', '    deep', '    text'), { a: 'deep text' });
  });

  it('reads an empty block scalar as an empty string', () => {
    assert.deepEqual(data('a: >-', 'b: 1'), { a: '', b: 1 });
  });

  it('rejects unsupported headers and inconsistent indentation', () => {
    throwsFm(() => parse('a: >2', '  x'), /unsupported block scalar header/);
    throwsFm(() => parse('a: |x', '  x'), /unsupported block scalar header/);
    throwsFm(() => parse('a: >-', '    four', '  two'), /inconsistent indentation/);
  });
});

describe('parseFrontmatter structure errors', () => {
  it('rejects duplicate keys with the line number', () => {
    throwsFm(() => parse('a: 1', 'b: 2', 'a: 3'), /line 4: duplicate key "a"/);
  });

  it('rejects tab indentation', () => {
    throwsFm(() => parse('a:', '\t- x'), /tabs are not allowed/);
  });

  it('rejects continuation lines of a plain value', () => {
    throwsFm(() => parse('a: first', '  second'), /unexpected indentation/);
  });

  it('rejects lines that are not key: value pairs', () => {
    throwsFm(() => parse('not a key'), /expected "key: value"/);
    throwsFm(() => parse('a:b'), /expected "key: value"/);
    throwsFm(() => parse('"quoted": 1'), /expected "key: value"/);
  });

  it('rejects the __proto__ key', () => {
    throwsFm(() => parse('__proto__: x'), /__proto__/);
  });

  it('reports the right line for errors deep in the block', () => {
    throwsFm(() => parse('a: 1', 'b: 2', 'c: "open'), /line 4: unterminated double-quoted/);
  });
});

describe('parseFrontmatter result', () => {
  it('returns hasFrontmatter false and an empty map when there is none', () => {
    const result = parseFrontmatter('# Only a title\n');
    assert.equal(result.hasFrontmatter, false);
    assert.deepEqual(result.data, {});
    assert.equal(result.body, '# Only a title\n');
  });

  it('returns the body verbatim', () => {
    assert.equal(parse('a: 1').body, 'body\n');
  });

  it('reports 1-based document lines for each entry', () => {
    const text = [
      '---', // 1
      'name: x', // 2
      '# comment', // 3
      'description: >-', // 4
      '  folded', // 5
      '  text', // 6
      '', // 7
      'tools:', // 8
      '  - a', // 9
      '  - b', // 10
      'metadata:', // 11
      '  origin: ECC', // 12
      'flag: true', // 13
      '---',
      '',
    ].join('\n');
    const { entries } = parseFrontmatter(text);
    assert.deepEqual(
      entries.map(({ key, style, startLine, endLine }) => ({ key, style, startLine, endLine })),
      [
        { key: 'name', style: 'plain', startLine: 2, endLine: 2 },
        { key: 'description', style: 'folded', startLine: 4, endLine: 6 },
        { key: 'tools', style: 'block-list', startLine: 8, endLine: 10 },
        { key: 'metadata', style: 'block-map', startLine: 11, endLine: 12 },
        { key: 'flag', style: 'plain', startLine: 13, endLine: 13 },
      ],
    );
  });

  it('parses the same data from a CRLF document', () => {
    const lf = '---\nname: x\ntools:\n  - a\ndescription: >-\n  one\n  two\n---\nbody\n';
    const crlf = lf.replaceAll('\n', '\r\n');
    const a = parseFrontmatter(lf);
    const b = parseFrontmatter(crlf);
    assert.deepEqual(b.data, a.data);
    assert.equal(b.eol, '\r\n');
    assert.equal(b.body, 'body\r\n');
  });

  it('parses the frontmatter of a skill with a folded description over several lines', () => {
    // Synthetic text with the shape of a long skill description: a folded block, an apostrophe, an en dash and parentheses.
    const text = [
      '---',
      'name: sample-methodology',
      'description: >-',
      '  Use after the sample-intake step has produced a ranked list.',
      '  Scores each item across six weighted measures (clarity, tone,',
      '  layout, evidence, reach, the owner\'s constraints) with fixed 1–5 scales',
      '  and a summary chart. Comes before sample-report-layout and needs',
      '  entries.',
      'license: MIT',
      'metadata:',
      '  origin: sample',
      '---',
      '',
      '# Sample',
    ].join('\n');
    const { data: parsed } = parseFrontmatter(text);
    assert.equal(
      parsed.description,
      "Use after the sample-intake step has produced a ranked list. Scores each item across six weighted measures (clarity, tone, layout, evidence, reach, the owner's constraints) with fixed 1–5 scales and a summary chart. Comes before sample-report-layout and needs entries.",
    );
    assert.equal(parsed.description.split(' ').length, 39);
    assert.deepEqual(parsed.metadata, { origin: 'sample' });
  });
});

describe('writing frontmatter', () => {
  it('quotes strings with JSON escapes and escapes characters YAML treats as breaks', () => {
    assert.equal(quoteString('a "b" \\ \n'), '"a \\"b\\" \\\\ \\n"');
    assert.equal(quoteString('\u2028\u0085\u007f\ufeff'), '"\\u2028\\u0085\\u007f\\ufeff"');
    assert.equal(quoteString('é—😀'), '"é—😀"');
  });

  it('formats nested values as one-line JSON-style YAML', () => {
    assert.equal(
      formatFlow({ rules: [{ capability: 'shell', match: ['git diff*'], effect: 'allow' }], ok: true, n: 2, none: null, skip: undefined }),
      '{"rules": [{"capability": "shell", "match": ["git diff*"], "effect": "allow"}], "ok": true, "n": 2, "none": null}',
    );
    assert.equal(formatFlow([]), '[]');
    assert.equal(formatFlow({}), '{}');
  });

  it('serializes a frontmatter block with fences and a final line break', () => {
    assert.equal(
      serializeFrontmatter({ name: 'planner', description: 'Plans — "big" work', tools: ['read', 'shell'], flag: false, skip: undefined }),
      '---\nname: "planner"\ndescription: "Plans — \\"big\\" work"\ntools: ["read", "shell"]\nflag: false\n---\n',
    );
  });

  it('honors the requested line ending', () => {
    assert.equal(serializeFrontmatter({ a: 'b' }, { eol: '\r\n' }), '---\r\na: "b"\r\n---\r\n');
  });

  it('refuses keys and values it cannot write safely', () => {
    assert.throws(() => serializeFrontmatter({ 'bad key': 1 }), TypeError);
    assert.throws(() => serializeFrontmatter(JSON.parse('{"__proto__": 1}')), TypeError);
    assert.throws(() => serializeFrontmatter({ n: Number.NaN }), TypeError);
    assert.throws(() => serializeFrontmatter({ f: () => 1 }), TypeError);
    assert.throws(() => serializeFrontmatter({ l: [undefined] }), TypeError);
  });

  it('round-trips awkward values through write then read', () => {
    const tricky = [
      '',
      ' leading and trailing ',
      'line1\nline2',
      'tab\there',
      'quote " and \' mix',
      'back\\slash',
      '# not a comment',
      '- not a list',
      '[not, a, list]',
      '{not: a map}',
      'key: value',
      'true',
      'null',
      '123',
      '~',
      '\u2028 line separator',
      '\u007f delete',
      'emoji 😀 and é',
      '*.ts',
      '@user',
    ];
    const value = {
      strings: tricky,
      flag: true,
      off: false,
      none: null,
      number: 42,
      nested: { rules: [{ capability: 'shell', match: ['npm *'], effect: 'allow' }], empty: {}, list: [] },
    };
    for (const str of tricky) {
      assert.deepEqual(parseFrontmatter(serializeFrontmatter({ v: str })).data, { v: str }, JSON.stringify(str));
    }
    assert.deepEqual(parseFrontmatter(serializeFrontmatter(value)).data, value);
  });

  it('writes a document whose body is copied through unchanged', () => {
    const body = '\n# Title\r\n\r\n---\nstill body';
    const text = stringifyDocument({ name: 'x' }, body);
    const parsed = parseFrontmatter(text);
    assert.deepEqual(parsed.data, { name: 'x' });
    assert.equal(parsed.body, body);
  });
});
