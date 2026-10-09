// `doctor`: a read-only report on the machine, the target project and any existing install.

import path from 'node:path';

import {
  DOCTOR_SCHEMA,
  ECC_COMMIT,
  ECC_TAG,
  ECC_VERSION,
  HARNESS_DIRS,
  KIROIGNORE_BLOCK_BEGIN,
  KIROIGNORE_BLOCK_END,
  KIROIGNORE_FILE,
  KIRO_CLI_NATIVE_V3,
  KIRO_SUBDIRS,
  MIN_GIT_PARTIAL,
  MIN_NODE,
  SKILL_NAME,
  SKILL_VERSION,
  STATE_RELATIVE_PATH,
  STATE_SCHEMA,
  cacheCheckoutName,
} from './constants.mjs';
import { resolveCacheRoot, resolveKiroHome } from './paths.mjs';
import { validateSkillMarkdown } from './skills.mjs';
import { atLeast, parseVersion } from './version.mjs';

const isDir = (stat) => stat?.type === 'dir';

async function inspectTools(probes, problem) {
  const nodeVersion = parseVersion(await probes.nodeVersion());
  const nodeOk = atLeast(nodeVersion, MIN_NODE);
  if (!nodeOk) {
    problem('error', 'node-too-old', `Node ${nodeVersion ?? 'unknown'} is older than ${MIN_NODE}`, `Install Node ${MIN_NODE} or newer.`);
  }

  const gitVersion = parseVersion(await probes.gitVersion());
  const partial = gitVersion !== null && atLeast(gitVersion, MIN_GIT_PARTIAL);
  if (gitVersion === null) {
    problem('warn', 'git-missing', 'git was not found, so ECC cannot be fetched automatically', 'Install git, or pass --source <ECC checkout>.');
  } else if (!partial) {
    problem('warn', 'git-old', `git ${gitVersion} is older than ${MIN_GIT_PARTIAL}; a partial clone may fail, in which case the full repository is downloaded instead`);
  }

  const cli = await probes.kiroCli();
  const cliVersion = cli.found ? parseVersion(cli.version) : null;
  const nativeV3 = cliVersion !== null && atLeast(cliVersion, KIRO_CLI_NATIVE_V3);
  if (!cli.found) {
    problem('info', 'kiro-cli-not-found', 'kiro-cli was not found; CLI verification steps are skipped and the IDE checklist applies');
  } else if (!nativeV3 && cli.v3Flag === true) {
    problem('info', 'kiro-cli-v3-opt-in', `kiro-cli ${cliVersion} runs the V3 engine only with --v3; markdown agents and v1 hooks need it`);
  } else if (!nativeV3 && cli.v3Flag === false) {
    problem('warn', 'kiro-cli-no-v3', `kiro-cli ${cliVersion} has no V3 engine; use Kiro IDE 1.0 or newer to run the installed agents and hooks`);
  }

  return {
    node: { version: nodeVersion, required: `>=${MIN_NODE}`, ok: nodeOk },
    git: { found: gitVersion !== null, version: gitVersion, partialClone: partial },
    kiroCli: { found: cli.found, version: cliVersion, v3Flag: cli.v3Flag ?? null, nativeV3 },
  };
}

async function inspectInstallState(root, probes, problem) {
  const statePath = path.join(root, STATE_RELATIVE_PATH);
  const text = await probes.readText(statePath);
  if (text === null) return { exists: false, path: STATE_RELATIVE_PATH };

  let state;
  try {
    state = JSON.parse(text);
  } catch {
    problem('error', 'state-corrupt', `${STATE_RELATIVE_PATH} is not valid JSON`, 'Restore it from a backup, or remove it and reinstall.');
    return { exists: true, path: STATE_RELATIVE_PATH, valid: false };
  }
  if (state === null || typeof state !== 'object' || Array.isArray(state)) {
    problem('error', 'state-corrupt', `${STATE_RELATIVE_PATH} must contain a JSON object`);
    return { exists: true, path: STATE_RELATIVE_PATH, valid: false };
  }
  if (state.schema !== STATE_SCHEMA) {
    problem('warn', 'state-schema-unknown', `${STATE_RELATIVE_PATH} uses schema ${JSON.stringify(state.schema ?? null)}, expected ${STATE_SCHEMA}`);
  }
  return {
    exists: true,
    path: STATE_RELATIVE_PATH,
    valid: true,
    schema: state.schema ?? null,
    profile: state.profile?.id ?? state.profile ?? null,
    eccVersion: state.source?.version ?? null,
    eccCommit: state.source?.commit ?? null,
    installedAt: state.installedAt ?? null,
    files: Array.isArray(state.files) ? state.files.length : 0,
  };
}

