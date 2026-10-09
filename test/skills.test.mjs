import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { SKILL_NAME, SKILL_VERSION } from '../skills/ecc-kiro-setup/scripts/lib/constants.mjs';
import { parseFrontmatter } from '../skills/ecc-kiro-setup/scripts/lib/frontmatter.mjs';
import {
  BODY_LINES_RECOMMENDED,
  COMPATIBILITY_MAX,
  DESCRIPTION_MAX,
  NAME_MAX,
  validateSkillMarkdown,
} from '../skills/ecc-kiro-setup/scripts/lib/skills.mjs';

const skill = (lines, body = '\n# Body\n') => `---\n${lines.join('\n')}\n---\n${body}`;
const base = ['name: demo-skill', 'description: Does a thing. Use when asked.'];
const codes = (list) => list.map((item) => item.code);
const check = (lines, options = { dirName: 'demo-skill' }, body) => validateSkillMarkdown(skill(lines, body), options);

describe('validateSkillMarkdown: accepting valid skills', () => {
  it('accepts a minimal skill and returns its name and description', () => {
    const result = check(base);
    assert.equal(result.ok, true);
    assert.equal(result.name, 'demo-skill');
    assert.equal(result.description, 'Does a thing. Use when asked.');
    assert.deepEqual(result.errors, []);
  });

  it('accepts optional fields that follow the specification', () => {
    const result = check([
      ...base,
      'license: MIT',
      'compatibility: Needs git and network access',
      'allowed-tools: Read Grep',
      'metadata:',
      '  origin: ECC',
      '  version: "1.0"',
    ]);
    assert.equal(result.ok, true);
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(result.info.extraFields, []);
  });

  it('accepts a folded description', () => {
    const result = check(['name: demo-skill', 'description: >-', '  First sentence.', '  Second sentence.']);
    assert.equal(result.ok, true);
    assert.equal(result.description, 'First sentence. Second sentence.');
  });

  it('accepts names at the length limit and names made of digits', () => {
    assert.equal(validateSkillMarkdown(skill([`name: ${'a'.repeat(NAME_MAX)}`, base[1]])).ok, true);
    assert.equal(validateSkillMarkdown(skill(['name: 3d-print', base[1]])).ok, true);
  });

  it('accepts a description of exactly the maximum length', () => {
    const result = check(['name: demo-skill', `description: "${'x'.repeat(DESCRIPTION_MAX)}"`]);
    assert.equal(result.ok, true);
  });

  it('skips the directory check when no directory name is given', () => {
    assert.equal(validateSkillMarkdown(skill(['name: other-name', base[1]])).ok, true);
  });
});

describe('validateSkillMarkdown: name rules', () => {
  const nameCodes = (nameLine, options) => codes(check([nameLine, base[1]], options).errors);

  it('requires a name', () => {
    assert.deepEqual(codes(check([base[1]]).errors), ['name-missing']);
    assert.deepEqual(nameCodes('name:'), ['name-missing']);
  });

  it('requires a string name', () => {
    assert.deepEqual(nameCodes('name: 42'), ['name-type']);
    assert.deepEqual(nameCodes('name: [a, b]'), ['name-type']);
  });

  it('rejects empty and overlong names', () => {
    assert.ok(nameCodes('name: ""', { dirName: 'demo-skill' }).includes('name-length'));
    assert.ok(nameCodes(`name: ${'a'.repeat(NAME_MAX + 1)}`, {}).includes('name-length'));
  });

  it('rejects characters outside a-z, 0-9 and hyphen', () => {
    assert.ok(nameCodes('name: Demo-Skill', {}).includes('name-charset'));
    assert.ok(nameCodes('name: demo_skill', {}).includes('name-charset'));
    assert.ok(nameCodes('name: démo', {}).includes('name-charset'));
    assert.ok(nameCodes('name: demo skill', {}).includes('name-charset'));
  });

  it('rejects leading, trailing and double hyphens', () => {
    assert.ok(nameCodes('name: -demo', {}).includes('name-hyphen-edge'));
    assert.ok(nameCodes('name: demo-', {}).includes('name-hyphen-edge'));
    assert.ok(nameCodes('name: de--mo', {}).includes('name-double-hyphen'));
  });

  it('requires the name to match the directory', () => {
    assert.deepEqual(nameCodes('name: demo-skill', { dirName: 'other' }), ['name-dir-mismatch']);
  });
});

