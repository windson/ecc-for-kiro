import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { HARNESS_DIRS, KIROIGNORE_BLOCK_BEGIN as BEGIN, KIROIGNORE_BLOCK_END as END } from '../skills/ecc-kiro-setup/scripts/lib/constants.mjs';
import { CodedError } from '../skills/ecc-kiro-setup/scripts/lib/exit.mjs';
import { buildBlock, findBlock, withBlock, withoutBlock } from '../skills/ecc-kiro-setup/scripts/lib/kiroignore.mjs';

const BLOCK = buildBlock(['.kimi-code', '.claude']);
const crlf = (text) => text.replaceAll('\n', '\r\n');

describe('buildBlock', () => {
  it('wraps one pattern per folder in the two marker lines, sorted, with no final newline', () => {
    assert.deepEqual(BLOCK.split('\n'), [
      '# >>> ecc-kiro-setup (managed block, do not edit) >>>',
      '# Folders of other harnesses. Kiro would otherwise read their instructions next to the ECC steering.',
      '.claude/',
      '.kimi-code/',
      '# <<< ecc-kiro-setup <<<',
    ]);
    assert.ok(!BLOCK.endsWith('\n'));
  });

  it('lists a folder once, and does not depend on the order it was given in', () => {
    assert.equal(buildBlock(['.claude', '.kimi-code', '.claude']), BLOCK);
    assert.equal(buildBlock(['.kimi-code', '.claude']), buildBlock(['.claude', '.kimi-code']));
  });

  it('writes a trailing slash, so each pattern names a folder', () => {
    for (const name of HARNESS_DIRS) {
      const lines = buildBlock([name]).split('\n');
      assert.equal(lines[2], `${name}/`);
    }
  });

  it('refuses an empty list and a name that is not a harness folder', () => {
    assert.throws(() => buildBlock([]), TypeError);
    for (const bad of ['.kiro', 'src', '../.claude', '.claude/', '*', '']) {
      assert.throws(() => buildBlock([bad]), /not a known harness folder/, JSON.stringify(bad));
    }
  });
});

describe('findBlock', () => {
  it('finds nothing in a file without markers, including an empty one', () => {
    for (const text of ['', '\n', 'node_modules/\n.env\n', '# a comment\n']) {
      assert.deepEqual(findBlock(text), { found: null, problem: null }, JSON.stringify(text));
    }
  });

  it('finds the block and returns its text, offsets included', () => {
    const text = `.env\n\n${BLOCK}\n*.log\n`;
    const { found, problem } = findBlock(text);
    assert.equal(problem, null);
    assert.equal(found.text, BLOCK);
    assert.equal(text.slice(found.start, found.end), `${BLOCK}\n`);
    assert.equal(text.slice(0, found.start), '.env\n\n');
    assert.equal(text.slice(found.end), '*.log\n');
  });

  it('finds a block at the very end of a file that has no final newline', () => {
    const { found } = findBlock(`.env\n${BLOCK}`);
    assert.equal(found.text, BLOCK);
    assert.equal(`.env\n${BLOCK}`.slice(found.end), '');
  });

  it('returns the same block text whatever line breaks the file uses', () => {
    assert.equal(findBlock(`.env\r\n${crlf(BLOCK)}\r\n`).found.text, BLOCK);
    assert.equal(findBlock(`${BLOCK}\n`).found.text, BLOCK);
  });

  it('sees a change a user made inside the block', () => {
    const edited = BLOCK.replace('.claude/', '.claude/\nmy-extra/');
    assert.equal(findBlock(`${edited}\n`).found.text, edited);
    assert.notEqual(edited, BLOCK);
  });

  it('takes a marker to be a whole line, with spaces around it allowed, and keeps them in the block text', () => {
    const indented = `  ${BEGIN}  \n.claude/\n\t${END}`;
    assert.equal(findBlock(`${indented}\n`).found.text, indented);
    assert.notEqual(indented, `${BEGIN}\n.claude/\n${END}`, 'so an indented marker counts as an edit');
    assert.deepEqual(findBlock(`# not ${BEGIN}\n${END} trailing\n`), { found: null, problem: null });
  });

  it('reports damaged markers instead of guessing', () => {
    const cases = {
      'a begin line without an end line': `${BEGIN}\n.claude/\n`,
      'an end line without a begin line': `.claude/\n${END}\n`,
      'two blocks': `${BLOCK}\n${BLOCK}\n`,
      'two begin lines': `${BEGIN}\n${BEGIN}\n${END}\n`,
      'an end line before the begin line': `${END}\n${BEGIN}\n`,
    };
    for (const [name, text] of Object.entries(cases)) {
      const result = findBlock(text);
      assert.equal(result.found, null, name);
      assert.match(result.problem, /marker lines are damaged/, name);
    }
  });
});

