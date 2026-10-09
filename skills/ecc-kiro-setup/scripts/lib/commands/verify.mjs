import path from 'node:path';

import { ECC_TAG, ECC_VERSION, PROFILE_ID } from '../constants.mjs';
import { CodedError, EXIT } from '../exit.mjs';
import { resolveCacheRoot } from '../paths.mjs';
import { validateProfile } from '../profile.mjs';
import { readTextIfExists } from '../../io/files.mjs';
import { ensurePaths, hashPaths, openSource } from '../../io/source.mjs';

export const VERIFY_SCHEMA = 'ecc-kiro.verify.v1';

/** The profile that ships inside this skill. */
export const defaultProfilePath = (skillDir) => path.join(skillDir, 'assets', 'profiles', `${PROFILE_ID}-v${ECC_VERSION}.json`);

/** Read and parse a profile file. Validation is a separate step. */
export async function loadProfile({ file, fs }) {
  const text = await readTextIfExists(fs, file);
  if (text === null) throw new CodedError('profile-missing', `profile not found: ${file}`);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new CodedError('profile-unreadable', `profile is not valid JSON: ${file} (${error.message})`);
  }
}

/**
 * Compare computed hashes with a profile.
 * @param {{ entries: { path: string, sha256: string }[] }} profile
 * @param {Map<string, string>} hashes
 */
export function compareToProfile(profile, hashes) {
  const missing = [];
  const mismatched = [];
  for (const entry of profile.entries) {
    const actual = hashes.get(entry.path);
    if (actual === undefined) missing.push(entry.path);
    else if (actual !== entry.sha256) mismatched.push({ path: entry.path, expected: entry.sha256, actual });
  }
  return { missing, mismatched };
}

export function formatVerify(report) {
  const lines = [`ecc-kiro-setup verify (profile ${report.profile.id}, ECC ${ECC_TAG})`, ''];
  const row = (label, value) => lines.push(`  ${label.padEnd(10)}${value}`);
  if (report.source) {
    const pin = report.source.commitVerified ? `commit ${report.source.commit.slice(0, 7)} matches the pin` : 'no .git directory, so only file hashes are checked';
    row('Source', `${report.source.dir}  (${report.source.origin}; ${pin})`);
  }
  row('Profile', `${report.profile.file}`);
  if (report.checked > 0) {
    row('Checked', `${report.checked} files`);
    const counts = Object.entries(report.counts ?? {}).filter(([key, value]) => value > 0 && key !== 'skillDirs');
    lines.push(`  ${counts.map(([key, value]) => `${key} ${value}`).join(', ')}; ${report.counts.skillDirs} skill folders`);
  }
  if (report.fetched > 0) row('Fetched', `${report.fetched} files downloaded`);
  for (const item of report.problems) lines.push(`  problem   ${item.code}: ${item.message}`);
  for (const path_ of report.missing.slice(0, 20)) lines.push(`  missing   ${path_}`);
  if (report.missing.length > 20) lines.push(`  ...and ${report.missing.length - 20} more missing`);
  for (const item of report.mismatched.slice(0, 20)) lines.push(`  changed   ${item.path}`);
  if (report.mismatched.length > 20) lines.push(`  ...and ${report.mismatched.length - 20} more changed`);
  if (report.missing.length > 0 && !report.fetchTried) lines.push('', '  Run again with --fetch to download the missing files.');
  lines.push('', report.ok ? `Result: all ${report.checked} files match their recorded hashes` : 'Result: verification failed');
  return `${lines.join('\n')}\n`;
}

export const verifyCommand = {
  summary: 'check the ECC source against the pinned commit and recorded file hashes',
  options: ['json', 'source', 'fetch', 'profile'],
  async run({ options, stdout, probes, skillDir, services, log }) {
    const file = path.resolve(options.profile ?? defaultProfilePath(skillDir));
    const profile = await loadProfile({ file, fs: services.fs });
    const profileInfo = { id: typeof profile?.id === 'string' ? profile.id : null, file };

    const finish = (report) => {
      stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : formatVerify(report));
      return report.ok ? EXIT.OK : EXIT.FAILED;
    };

    const problems = validateProfile(profile);
    if (problems.length > 0) {
      return finish({ schema: VERIFY_SCHEMA, ok: false, profile: profileInfo, source: null, checked: 0, counts: null, fetched: 0, fetchTried: false, missing: [], mismatched: [], problems });
    }

    const source = await openSource({
      sourceDir: options.source,
      cacheRoot: resolveCacheRoot(probes.env ?? {}, probes.homedir),
      fetch: Boolean(options.fetch),
      git: services.git,
      log,
      fs: services.fs,
    });
    const paths = profile.entries.map((entry) => entry.path);

    let fetched = 0;
    const fetchTried = Boolean(options.fetch) && source.origin !== 'local';
    if (fetchTried) {
      fetched = (await ensurePaths({ source, paths, git: services.git, log, fs: services.fs })).fetched;
    }

    const { hashes } = await hashPaths({ dir: source.dir, paths, fs: services.fs });
    const { missing, mismatched } = compareToProfile(profile, hashes);
    return finish({
      schema: VERIFY_SCHEMA,
      ok: missing.length === 0 && mismatched.length === 0,
      profile: { ...profileInfo, version: profile.source.version },
      source,
      checked: paths.length,
      counts: profile.counts,
      fetched,
      fetchTried,
      missing,
      mismatched,
      problems: [],
    });
  },
};