async function inspectTarget(root, probes, problem) {
  const kiroDir = path.join(root, '.kiro');
  const kiroStat = await probes.stat(kiroDir);
  const present = isDir(kiroStat) ? new Set((await probes.readdir(kiroDir)) ?? []) : new Set();

  const ignoreText = await probes.readText(path.join(root, KIROIGNORE_FILE));
  const harnessDirs = [];
  for (const name of HARNESS_DIRS) {
    if (isDir(await probes.stat(path.join(root, name)))) harnessDirs.push(name);
  }

  return {
    root,
    kiroDir: { exists: isDir(kiroStat), subdirs: KIRO_SUBDIRS.filter((name) => present.has(name)) },
    isGitRepo: (await probes.stat(path.join(root, '.git'))) !== null,
    kiroignore: {
      exists: ignoreText !== null,
      managedBlock: ignoreText !== null && ignoreText.includes(KIROIGNORE_BLOCK_BEGIN) && ignoreText.includes(KIROIGNORE_BLOCK_END),
    },
    harnessDirs,
    installState: await inspectInstallState(root, probes, problem),
  };
}

/** Where a copy of this skill can live: in the project, globally, or as an installed Power. */
function skillLocations(root, kiroHome) {
  return {
    project: path.join(root, '.kiro', 'skills', SKILL_NAME),
    global: path.join(kiroHome, 'skills', SKILL_NAME),
    power: path.join(kiroHome, 'powers', 'installed', SKILL_NAME),
  };
}

/**
 * Collect the doctor report.
 * @param {{ root: string, skillDir: string, probes: any }} input
 */
export async function collectDoctor({ root, skillDir, probes }) {
  const problems = [];
  const problem = (severity, code, message, fix) => problems.push({ severity, code, message, ...(fix ? { fix } : {}) });
  const resolvedRoot = path.resolve(root);
  const kiroHome = resolveKiroHome(probes.env ?? {}, probes.homedir);

  const tools = await inspectTools(probes, problem);
  const target = await inspectTarget(resolvedRoot, probes, problem);

  const where = skillLocations(resolvedRoot, kiroHome);
  const present = {
    project: isDir(await probes.stat(where.project)),
    global: isDir(await probes.stat(where.global)),
    power: isDir(await probes.stat(where.power)),
  };
  if (Object.values(present).filter(Boolean).length > 1) {
    problem(
      'warn',
      'skill-duplicate',
      `${SKILL_NAME} is installed in more than one place (${Object.keys(present).filter((k) => present[k]).join(', ')}); the project copy wins, but keep only one`,
      'Remove the global copy or uninstall the Power.',
    );
  }

  const cacheRoot = resolveCacheRoot(probes.env ?? {}, probes.homedir);
  const checkout = path.join(cacheRoot, cacheCheckoutName());
  const cache = {
    root: cacheRoot,
    exists: isDir(await probes.stat(cacheRoot)),
    checkout,
    checkoutExists: isDir(await probes.stat(checkout)),
  };

  const skillMdPath = path.join(skillDir, 'SKILL.md');
  const skillText = await probes.readText(skillMdPath);
  let selfCheck;
  if (skillText === null) {
    selfCheck = { path: skillMdPath, found: false, valid: false, errors: [{ code: 'skill-md-missing', message: 'SKILL.md not found' }], warnings: [] };
    problem('error', 'skill-md-missing', `SKILL.md not found at ${skillMdPath}`);
  } else {
    const verdict = validateSkillMarkdown(skillText, { dirName: path.basename(skillDir) });
    selfCheck = { path: skillMdPath, found: true, valid: verdict.ok, errors: verdict.errors, warnings: verdict.warnings };
    if (!verdict.ok) problem('error', 'skill-invalid', `this skill's SKILL.md is invalid: ${verdict.errors.map((e) => e.code).join(', ')}`);
  }

  return {
    schema: DOCTOR_SCHEMA,
    ok: !problems.some((item) => item.severity === 'error'),
    skill: { name: SKILL_NAME, version: SKILL_VERSION, dir: skillDir },
    eccTarget: { version: ECC_VERSION, tag: ECC_TAG, commit: ECC_COMMIT },
    tools,
    target,
    locations: { kiroHome, ...where, present },
    cache,
    selfCheck,
    problems,
  };
}

