// The owned part against the real profile and the scripts that ship in the skill: every agent the orch-review
// recipe names exists in the install, the instinct hook points at a script the skills part installs, and the
// hookify and instinct hooks do not clash with the 12 hooks of ECC's adapter.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { defaultProfilePath } from '../skills/ecc-kiro-setup/scripts/lib/commands/verify.mjs';
import { OBSERVE_SCRIPT, orchReviewRecipe, workflowAgents } from '../skills/ecc-kiro-setup/scripts/lib/owned.mjs';
import { buildPlanned } from '../skills/ecc-kiro-setup/scripts/lib/plan.mjs';
import { BUNDLED_WORKFLOW_AGENTS } from '../skills/ecc-kiro-setup/scripts/lib/workflow-schema.mjs';
import { shippedOwnedAssets } from './hook-assets.mjs';

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'ecc-kiro-setup');
const profile = JSON.parse(readFileSync(defaultProfilePath(SKILL_DIR), 'utf8'));

describe('the owned part on the real profile', () => {
  const built = buildPlanned({ parts: ['owned'], profile, sourceFiles: new Map(), ownedAssets: shippedOwnedAssets() });

  it('plans 9 files without a problem, and needs no ECC source', () => {
    assert.deepEqual(built.problems, []);
    assert.equal(built.planned.length, 9);
    assert.deepEqual(built.details.owned.missingAgents, []);
    assert.ok(!built.notes.some((note) => note.code === 'owned-workflow-agents'));
  });
  it('names in the recipe only agents that the install has: ECC agents of the profile, the panel, or the ones Kiro bundles', () => {
    const agents = new Set(profile.entries.filter((entry) => entry.category === 'agent').map((entry) => entry.name));
    const named = [...new Set(workflowAgents(orchReviewRecipe()))];
    for (const name of named) assert.ok(agents.has(name) || BUNDLED_WORKFLOW_AGENTS.includes(name), name);
    assert.ok(agents.has('code-reviewer') && agents.has('security-reviewer'));
  });
  it('points the instinct hooks at observe.sh, which the skills part installs', () => {
    const skillFiles = profile.entries.filter((entry) => entry.category === 'skill').map((entry) => `.kiro/skills/${entry.skill}/${entry.rel}`);
    assert.ok(skillFiles.includes(OBSERVE_SCRIPT));
    for (const rel of ['scripts/detect-project.sh', 'scripts/lib/homunculus-dir.sh', 'scripts/instinct-cli.py']) {
      assert.ok(skillFiles.includes(`.kiro/skills/continuous-learning-v2/${rel}`), rel);
    }
  });
  it('writes hook files whose names differ from the 12 converted hooks, so none is overwritten', () => {
    const adapter = new Set(profile.entries.filter((entry) => entry.category === 'adapter-hook').map((entry) => `.kiro/hooks/ecc-${entry.name}.json`));
    for (const file of built.planned.filter((item) => item.category === 'owned-hook')) assert.ok(!adapter.has(file.dest), file.dest);
  });
});
