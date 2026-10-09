// The final wizard SKILL.md: it validates against the skills rules, its version matches
// constants.mjs, its description names the surfaces and actions so Kiro prefers it over
// configure-ecc for Kiro work, it carries no $ARGUMENTS and no build-status note, and it names
// the steps a wizard needs (doctor, plan --json, confirm once, the --v3 CLI check and the IDE
// panels). The three reference files exist and are short plain prose.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { SKILL_NAME, SKILL_VERSION } from '../skills/ecc-kiro-setup/scripts/lib/constants.mjs';
import { parseFrontmatter } from '../skills/ecc-kiro-setup/scripts/lib/frontmatter.mjs';
import { validateSkillMarkdown } from '../skills/ecc-kiro-setup/scripts/lib/skills.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.resolve(HERE, '..', 'skills', 'ecc-kiro-setup');
const read = (rel) => readFileSync(path.join(SKILL_ROOT, rel), 'utf8');
const SKILL_MD = read('SKILL.md');
const parsed = parseFrontmatter(SKILL_MD);

describe('the wizard SKILL.md', () => {
  it('validates with no errors and no warnings under its own directory name', () => {
    const result = validateSkillMarkdown(SKILL_MD, { dirName: SKILL_NAME });
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, []);
    assert.equal(result.name, SKILL_NAME);
  });

  it('keeps the version equal to constants.mjs', () => {
    assert.equal(parsed.data.metadata.version, SKILL_VERSION);
  });

  it('names both Kiro surfaces, ECC and all three actions in the description, so Kiro prefers it over configure-ecc', () => {
    const description = parsed.data.description;
    for (const term of ['Kiro IDE', 'Kiro CLI', 'ECC', 'install', 'update', 'uninstall', 'configure-ecc']) {
      assert.ok(description.includes(term), `description should mention ${term}`);
    }
  });

  it('carries no $ARGUMENTS placeholder anywhere', () => {
    assert.doesNotMatch(SKILL_MD, /\$ARGUMENTS/);
  });

  it('has no build-status or in-progress note', () => {
    assert.doesNotMatch(SKILL_MD, /build status/i);
    assert.doesNotMatch(SKILL_MD, /in progress/i);
  });

  it('describes the wizard steps a user needs', () => {
    const body = parsed.body;
    assert.match(body, /doctor/);
    assert.match(body, /plan --json/);
    assert.match(body, /--v3/);
    assert.match(body, /kiroAgent\.agentIgnoreFiles/);
    // The script-location precedence names all three places.
    assert.match(body, /\.kiro\/skills\/ecc-kiro-setup\/scripts\/ecc-kiro\.mjs/);
    assert.match(body, /KIRO_HOME/);
    assert.match(body, /powers/);
  });

  it('uses plain prose: no em dashes and no exclamation marks', () => {
    assert.doesNotMatch(parsed.body, /\u2014/);
    assert.doesNotMatch(parsed.body, /!/);
  });

  it('stays short: body within the recommended line count', () => {
    const bodyLines = parsed.body.replace(/\r?\n$/, '').split(/\r?\n/).length;
    assert.ok(bodyLines <= 500, `body has ${bodyLines} lines`);
  });
});

describe('the reference files', () => {
  for (const name of ['mapping.md', 'surfaces.md', 'troubleshooting.md']) {
    it(`${name} exists and is plain prose without em dashes or exclamation marks`, () => {
      const text = read(path.join('references', name));
      assert.ok(text.trim().length > 0, `${name} should not be empty`);
      assert.doesNotMatch(text, /\u2014/, `${name} should have no em dashes`);
      assert.doesNotMatch(text, /!/, `${name} should have no exclamation marks`);
      assert.doesNotMatch(text, /\$ARGUMENTS/, `${name} should have no $ARGUMENTS`);
    });
  }
});
