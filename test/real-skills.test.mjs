// The 88 real ECC v2.2.3 skills (153 files: the 82 of the Kimi install and the six orch-* extras), planned for Kiro. These tests read the pinned checkout
// in the source cache and are skipped when it is not there (fetch it with: ecc-kiro.mjs verify --fetch).

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { before, describe, it } from 'node:test';

import { defaultProfilePath } from '../skills/ecc-kiro-setup/scripts/lib/commands/verify.mjs';
import { parseFrontmatter } from '../skills/ecc-kiro-setup/scripts/lib/frontmatter.mjs';
import { resolveCacheRoot } from '../skills/ecc-kiro-setup/scripts/lib/paths.mjs';
import { buildPlanned } from '../skills/ecc-kiro-setup/scripts/lib/plan.mjs';
import { validateSkillMarkdown } from '../skills/ecc-kiro-setup/scripts/lib/skills.mjs';
import { cacheCheckoutPath, readVerifiedFiles } from '../skills/ecc-kiro-setup/scripts/io/source.mjs';

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'ecc-kiro-setup');
const checkout = cacheCheckoutPath(resolveCacheRoot(process.env, os.homedir()));
const haveCheckout = existsSync(path.join(checkout, 'skills', 'tdd-workflow', 'SKILL.md'));

/** Slash commands Kiro ships. A skill with one of these names would be shadowed or would shadow them. */
const KIRO_SLASH_COMMANDS = [
  'plan', 'spec', 'guide', 'help', 'clear', 'context', 'model', 'agent', 'tools', 'hooks', 'config', 'compact', 'chat', 'quit',
  'powers', 'settings', 'goal', 'tangent', 'workflow', 'upgrade-agent', 'quick-spec', 'bug-fix', 'architecture-selection',
  'context-gatherer', 'general-task-execution',
];

describe('the real ECC skills', { skip: haveCheckout ? false : 'ECC v2.2.3 is not in the source cache' }, () => {
  let profile;
  let entries;
  let read;
  let built;

  before(async () => {
    profile = JSON.parse(readFileSync(defaultProfilePath(SKILL_DIR), 'utf8'));
    entries = profile.entries.filter((entry) => entry.category === 'skill');
    read = await readVerifiedFiles({ dir: checkout, entries });
    assert.deepEqual(read.missing, []);
    assert.deepEqual(read.mismatched, []);
    built = buildPlanned({ parts: ['skills'], profile, sourceFiles: read.files, sourceExecutable: read.executable });
  });

  it('are 88 skills in 153 files whose bytes match the profile', () => {
    assert.equal(entries.length, 153);
    assert.equal(new Set(entries.map((entry) => entry.skill)).size, 88);
    assert.equal(read.files.size, 153);
  });

  it('include the six orch-* skills as the extras of the profile, each with a reason, and nothing else beyond the Kimi set', () => {
    const orch = ['orch-add-feature', 'orch-build-mvp', 'orch-change-feature', 'orch-fix-defect', 'orch-pipeline', 'orch-refine-code'];
    assert.deepEqual(profile.extras.map((item) => item.path), orch.map((name) => `skills/${name}/SKILL.md`));
    assert.ok(profile.extras.every((item) => item.reason.length > 20));
    assert.deepEqual([...new Set(entries.filter((entry) => entry.path.startsWith('skills/orch-')).map((entry) => entry.skill))].sort(), orch);
    assert.equal(entries.length - profile.extras.length, 147, 'the Kimi set is unchanged');
  });
  it('plan without a single problem, and all 88 are valid under Kiro\'s rules without any repair', () => {
    assert.deepEqual(built.problems, []);
    assert.equal(built.planned.length, 153);
    assert.equal(built.details.skills.total, 88);
    assert.equal(built.details.skills.valid, 88);
    assert.deepEqual(built.details.skills.patched, []);
    assert.deepEqual(built.details.skills.otherWarnings, []);
    assert.equal(built.details.skills.longBodies, 7);
    assert.ok(!built.notes.some((note) => note.code === 'skill-patched'));
  });

  it('copy every file unchanged: each planned file has the hash the profile pins', () => {
    const byPath = new Map(entries.map((entry) => [entry.path, entry]));
    for (const file of built.planned) {
      const entry = byPath.get(file.source);
      assert.ok(entry, file.source);
      assert.equal(file.sha256, entry.sha256, file.dest);
      assert.equal(file.dest, `.kiro/skills/${entry.skill}/${entry.rel}`);
      assert.ok(Buffer.from(file.content).equals(read.files.get(file.source)), file.dest);
    }
    assert.equal(new Set(built.planned.map((file) => file.dest)).size, 153);
  });

  it('keep each SKILL.md\'s name equal to its folder, within Kiro\'s length limits', () => {
    const skillFiles = built.planned.filter((file) => file.dest.endsWith('/SKILL.md'));
    assert.equal(skillFiles.length, 88);
    for (const file of skillFiles) {
      const folder = file.dest.split('/')[2];
      const verdict = validateSkillMarkdown(Buffer.from(file.content).toString('utf8'), { dirName: folder });
      assert.deepEqual(verdict.errors, [], folder);
      assert.equal(parseFrontmatter(Buffer.from(file.content).toString('utf8')).data.name, folder);
    }
  });

  it('do not clash with the slash commands Kiro ships', () => {
    const names = new Set(entries.map((entry) => entry.skill));
    for (const command of KIRO_SLASH_COMMANDS) assert.ok(!names.has(command), command);
  });

  it('carry the execute bit on the scripts that have it in git', () => {
    assert.equal(built.details.skills.executable, 14);
    const executable = built.planned.filter((file) => file.mode !== undefined);
    assert.ok(executable.every((file) => file.mode === 0o755 && /\.(sh|py|js)$/.test(file.dest)), executable.map((file) => file.dest).join(', '));
    assert.ok(executable.some((file) => file.dest === '.kiro/skills/continuous-learning-v2/scripts/instinct-cli.py'));
  });

  it('report the non-standard frontmatter fields as information', () => {
    assert.deepEqual(built.details.skills.extraFields, { 'argument-hint': 2, author: 2, origin: 2, repo: 1, tools: 2 });
    assert.deepEqual(built.notes.map((note) => note.code), ['skill-extra-fields']);
  });

  it('report overlaps with a global skills folder by name', () => {
    const again = buildPlanned({
      parts: ['skills'],
      profile,
      sourceFiles: read.files,
      sourceExecutable: read.executable,
      existing: { globalSkills: new Set(['tdd-workflow', 'not-an-ecc-skill']) },
    });
    assert.deepEqual(again.details.skills.overlapsGlobal, ['tdd-workflow']);
  });
});
