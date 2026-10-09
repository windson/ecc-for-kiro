// Where the wizard finds its own script: the project first, then $KIRO_HOME or ~/.kiro/skills,
// then the installed Power location. The order is fixed, and $KIRO_HOME wins over the home default.

import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';

import { SKILL_NAME } from '../skills/ecc-kiro-setup/scripts/lib/constants.mjs';
import { locateScript, scriptSearchPaths } from '../skills/ecc-kiro-setup/scripts/lib/locate-script.mjs';

const SCRIPT = `scripts/ecc-kiro.mjs`;
const project = (root) => path.join(root, '.kiro', 'skills', SKILL_NAME, SCRIPT);
const global = (home) => path.join(home, 'skills', SKILL_NAME, SCRIPT);
const power = (home) => path.join(home, 'powers', 'installed', SKILL_NAME, 'skills', SKILL_NAME, SCRIPT);

/** A predicate over a fixed set of existing files. */
const existsIn = (present) => (candidate) => present.includes(candidate);

describe('scriptSearchPaths', () => {
  it('lists the project, the global skill and the power, in that order', () => {
    const paths = scriptSearchPaths({ root: '/work/project', homedir: '/home/me', env: {} });
    assert.deepEqual(paths.map((entry) => entry.origin), ['project', 'global', 'power']);
    assert.deepEqual(paths.map((entry) => entry.path), [
      project('/work/project'),
      global('/home/me/.kiro'),
      power('/home/me/.kiro'),
    ]);
  });

  it('uses $KIRO_HOME for the global and power paths when it is set', () => {
    const paths = scriptSearchPaths({ root: '/work/project', homedir: '/home/me', env: { KIRO_HOME: '/opt/kiro' } });
    assert.deepEqual(paths.map((entry) => entry.path), [
      project('/work/project'),
      global('/opt/kiro'),
      power('/opt/kiro'),
    ]);
  });
});

describe('locateScript', () => {
  const base = { root: '/work/project', homedir: '/home/me', env: {} };

  it('returns the project copy when it exists, even if the others do too', () => {
    const found = locateScript({ ...base, exists: existsIn([project('/work/project'), global('/home/me/.kiro'), power('/home/me/.kiro')]) });
    assert.equal(found.origin, 'project');
    assert.equal(found.path, project('/work/project'));
  });

  it('falls back to the global copy when the project has none', () => {
    const found = locateScript({ ...base, exists: existsIn([global('/home/me/.kiro'), power('/home/me/.kiro')]) });
    assert.equal(found.origin, 'global');
    assert.equal(found.path, global('/home/me/.kiro'));
  });

  it('falls back to the power when neither the project nor the global copy has it', () => {
    const found = locateScript({ ...base, exists: existsIn([power('/home/me/.kiro')]) });
    assert.equal(found.origin, 'power');
    assert.equal(found.path, power('/home/me/.kiro'));
  });

  it('prefers the $KIRO_HOME global copy over the home-default power', () => {
    const env = { KIRO_HOME: '/opt/kiro' };
    const found = locateScript({ ...base, env, exists: existsIn([global('/opt/kiro'), power('/home/me/.kiro')]) });
    assert.equal(found.origin, 'global');
    assert.equal(found.path, global('/opt/kiro'));
  });

  it('reports every place it searched when the script is nowhere', () => {
    const found = locateScript({ ...base, exists: () => false });
    assert.equal(found.found, false);
    assert.equal(found.path, null);
    assert.equal(found.origin, null);
    assert.deepEqual(found.searched.map((entry) => entry.origin), ['project', 'global', 'power']);
  });

  it('marks the result found when a script was located', () => {
    const found = locateScript({ ...base, exists: existsIn([project('/work/project')]) });
    assert.equal(found.found, true);
    assert.equal(found.searched.length, 3);
  });
});