describe('withBlock', () => {
  it('writes just the block into a new file', () => {
    assert.equal(withBlock('', BLOCK), `${BLOCK}\n`);
  });

  it('adds the block after the user\'s lines, separated by one blank line', () => {
    assert.equal(withBlock('.env\n', BLOCK), `.env\n\n${BLOCK}\n`);
    assert.equal(withBlock('.env', BLOCK), `.env\n\n${BLOCK}\n`);
    assert.equal(withBlock('.env\n\n', BLOCK), `.env\n\n\n${BLOCK}\n`);
  });

  it('uses the line breaks the file uses', () => {
    assert.equal(withBlock(crlf('.env\n'), BLOCK), `${crlf(`.env\n\n${BLOCK}`)}\r\n`);
    assert.equal(withBlock('.env\n', BLOCK).includes('\r'), false);
  });

  it('keeps the line breaks of a block that is replaced, even in a file that mixes them', () => {
    const next = buildBlock(['.claude']);
    assert.equal(withBlock(`a\r\n${crlf(BLOCK)}\r\nb\n`, next), `a\r\n${crlf(next)}\r\nb\n`);
    assert.equal(withBlock(`a\r\n${BLOCK}\nb\r\n`, next), `a\r\n${next}\nb\r\n`);
  });

  it('replaces the block where it is and leaves every other byte alone', () => {
    const mixed = `.env\r\n\n# mine\n${BLOCK}\n\r\nlogs/\r\n`;
    const next = buildBlock(['.claude', '.codex', '.kimi-code']);
    const updated = withBlock(mixed, next);
    assert.equal(updated, `.env\r\n\n# mine\n${next}\n\r\nlogs/\r\n`);
    assert.equal(findBlock(updated).found.text, next);
  });

  it('is idempotent', () => {
    for (const text of ['', '.env\n', crlf('.env\n.log\n')]) {
      const once = withBlock(text, BLOCK);
      assert.equal(withBlock(once, BLOCK), once, JSON.stringify(text));
    }
  });

  it('refuses a file whose markers are damaged, with a fix', () => {
    assert.throws(
      () => withBlock(`${BEGIN}\n`, BLOCK),
      (error) => error instanceof CodedError && error.code === 'kiroignore-damaged' && /\.kiroignore: the ECC marker lines are damaged/.test(error.message) && /Fix the two marker lines/.test(error.fix),
    );
  });
});

describe('withoutBlock', () => {
  it('returns a file without a block as it is', () => {
    for (const text of ['', '.env\n', 'no newline at the end']) assert.equal(withoutBlock(text), text);
  });

  it('undoes withBlock exactly, for the files people have', () => {
    const texts = ['', '.env\n', '.env\n\n', '\n', '.env\n.log\n\n\nbuild/\n', crlf('.env\n.log\n'), crlf('\n.env\n\n'), '# only a comment\n'];
    for (const text of texts) assert.equal(withoutBlock(withBlock(text, BLOCK)), text, JSON.stringify(text));
  });

  it('adds the missing final newline of the user\'s last line, and nothing else', () => {
    assert.equal(withoutBlock(withBlock('.env', BLOCK)), '.env\n');
  });

  it('keeps what the user put before and after the block', () => {
    assert.equal(withoutBlock(`a\n\n${BLOCK}\nb\n`), 'a\nb\n');
    assert.equal(withoutBlock(`${BLOCK}\nb\n`), 'b\n');
    assert.equal(withoutBlock(`a\n${BLOCK}\n`), 'a\n');
  });

  it('removes a block the user edited, whatever it holds', () => {
    assert.equal(withoutBlock(`a\n\n${BEGIN}\nmy-extra/\n${END}\n`), 'a\n');
  });

  it('leaves the user\'s own line endings alone', () => {
    assert.equal(withoutBlock(`a\r\nb\n\n${BLOCK}\nc\r\n`), 'a\r\nb\nc\r\n');
  });

  it('refuses a file whose markers are damaged', () => {
    assert.throws(() => withoutBlock(`${END}\n`), (error) => error instanceof CodedError && error.code === 'kiroignore-damaged');
  });
});
