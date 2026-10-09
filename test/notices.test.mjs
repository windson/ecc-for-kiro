import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ECC_COMMIT, ECC_TAG, SKILL_NAME, SKILL_VERSION } from '../skills/ecc-kiro-setup/scripts/lib/constants.mjs';
import { LICENSE_CATEGORY, LICENSE_DEST, NOTICES_DEST, buildNotices } from '../skills/ecc-kiro-setup/scripts/lib/notices.mjs';

const SHA = 'a'.repeat(64);

describe('the license files', () => {
  it('go next to the install state in .kiro/ecc, as one category', () => {
    assert.equal(LICENSE_DEST, '.kiro/ecc/LICENSE');
    assert.equal(NOTICES_DEST, '.kiro/ecc/THIRD_PARTY_NOTICES.md');
    assert.equal(LICENSE_CATEGORY, 'license');
  });
});

describe('buildNotices', () => {
  const text = buildNotices({ licenseSha256: SHA });

  it('names ECC, its holder, its license, the release, the commit and the hash of the LICENSE file beside it', () => {
    assert.match(text, /^# Third-party notices\n/);
    assert.match(text, /- Project: ECC, by Affaan Mustafa and contributors \(https:\/\/github\.com\/affaan-m\/ECC\)\./);
    assert.match(text, /- License: MIT, Copyright \(c\) 2026 Affaan Mustafa\. The full text is in the LICENSE file next to this one\./);
    assert.ok(text.includes(`- Release: ${ECC_TAG}, commit ${ECC_COMMIT}.`));
    assert.ok(text.includes(`- sha256 of that LICENSE file: ${SHA}.`));
    assert.ok(text.includes(`${SKILL_NAME} ${SKILL_VERSION} made the ECC files`));
  });

  it('credits the four projects the installed ECC files adapt, with their holders', () => {
    for (const line of [
      'Supabase Agent Skills (https://github.com/supabase/agent-skills), Copyright (c) 2026 Supabase.',
      'PRPs-agentic-eng, by Wirasm (https://github.com/Wirasm/prp), Copyright (c) 2025-2026 Rasmus Widing.',
      'Plankton, by alxfazio (https://github.com/alexfazio/plankton), Copyright (c) 2025 Alessandro Fazio.',
      'context-keeper, by sreedhargs89 (https://github.com/sreedhargs89/context-keeper), Copyright (c) 2026 Sreedhar GS.',
    ]) {
      assert.ok(text.includes(line), line);
    }
    assert.match(text, /Each one is MIT licensed\./);
  });

  it('says it is independent, that services have their own terms, and who owns the trademarks', () => {
    assert.match(text, /independent community tool\. It is not affiliated with, endorsed by, or sponsored by Amazon Web Services/);
    assert.match(text, /describe third-party packages and hosted services\. They have their own terms\./);
    assert.match(text, /Kiro is a trademark of Amazon\.com, Inc\. or its affiliates\. Claude is a trademark of Anthropic, PBC\./);
  });

  it('changes with the hash and with nothing else, and ends with one newline', () => {
    assert.equal(buildNotices({ licenseSha256: SHA }), text);
    assert.notEqual(buildNotices({ licenseSha256: 'b'.repeat(64) }), text);
    assert.ok(text.endsWith('.\n') && !text.endsWith('\n\n'));
  });

  it('holds no local path, no em dash and no exclamation mark', () => {
    assert.doesNotMatch(text, /\/Users\/|\/home\/|C:\\/);
    assert.equal(text.includes('\u2014'), false);
    assert.equal(text.includes('!'), false);
  });
});