const yesNo = (value) => (value ? 'yes' : 'no');

/** Human-readable rendering of a doctor report. */
export function formatDoctor(report) {
  const { tools, target, locations, cache, selfCheck } = report;
  const lines = [];
  const row = (label, value) => lines.push(`  ${label.padEnd(16)}${value}`);

  lines.push(`${report.skill.name} ${report.skill.version} doctor (ECC ${report.eccTarget.tag} @ ${report.eccTarget.commit.slice(0, 7)})`);
  lines.push('', 'Tools');
  row('node', `${tools.node.version ?? 'unknown'}  ${tools.node.ok ? 'ok' : `too old (${tools.node.required})`}`);
  row('git', tools.git.found ? `${tools.git.version}  partial clone: ${yesNo(tools.git.partialClone)}` : 'not found');
  if (tools.kiroCli.found) {
    const v3 = tools.kiroCli.nativeV3 ? 'V3 native' : tools.kiroCli.v3Flag ? 'V3 via --v3' : tools.kiroCli.v3Flag === false ? 'no V3 engine' : 'V3 unknown';
    row('kiro-cli', `${tools.kiroCli.version ?? 'unknown'}  ${v3}`);
  } else {
    row('kiro-cli', 'not found');
  }

  lines.push('', `Project  ${target.root}`);
  row('.kiro', target.kiroDir.exists ? `present${target.kiroDir.subdirs.length ? ` (${target.kiroDir.subdirs.join(', ')})` : ''}` : 'missing (created on install)');
  row('git repository', yesNo(target.isGitRepo));
  row('.kiroignore', target.kiroignore.exists ? `present, ECC block: ${yesNo(target.kiroignore.managedBlock)}` : 'missing');
  row('harness folders', target.harnessDirs.length ? target.harnessDirs.join(', ') : 'none');
  const state = target.installState;
  if (!state.exists) row('ECC install', 'none');
  else if (!state.valid) row('ECC install', 'state file unreadable');
  else row('ECC install', `${state.files} files, ECC ${state.eccVersion ?? '?'}, profile ${state.profile ?? '?'}`);

  lines.push('', 'Locations');
  row('project skill', yesNo(locations.present.project));
  row('global skill', `${yesNo(locations.present.global)}  (${locations.global})`);
  row('power', yesNo(locations.present.power));
  row('source cache', `${cache.checkoutExists ? 'pinned checkout present' : cache.exists ? 'cache present, checkout missing' : 'none'}  (${cache.root})`);

  lines.push('', `Self-check  ${selfCheck.valid ? 'SKILL.md valid' : 'SKILL.md INVALID'}`);
  for (const item of [...selfCheck.errors, ...selfCheck.warnings]) lines.push(`  - ${item.code}: ${item.message}`);

  lines.push('', report.problems.length === 0 ? 'No problems found.' : 'Findings');
  for (const item of report.problems) {
    lines.push(`  [${item.severity}] ${item.code}: ${item.message}`);
    if (item.fix) lines.push(`         fix: ${item.fix}`);
  }
  lines.push('', report.ok ? 'Result: ok' : 'Result: problems need attention');
  return `${lines.join('\n')}\n`;
}
