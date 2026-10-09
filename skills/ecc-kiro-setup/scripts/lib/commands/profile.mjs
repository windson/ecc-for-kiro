import path from 'node:path';

import { ECC_VERSION } from '../constants.mjs';
import { CodedError, EXIT } from '../exit.mjs';
import { isSafeRelativePath, resolveCacheRoot } from '../paths.mjs';
import { ADAPTER_PREFIXES, buildProfile, classifyPath, formatProfile, validateExtras, validateProfile } from '../profile.mjs';
import { readTextIfExists, writeTextAtomic } from '../../io/files.mjs';
import { ensurePaths, hashPaths, listTree, openSource } from '../../io/source.mjs';
import { defaultProfilePath } from './verify.mjs';

export const PROFILE_REPORT_SCHEMA = 'ecc-kiro.profile-report.v1';

const DEFAULT_KIMI_STATE = '.kimi-code/ecc-install-state.json';

/** The extra entries that ship with the skill: files the Kimi install did not have, each with a reason. */
export const defaultExtrasPath = (skillDir) => path.join(skillDir, 'assets', 'profiles', `extras-v${ECC_VERSION}.json`);

/** Read the extras file. The default file may be missing (no extras); one named with --extras must exist. */
async function loadExtras({ file, required, fs }) {
  const text = await readTextIfExists(fs, file);
  if (text === null) {
    if (required) throw new CodedError('extras-missing', `extras file not found: ${file}`);
    return [];
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new CodedError('extras-invalid', `${file} is not valid JSON (${error.message})`);
  }
  const problems = validateExtras(value);
  if (problems.length > 0) {
    const more = problems.length > 1 ? ` (and ${problems.length - 1} more)` : '';
    throw new CodedError('extras-invalid', `${file}: ${problems[0].message}${more}`);
  }
  return value.entries;
}

/** Paths from a Kimi install that end up in a profile (everything except excluded and unknown files). */
export function placeableKimiPaths(kimiState) {
  const paths = [];
  for (const op of kimiState?.operations ?? []) {
    const rel = op?.sourceRelativePath;
    if (!isSafeRelativePath(rel)) continue;
    const placed = classifyPath(rel);
    if (placed !== null && !('excluded' in placed)) paths.push(rel);
  }
  return paths;
}

export function formatProfileReport(report) {
  const lines = ['ecc-kiro-setup profile (maintainers)', ''];
  const row = (label, value) => lines.push(`  ${label.padEnd(10)}${value}`);
  row('Kimi', report.kimi);
  if (report.source) row('Source', `${report.source.dir}  (${report.source.origin}, commit ${report.source.commit ? report.source.commit.slice(0, 7) : 'unknown'})`);
  if (report.counts) {
    const counts = Object.entries(report.counts).filter(([key, value]) => value > 0 && key !== 'skillDirs');
    row('Entries', `${counts.map(([key, value]) => `${key} ${value}`).join(', ')}; ${report.counts.skillDirs} skill folders`);
    row('Excluded', `${report.excluded} Kimi/Pi/Codex-only files left out`);
  }
  if (report.extras > 0) row('Extras', `${report.extras} files added on top of the Kimi install`);
  row('Profile', `${report.file}  (${report.status})`);
  for (const item of report.problems.slice(0, 30)) lines.push(`  problem   ${item.code}: ${item.message}`);
  if (report.problems.length > 30) lines.push(`  ...and ${report.problems.length - 30} more problems`);
  const summary = {
    written: 'Result: profile written',
    unchanged: 'Result: profile is up to date',
    differs: 'Result: profile differs from the generated one (run with --write to update it)',
    missing: 'Result: no profile file yet (run with --write to create it)',
    failed: 'Result: profile could not be built',
  };
  lines.push('', summary[report.status]);
  return `${lines.join('\n')}\n`;
}

export const profileCommand = {
  summary: 'rebuild the hash-pinned install profile from a Kimi install (maintainers)',
  options: ['json', 'root', 'kimi', 'extras', 'source', 'fetch', 'out', 'write'],
  async run({ options, stdout, probes, skillDir, services, log }) {
    const fs = services.fs;
    const root = path.resolve(options.root ?? probes.cwd);
    const kimiFile = path.resolve(root, options.kimi ?? DEFAULT_KIMI_STATE);
    const outFile = path.resolve(root, options.out ?? defaultProfilePath(skillDir));

    const extras = await loadExtras({ file: path.resolve(root, options.extras ?? defaultExtrasPath(skillDir)), required: Boolean(options.extras), fs });

    const kimiText = await readTextIfExists(fs, kimiFile);
    if (kimiText === null) throw new CodedError('kimi-missing', `Kimi install state not found: ${kimiFile}`, { fix: 'Pass --kimi <ecc-install-state.json>.' });
    let kimiState;
    try {
      kimiState = JSON.parse(kimiText);
    } catch (error) {
      throw new CodedError('kimi-unreadable', `Kimi install state is not valid JSON: ${kimiFile} (${error.message})`);
    }

    const source = await openSource({
      sourceDir: options.source,
      cacheRoot: resolveCacheRoot(probes.env ?? {}, probes.homedir),
      fetch: Boolean(options.fetch),
      git: services.git,
      log,
      fs,
    });

    const adapterPaths = await listTree({ source, prefixes: ADAPTER_PREFIXES, git: services.git });
    const wanted = [...new Set([...placeableKimiPaths(kimiState), ...adapterPaths.filter((rel) => {
      const placed = classifyPath(rel);
      return placed !== null && !('excluded' in placed);
    }), ...extras.map((extra) => extra.path), 'LICENSE'])];

    if (options.fetch && source.origin !== 'local') {
      await ensurePaths({ source, paths: wanted, git: services.git, log, fs });
    }
    const { hashes } = await hashPaths({ dir: source.dir, paths: wanted, fs });
    const { profile, problems } = buildProfile({ kimiState, adapterPaths, hashes, extras });
    if (profile) problems.push(...validateProfile(profile));

    const base = { schema: PROFILE_REPORT_SCHEMA, kimi: kimiFile, source, file: outFile, extras: extras.length, problems };
    const finish = (report) => {
      stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : formatProfileReport(report));
      return report.ok ? EXIT.OK : EXIT.FAILED;
    };
    if (problems.length > 0 || !profile) {
      return finish({ ...base, ok: false, status: 'failed', counts: profile?.counts ?? null, excluded: profile?.excluded.length ?? 0 });
    }

    const text = formatProfile(profile);
    const existing = await readTextIfExists(fs, outFile);
    let status = existing === null ? 'missing' : existing === text ? 'unchanged' : 'differs';
    if (options.write && status !== 'unchanged') {
      await writeTextAtomic(fs, outFile, text);
      status = 'written';
    }
    return finish({
      ...base,
      ok: status === 'written' || status === 'unchanged',
      status,
      counts: profile.counts,
      excluded: profile.excluded.length,
    });
  },
};