describe('validateSkillMarkdown: description rules', () => {
  const descCodes = (line) => codes(check(['name: demo-skill', line]).errors);

  it('requires a description', () => {
    assert.deepEqual(codes(check(['name: demo-skill']).errors), ['description-missing']);
  });

  it('requires a string description', () => {
    assert.deepEqual(descCodes('description: 12'), ['description-type']);
    assert.deepEqual(descCodes('description: [a]'), ['description-type']);
  });

  it('rejects empty descriptions', () => {
    assert.deepEqual(descCodes('description: ""'), ['description-empty']);
    assert.deepEqual(descCodes('description: "   "'), ['description-empty']);
  });

  it('rejects descriptions over the limit', () => {
    assert.deepEqual(descCodes(`description: "${'x'.repeat(DESCRIPTION_MAX + 1)}"`), ['description-length']);
  });
});

describe('validateSkillMarkdown: optional fields', () => {
  it('rejects a non-string or out-of-range compatibility', () => {
    assert.deepEqual(codes(check([...base, 'compatibility: 3']).errors), ['compatibility-type']);
    assert.deepEqual(codes(check([...base, 'compatibility: ""']).errors), ['compatibility-length']);
    assert.deepEqual(codes(check([...base, `compatibility: "${'c'.repeat(COMPATIBILITY_MAX + 1)}"`]).errors), ['compatibility-length']);
  });

  it('rejects metadata that is not a map and warns about non-string values', () => {
    assert.deepEqual(codes(check([...base, 'metadata: plain']).errors), ['metadata-type']);
    assert.deepEqual(codes(check([...base, 'metadata: [a]']).errors), ['metadata-type']);
    const warned = check([...base, 'metadata:', '  version: 1.5', '  flag: true', '  origin: ECC']);
    assert.equal(warned.ok, true);
    assert.deepEqual(codes(warned.warnings), ['metadata-value-type']);
    assert.match(warned.warnings[0].message, /version, flag/);
  });

  it('warns about a non-string license or allowed-tools', () => {
    const result = check([...base, 'license: [MIT]', 'allowed-tools: [Read]']);
    assert.equal(result.ok, true);
    assert.deepEqual(codes(result.warnings), ['license-type', 'allowed-tools-type']);
  });

  it('reports fields outside the specification, sorted, without failing', () => {
    const result = check([...base, 'tools: Read, Grep', 'argument-hint: <file>', 'origin: ECC']);
    assert.equal(result.ok, true);
    assert.deepEqual(result.info.extraFields, ['argument-hint', 'origin', 'tools']);
  });
});

describe('validateSkillMarkdown: body and frontmatter problems', () => {
  it('warns when the body exceeds the recommended length', () => {
    const long = `${'line\n'.repeat(BODY_LINES_RECOMMENDED + 1)}`;
    const over = check(base, undefined, long);
    assert.deepEqual(codes(over.warnings), ['body-long']);
    assert.equal(over.info.bodyLines, BODY_LINES_RECOMMENDED + 1);
    const atLimit = check(base, undefined, 'line\n'.repeat(BODY_LINES_RECOMMENDED));
    assert.deepEqual(atLimit.warnings, []);
  });

  it('reports an empty body as zero lines', () => {
    assert.equal(check(base, undefined, '').info.bodyLines, 0);
  });

  it('reports missing frontmatter', () => {
    const result = validateSkillMarkdown('# Just a title\n');
    assert.equal(result.ok, false);
    assert.deepEqual(codes(result.errors), ['frontmatter-missing']);
  });

  it('reports unparseable frontmatter with the line number', () => {
    const result = validateSkillMarkdown('---\nname: ok\ndescription: one: two\n---\n');
    assert.equal(result.ok, false);
    assert.deepEqual(codes(result.errors), ['frontmatter-unparseable']);
    assert.match(result.errors[0].message, /line 3/);
  });

  it('reports an unterminated frontmatter block', () => {
    assert.deepEqual(codes(validateSkillMarkdown('---\nname: x\n').errors), ['frontmatter-unparseable']);
  });

  it('collects several errors at once', () => {
    const result = check(['name: Bad_Name', 'description: ""'], { dirName: 'other' });
    assert.deepEqual(codes(result.errors), ['name-charset', 'name-dir-mismatch', 'description-empty']);
  });
});

describe('this skill', () => {
  const text = readFileSync(new URL('../skills/ecc-kiro-setup/SKILL.md', import.meta.url), 'utf8');

  it('has a SKILL.md that passes validation under its own directory name', () => {
    const result = validateSkillMarkdown(text, { dirName: SKILL_NAME });
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, []);
    assert.equal(result.name, SKILL_NAME);
  });

  it('keeps the version in SKILL.md equal to the version in constants.mjs', () => {
    assert.equal(parseFrontmatter(text).data.metadata.version, SKILL_VERSION);
  });
});
