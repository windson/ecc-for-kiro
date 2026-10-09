import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import nodeFs from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { readTextIfExists, tempName, writeFileAtomic, writeTextAtomic } from '../skills/ecc-kiro-setup/scripts/io/files.mjs';
import { makeTempDir } from './fixtures.mjs';

describe('tempName', () => {
  it('returns a sibling path of the target, keeping the directory', () => {
    const name = tempName('/root/dir/file.md');
    assert.equal(path.dirname(name), path.join('/root', 'dir'));
    assert.match(path.basename(name), /^file\.md\./);
    assert.ok(name.endsWith('.tmp'), name);
  });

  it('is unique across calls even within the same millisecond (no clock-resolution collision)', () => {
    // The old implementation keyed the temp name on pid + Date.now(), so two
    // calls in the same millisecond produced the same name. Freeze the clock to
    // prove the name no longer depends on wall-clock resolution.
    const names = new Set();
    const frozen = Date.now;
    try {
      Date.now = () => 1_700_000_000_000; // constant: same "millisecond" every call
      for (let i = 0; i < 1000; i += 1) names.add(tempName('/root/file.md'));
    } finally {
      Date.now = frozen;
    }
    assert.equal(names.size, 1000, 'every temp name must be distinct');
  });
});

describe('writeFileAtomic', () => {
  let tmp;
  before(async () => {
    tmp = await makeTempDir('ecc-kiro-files-');
  });
  after(() => tmp.cleanup());

  it('writes text and creates missing parent directories', async () => {
    const file = path.join(tmp.dir, 'a', 'b', 'note.md');
    await writeTextAtomic(nodeFs, file, 'hello');
    assert.equal(await readFile(file, 'utf8'), 'hello');
  });

  it('applies the requested mode and leaves no temp sibling behind', async () => {
    const file = path.join(tmp.dir, 'script.sh');
    await writeFileAtomic(nodeFs, file, '#!/bin/sh\n', { mode: 0o755 });
    assert.equal((await stat(file)).mode & 0o777, 0o755);
    const siblings = await nodeFs.readdir(tmp.dir);
    assert.ok(!siblings.some((n) => n.includes('.tmp')), `no temp files left: ${siblings.join(', ')}`);
  });

  it('two sequential writes to the same target both succeed', async () => {
    const file = path.join(tmp.dir, 'twice.txt');
    await writeTextAtomic(nodeFs, file, 'first');
    await writeTextAtomic(nodeFs, file, 'second');
    assert.equal(await readFile(file, 'utf8'), 'second');
  });
});

describe('readTextIfExists', () => {
  let tmp;
  before(async () => {
    tmp = await makeTempDir('ecc-kiro-files-read-');
  });
  after(() => tmp.cleanup());

  it('returns null for a missing file and the text for one that exists', async () => {
    assert.equal(await readTextIfExists(nodeFs, path.join(tmp.dir, 'nope')), null);
    const file = path.join(tmp.dir, 'there.txt');
    await writeTextAtomic(nodeFs, file, 'content');
    assert.equal(await readTextIfExists(nodeFs, file), 'content');
  });
});
