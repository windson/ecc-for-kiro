// The files that carry ECC's license and credits into a project: .kiro/ecc/LICENSE (ECC's own file,
// copied) and .kiro/ecc/THIRD_PARTY_NOTICES.md (written here). Both are owned by the installer.
//
// Pure. The credits below were read from the projects' own repositories on 2026-10-07 and are the
// ones the installed ECC files name. ECC does not ship their notices.

import { ECC_COMMIT, ECC_REPO_URL, ECC_TAG, SKILL_NAME, SKILL_VERSION } from './constants.mjs';

export const LICENSE_CATEGORY = 'license';
export const LICENSE_DEST = '.kiro/ecc/LICENSE';
export const NOTICES_DEST = '.kiro/ecc/THIRD_PARTY_NOTICES.md';

/** Projects whose work the installed ECC files adapt, with the holder and where ECC credits them. */
const CREDITS = Object.freeze([
  { project: 'Supabase Agent Skills', url: 'https://github.com/supabase/agent-skills', holder: 'Copyright (c) 2026 Supabase', where: 'the database-reviewer agent' },
  { project: 'PRPs-agentic-eng, by Wirasm', url: 'https://github.com/Wirasm/prp', holder: 'Copyright (c) 2025-2026 Rasmus Widing', where: 'the code-review, prp-commit, prp-implement, prp-plan, prp-pr and prp-prd commands' },
  { project: 'Plankton, by alxfazio', url: 'https://github.com/alexfazio/plankton', holder: 'Copyright (c) 2025 Alessandro Fazio', where: 'the plankton-code-quality skill' },
  { project: 'context-keeper, by sreedhargs89', url: 'https://github.com/sreedhargs89/context-keeper', holder: 'Copyright (c) 2026 Sreedhar GS', where: 'the ck skill' },
]);

/**
 * The text of THIRD_PARTY_NOTICES.md.
 * @param {{ licenseSha256: string }} input sha256 of the ECC LICENSE file that is installed next to it
 */
export function buildNotices({ licenseSha256 }) {
  const repo = ECC_REPO_URL.replace(/\.git$/, '');
  const lines = [
    '# Third-party notices',
    '',
    `${SKILL_NAME} ${SKILL_VERSION} made the ECC files in this project on this machine. It downloaded ECC ${ECC_TAG} from github.com and converted it for Kiro. It is an independent community tool. It is not affiliated with, endorsed by, or sponsored by Amazon Web Services, Amazon.com, Inc., the Kiro team, or the authors of ECC.`,
    '',
    '## ECC',
    '',
    `- Project: ECC, by Affaan Mustafa and contributors (${repo}).`,
    '- License: MIT, Copyright (c) 2026 Affaan Mustafa. The full text is in the LICENSE file next to this one.',
    `- Release: ${ECC_TAG}, commit ${ECC_COMMIT}.`,
    `- sha256 of that LICENSE file: ${licenseSha256}.`,
    '',
    '## Credits inside ECC files',
    '',
    'These projects are credited in the ECC files that were installed. ECC does not ship their notices, so they are listed here. Each one is MIT licensed.',
    '',
    ...CREDITS.map((credit) => `- ${credit.project} (${credit.url}), ${credit.holder}. Adapted in ${credit.where}.`),
    '',
    'Other ECC files credit community contributors by name in the file itself, or name a project as inspiration without using its code. The credit lines stay in the files as ECC wrote them.',
    '',
    '## Services',
    '',
    'Some ECC skills, and the servers in mcp.json.example, describe third-party packages and hosted services. They have their own terms. Nothing in this project grants rights to them.',
    '',
    '## Trademarks',
    '',
    'Kiro is a trademark of Amazon.com, Inc. or its affiliates. Claude is a trademark of Anthropic, PBC. All other names belong to their owners.',
  ];
  return `${lines.join('\n')}\n`;
}
