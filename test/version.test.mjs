import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { atLeast, compareVersions, parseVersion } from '../skills/ecc-kiro-setup/scripts/lib/version.mjs';

describe('parseVersion', () => {
  it('extracts a version from tool output', () => {
    assert.equal(parseVersion('git version 2.42.0'), '2.42.0');
    assert.equal(parseVersion('kiro-cli 2.28.0\n'), '2.28.0');
    assert.equal(parseVersion('v22.22.0'), '22.22.0');
    assert.equal(parseVersion('git version 2.39.3 (Apple Git-145)'), '2.39.3');
  });

  it('fills a missing patch number with zero', () => {
    assert.equal(parseVersion('3.0'), '3.0.0');
  });

  it('returns null when there is no version', () => {
    assert.equal(parseVersion(''), null);
    assert.equal(parseVersion(null), null);
    assert.equal(parseVersion(undefined), null);
    assert.equal(parseVersion('no digits here'), null);
    assert.equal(parseVersion('7'), null);
  });
});

describe('compareVersions and atLeast', () => {
  it('compares numerically, not lexically', () => {
    assert.equal(compareVersions('2.9.0', '2.10.0'), -1);
    assert.equal(compareVersions('2.10.0', '2.9.0'), 1);
    assert.equal(compareVersions('18.0.0', '18.0.0'), 0);
    assert.equal(compareVersions('18.0.1', '18.0.0'), 1);
  });

  it('answers minimum-version questions', () => {
    assert.equal(atLeast('22.22.0', '18.0.0'), true);
    assert.equal(atLeast('2.27.0', '2.27.0'), true);
    assert.equal(atLeast('2.26.9', '2.27.0'), false);
    assert.equal(atLeast('2.28.0', '3.0.0'), false);
    assert.equal(atLeast(null, '1.0.0'), false);
    assert.equal(atLeast('junk', '1.0.0'), false);
  });
});
