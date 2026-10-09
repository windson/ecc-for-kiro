import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseFrontmatter } from '../skills/ecc-kiro-setup/scripts/lib/frontmatter.mjs';
import { DESCRIPTION_MAX, patchSkillMarkdown, trimDescription, validateSkillMarkdown } from '../skills/ecc-kiro-setup/scripts/lib/skills.mjs';

const sentence = (n) => `Sentence number ${n} says something useful about the skill and when to use it.`;
const longDescription = (count) => Array.from({ length: count }, (_, i) => sentence(i + 1)).join(' ');

describe('trimDescription', () => {
  it('leaves a description that fits exactly as it is (apart from surrounding space)', () => {
    assert.equal(trimDescription('Short. Use when asked.'), 'Short. Use when asked.');
    assert.equal(trimDescription('  padded  '), 'padded');
    const exact = 'a'.repeat(DESCRIPTION_MAX);
    assert.equal(trimDescription(exact), exact);
  });

  it('cuts at the last sentence end that fits, keeping its full stop', () => {
    const trimmed = trimDescription(longDescription(30));
    assert.ok(trimmed.length <= DESCRIPTION_MAX);
    assert.ok(trimmed.length > DESCRIPTION_MAX - 100, 'keeps as much as fits');
    assert.match(trimmed, /\.$/);
    assert.ok(longDescription(30).startsWith(trimmed));
    assert.match(trimmed, /Sentence number \d+ says something useful about the skill and when to use it\.$/, 'ends on a whole sentence');
  });

  it('understands sentences that end in ! or ?', () => {
    const question = `${'word '.repeat(150)}really? ${'other '.repeat(200)}`;
    assert.ok(trimDescription(question).endsWith('really?'));
    const shout = `${'word '.repeat(150)}stop! ${'other '.repeat(200)}`;
    assert.ok(trimDescription(shout).endsWith('stop!'));
  });

  it('cuts at a word when the only early sentence end would throw away most of the text', () => {
    const text = `Tiny. ${'longword '.repeat(200)}`;
    const trimmed = trimDescription(text);
    assert.ok(trimmed.length <= DESCRIPTION_MAX);
    assert.ok(trimmed.length > 900);
    assert.match(trimmed, /longword$/);
  });

  it('cuts a single huge word at the limit', () => {
    assert.equal(trimDescription('x'.repeat(DESCRIPTION_MAX + 50)).length, DESCRIPTION_MAX);
  });
});

describe('patchSkillMarkdown', () => {
  const skill = (descriptionLine, { eol = '\n', extra = [], body = `${eol}# Body${eol}keep ${eol}this\t exactly${eol}` } = {}) =>
    ['---', 'name: demo-skill', descriptionLine, ...extra, '---'].join(eol) + eol + body;
  const options = { dirName: 'demo-skill' };

  it('does nothing for a skill that is valid', () => {
    assert.equal(patchSkillMarkdown(skill('description: Fine. Use when asked.'), options), null);
  });

  it('shortens an overlong one-line description and changes nothing else', () => {
    const text = skill(`description: ${JSON.stringify(longDescription(30))}`, { extra: ['license: MIT', 'metadata:', '  origin: ECC'] });
    const patched = patchSkillMarkdown(text, options);
    assert.ok(patched);
    assert.equal(patched.patches.length, 1);
    assert.equal(patched.patches[0].field, 'description');
    assert.equal(patched.patches[0].code, 'description-length');
    assert.equal(patched.patches[0].before, longDescription(30));
    assert.ok(patched.patches[0].after.length <= DESCRIPTION_MAX);

    assert.equal(validateSkillMarkdown(patched.text, options).ok, true);
    const before = text.split('\n');
    const after = patched.text.split('\n');
    assert.equal(after.length, before.length);
    assert.deepEqual(after.filter((_, i) => i !== 2), before.filter((_, i) => i !== 2), 'only the description line differs');
    assert.equal(parseFrontmatter(patched.text).data.description, patched.patches[0].after);
  });

  it('replaces a multi-line description and keeps the lines after it', () => {
    const folded = `description: >-\n${longDescription(30).split('. ').map((part) => `  ${part}`).join('.\n')}`;
    const text = skill(folded, { extra: ['license: MIT'] });
    const patched = patchSkillMarkdown(text, options);
    assert.ok(patched, 'a folded description can be repaired too');
    const data = parseFrontmatter(patched.text).data;
    assert.equal(data.license, 'MIT');
    assert.ok(data.description.length <= DESCRIPTION_MAX);
    assert.equal(patched.text.endsWith('# Body\nkeep \nthis\t exactly\n'), true);
    assert.equal(validateSkillMarkdown(patched.text, options).ok, true);
  });

  it('keeps CRLF line endings and a byte order mark', () => {
    const text = `\uFEFF${skill(`description: ${JSON.stringify(longDescription(30))}`, { eol: '\r\n' })}`;
    const patched = patchSkillMarkdown(text, options);
    assert.ok(patched);
    assert.ok(patched.text.startsWith('\uFEFF---\r\n'));
    assert.doesNotMatch(patched.text.replace(/\r\n/g, ''), /\n/);
    assert.ok(patched.text.endsWith('# Body\r\nkeep \r\nthis\t exactly\r\n'));
  });

  it('refuses to guess when something other than the description is wrong', () => {
    const tooLong = `description: ${JSON.stringify(longDescription(30))}`;
    assert.equal(patchSkillMarkdown(skill(tooLong), { dirName: 'other-name' }), null, 'name does not match the folder');
    assert.equal(patchSkillMarkdown('---\nname: demo-skill\n---\nbody\n', options), null, 'description missing');
    assert.equal(patchSkillMarkdown('no frontmatter at all\n', options), null);
    assert.equal(patchSkillMarkdown('---\nname: demo-skill\nname: twice\n---\n', options), null);
  });
});
