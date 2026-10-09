import path from 'node:path';

import { ECC_TAG, HARNESS_DIRS, PROFILE_ID, SKILL_NAME, STATE_RELATIVE_PATH } from '../constants.mjs';
import { CodedError, EXIT, UsageError } from '../exit.mjs';
import { GUARD_FILE } from '../hooks.mjs';
import { OWNED_SCRIPTS } from '../owned.mjs';
import { resolveCacheRoot, resolveKiroHome } from '../paths.mjs';
import { COMMAND_ASSET_FILES, PART_ORDER, buildPlanned, entriesFor, resolveParts, scopeFor } from '../plan.mjs';
import { validateProfile } from '../profile.mjs';
import { validateLanguageGlobs } from '../rule-packs.mjs';
import { countActions, parseState, protectedPaths, reconcile } from '../state.mjs';
import { applyDecisions, findUnsafeDestinations, inspectDestinations } from '../../io/apply.mjs';
import { readTextIfExists } from '../../io/files.mjs';
import { ensurePaths, openSource, readVerifiedFiles } from '../../io/source.mjs';
import { defaultProfilePath, loadProfile } from './verify.mjs';

export const PLAN_SCHEMA = 'ecc-kiro.plan.v1';
export const APPLY_SCHEMA = 'ecc-kiro.apply.v1';

const ACTIONS = ['install', 'update', 'uninstall'];

// ---- the project and the machine -----------------------------------------------

async function assertProjectRoot({ root, env, homedir, fs }) {
  let stat;
  try {
    stat = await fs.stat(root);
  } catch (error) {
    if (error.code === 'ENOENT') throw new CodedError('root-missing', `project folder not found: ${root}`);
    throw error;
  }
  if (!stat.isDirectory()) throw new CodedError('root-not-directory', `not a folder: ${root}`);

  // ~/.kiro is Kiro's global folder, with settings and credentials. This tool installs into one project.
  const real = async (target) => fs.realpath(target).catch(() => path.resolve(target));
  if ((await real(path.join(root, '.kiro'))) === (await real(resolveKiroHome(env, homedir)))) {
    throw new CodedError('root-is-kiro-home', `${root} is the folder that holds your global Kiro settings (${path.join(root, '.kiro')}); this tool installs into one project only`, {
      fix: 'Run it from inside a project folder, or pass --root <project>.',
    });
  }
}

async function readdirIfPresent(fs, dir, options) {
  try {
    return await fs.readdir(dir, options);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return [];
    throw error;
  }
}

/** Names of the agents in the user's global agents folder, from the file names. */
async function listGlobalAgents({ kiroHome, fs }) {
  const names = await readdirIfPresent(fs, path.join(kiroHome, 'agents'));
  return new Set(names.filter((name) => name.endsWith('.md') || name.endsWith('.json')).map((name) => name.replace(/\.(md|json)$/, '')));
}

/** Names of the skills in the user's global skills folder: its folders, and links to folders. */
async function listGlobalSkills({ kiroHome, fs }) {
  const entries = await readdirIfPresent(fs, path.join(kiroHome, 'skills'), { withFileTypes: true });
  return new Set(entries.filter((entry) => entry.isDirectory() || entry.isSymbolicLink()).map((entry) => entry.name));
}

/** The file of file patterns that ships inside this skill. It can replace the patterns of a rule pack. */
export const defaultLanguageGlobsPath = (skillDir) => path.join(skillDir, 'assets', 'language-globs.json');

/** File patterns per rule pack. A missing file means no overrides; an unreadable one stops the run. */
async function loadLanguageGlobs({ file, fs }) {
  const text = await readTextIfExists(fs, file);
  if (text === null) return {};
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new CodedError('language-globs-invalid', `${file} is not valid JSON (${error.message})`, { fix: 'Fix or delete the file. Without it every rule pack uses the patterns from its own rules.' });
  }
  const problems = validateLanguageGlobs(value);
  if (problems.length > 0) {
    const more = problems.length > 1 ? ` (and ${problems.length - 1} more)` : '';
    throw new CodedError('language-globs-invalid', `${file}: ${problems[0].message}${more}`, { fix: 'Fix or delete the file. Without it every rule pack uses the patterns from its own rules.' });
  }
  return value.packs;
}

/** The folders of other harnesses that exist in the project, from the list the doctor knows. */
async function listHarnessDirs({ root, fs }) {
  const found = [];
  for (const name of HARNESS_DIRS) {
    try {
      if ((await fs.stat(path.join(root, name))).isDirectory()) found.push(name);
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
    }
  }
  return found;
}

/** The data files of the commands part, and the overlays, that ship inside this skill. */
export const defaultCommandAssetsDir = (skillDir) => path.join(skillDir, 'assets', 'commands');

/**
 * Read assets/commands: the four data files (left undefined when missing, so the plan can say which) and
 * the text of each overlay in overlays/. Checking what is in them is the plan's job (lib/plan.mjs).
 */
async function loadCommandAssets({ dir, fs }) {
  const assets = { overlays: new Map() };
  for (const [key, file] of Object.entries(COMMAND_ASSET_FILES)) {
    const text = await readTextIfExists(fs, path.join(dir, file));
    if (text === null) continue;
    try {
      assets[key] = JSON.parse(text);
    } catch (error) {
      throw new CodedError('command-assets-invalid', `${path.join(dir, file)} is not valid JSON (${error.message})`, { fix: 'Fix the file. The commands cannot be built without it.' });
    }
  }
  for (const file of (await readdirIfPresent(fs, path.join(dir, 'overlays'))).filter((name) => name.endsWith('.md') && name !== 'NOTICE-ECC.md').sort()) {
    assets.overlays.set(file.slice(0, -3), await fs.readFile(path.join(dir, 'overlays', file), 'utf8'));
  }
  return assets;
}

/** The folder of the scripts that the hooks run and that are installed as they are. */
export const defaultHookAssetsDir = (skillDir) => path.join(skillDir, 'scripts', 'runtime');

/** The text of the git push guard, from the skill folder. A missing file is left out, so the plan can say so. */
async function loadHookAssets({ dir, fs }) {
  const guard = await readTextIfExists(fs, path.join(dir, GUARD_FILE));
  return guard === null ? {} : { guard };
}

/** The scripts of the owned part, from the same folder. A script that is missing is left out, so the plan can say which. */
async function loadOwnedAssets({ dir, fs }) {
  const scripts = {};
  for (const file of OWNED_SCRIPTS) {
    const text = await readTextIfExists(fs, path.join(dir, file));
    if (text !== null) scripts[file] = text;
  }
  return { scripts };
}

// ---- preparing a plan ---------------------------------------------------------

/**
 * Everything up to the point of changing anything: read the profile and the ECC source, build the
 * files, look at the project, and decide what happens to each file. Writes nothing.
 */
async function prepare({ options, mode, probes, skillDir, services, log }) {
  if (mode === 'uninstall') return prepareUninstall({ options, probes, services });
  const fs = services.fs;
  const env = probes.env ?? {};
  const kiroHome = resolveKiroHome(env, probes.homedir);
  const root = path.resolve(options.root ?? probes.cwd);
  await assertProjectRoot({ root, env, homedir: probes.homedir, fs });
  const parts = resolveParts(options.only);

  const stateText = await readTextIfExists(fs, path.join(root, STATE_RELATIVE_PATH));
  const previous = stateText === null ? null : parseState(stateText);
  if (mode === 'update' && previous === null) {
    throw new CodedError('not-installed', `nothing to update: ${STATE_RELATIVE_PATH} does not exist in ${root}, so ECC was not installed here by this tool`, {
      fix: 'Run "install" first. "update" works on an install that already exists.',
    });
  }

  const profileFile = path.resolve(options.profile ?? defaultProfilePath(skillDir));
  const profile = await loadProfile({ file: profileFile, fs });
  const profileProblems = validateProfile(profile);
  if (profileProblems.length > 0) {
    const more = profileProblems.length > 1 ? ` (and ${profileProblems.length - 1} more)` : '';
    throw new CodedError('profile-invalid', `the profile is not valid: ${profileProblems[0].message}${more}`, { fix: 'Run "verify" for the full list.' });
  }

  const source = await openSource({
    sourceDir: options.source,
    cacheRoot: resolveCacheRoot(env, probes.homedir),
    fetch: Boolean(options.fetch),
    git: services.git,
    log,
    fs,
  });
  const entries = entriesFor(parts, profile);
  if (options.fetch && source.origin !== 'local') {
    await ensurePaths({ source, paths: entries.map((entry) => entry.path), git: services.git, log, fs });
  }

  const context = {
    root,
    mode,
    parts,
    profile: { id: profile.id ?? PROFILE_ID, file: profileFile },
    source,
    previous,
    planned: [],
    decisions: [],
    notes: [],
    details: {},
    problems: [],
  };

  const { files: sourceFiles, executable, missing, mismatched } = await readVerifiedFiles({ dir: source.dir, entries, fs });
  if (missing.length > 0) {
    context.problems.push({
      code: 'source-incomplete',
      message: `${missing.length} ECC file${missing.length === 1 ? ' is' : 's are'} missing from ${source.dir} (for example ${missing[0]}); run again with --fetch to download them`,
    });
  }
  for (const item of mismatched) {
    context.problems.push({ code: 'hash-mismatch', message: `${item.path} does not match the hash the profile pins, so nothing is installed`, path: item.path });
  }
  if (context.problems.length > 0) return context;

  const built = buildPlanned({
    parts,
    profile,
    sourceFiles,
    sourceExecutable: executable,
    existing: { globalAgents: await listGlobalAgents({ kiroHome, fs }), globalSkills: await listGlobalSkills({ kiroHome, fs }) },
    languageGlobs: parts.includes('steering') ? await loadLanguageGlobs({ file: defaultLanguageGlobsPath(skillDir), fs }) : {},
    commandAssets: parts.includes('commands') ? await loadCommandAssets({ dir: defaultCommandAssetsDir(skillDir), fs }) : undefined,
    hookAssets: parts.includes('hooks') ? await loadHookAssets({ dir: defaultHookAssetsDir(skillDir), fs }) : undefined,
    ownedAssets: parts.includes('owned') ? await loadOwnedAssets({ dir: defaultHookAssetsDir(skillDir), fs }) : undefined,
    models: parts.includes('owned') && typeof probes.listModels === 'function' ? await probes.listModels() : null,
    harnessDirs: parts.includes('isolation') ? await listHarnessDirs({ root, fs }) : [],
  });
  context.notes = built.notes;
  context.details = built.details;
  context.problems.push(...built.problems);
  if (context.problems.length > 0) return context;

  context.planned = built.planned;

  const scope = scopeFor(parts);
  const owned = (context.previous?.files ?? []).filter((entry) => scope.has(entry.category)).map((entry) => entry.path);
  const touched = [...built.planned.map((file) => file.dest), ...owned];
  context.problems.push(...(await findUnsafeDestinations({ root, dests: touched, fs })));
  if (context.problems.length > 0) return context;

  const related = built.planned.flatMap((file) => [...(file.blockedBy ?? []), ...(file.anchor ? [file.anchor] : [])]);
  const disk = await inspectDestinations({ root, dests: [...touched, ...related], fs });
  context.decisions = reconcile({ mode, planned: built.planned, state: context.previous, disk, scope });
  return context;
}

/**
 * The same, for an uninstall. It needs the install state and the project and nothing else: no profile,
 * no ECC source, no network, so it works when the cache is gone. Without --only it removes everything
 * the state lists, whatever the category; with --only, the files of those parts.
 */
async function prepareUninstall({ options, probes, services }) {
  const fs = services.fs;
  const env = probes.env ?? {};
  const root = path.resolve(options.root ?? probes.cwd);
  await assertProjectRoot({ root, env, homedir: probes.homedir, fs });
  const parts = resolveParts(options.only);
  const stateText = await readTextIfExists(fs, path.join(root, STATE_RELATIVE_PATH));
  const previous = stateText === null ? null : parseState(stateText);

  const context = {
    root,
    mode: 'uninstall',
    parts: options.only === undefined ? [...PART_ORDER] : parts,
    profile: { id: previous?.profile.id ?? PROFILE_ID, file: null },
    source: null,
    previous,
    planned: [],
    decisions: [],
    notes: [],
    details: {},
    problems: [],
    removesState: false,
  };
  if (previous === null) {
    context.notes.push({ level: 'info', code: 'not-installed', message: `${STATE_RELATIVE_PATH} does not exist, so no ECC install was recorded in this project and nothing is removed` });
    return context;
  }

  const scope = options.only === undefined ? new Set(previous.files.map((entry) => entry.category)) : scopeFor(parts);
  const owned = previous.files.filter((entry) => scope.has(entry.category)).map((entry) => entry.path);
  context.problems.push(...(await findUnsafeDestinations({ root, dests: owned, fs })));
  if (context.problems.length > 0) return context;

  const disk = await inspectDestinations({ root, dests: owned, fs });
  context.decisions = reconcile({ mode: 'uninstall', planned: [], state: previous, disk, scope });
  context.removesState = previous.files.every((entry) => scope.has(entry.category));
  return context;
}

// ---- reports --------------------------------------------------------------------

function baseReport(schema, context) {
  const changing = context.decisions.filter((item) => item.write !== null || item.remove);
  return {
    schema,
    ok: context.problems.length === 0,
    mode: context.mode,
    root: context.root,
    profile: context.profile,
    source: context.source,
    parts: context.parts,
    counts: countActions(context.decisions),
    // Taking the install record away is a change too, so an uninstall that only has the record left is not "nothing to do".
    changes: changing.length + (context.removesState ? 1 : 0),
    ...(context.mode === 'uninstall' ? { stateFile: { path: STATE_RELATIVE_PATH, remove: context.removesState } } : {}),
    protected: protectedPaths(changing.map((item) => item.dest)),
    files: context.decisions.map((item) => ({
      path: item.dest,
      category: item.category,
      action: item.action,
      ...(item.action === 'unchanged' ? {} : { reason: item.reason }),
      ...(item.updateAvailable ? { updateAvailable: true } : {}),
    })),
    details: context.details,
    notes: context.notes,
    problems: context.problems,
  };
}

const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

function listLines(report, actions, heading) {
  const rows = report.files.filter((item) => actions.includes(item.action));
  if (rows.length === 0) return [];
  const lines = ['', heading];
  for (const item of rows.slice(0, 20)) lines.push(`  ${item.path}: ${item.reason}${item.updateAvailable ? ' (a newer version was not applied)' : ''}`);
  if (rows.length > 20) lines.push(`  ...and ${rows.length - 20} more`);
  return lines;
}

/** Human-readable rendering of a plan or an apply report. */
export function formatPlanReport(report, { hint } = {}) {
  const applied = report.schema === APPLY_SCHEMA;
  const lines = [];
  const row = (label, value) => lines.push(`  ${label.padEnd(10)}${value}`);
  const verb = report.mode;

  lines.push(`${SKILL_NAME} ${applied ? verb : `${verb} preview`} (ECC ${ECC_TAG}, profile ${report.profile.id})`, '');
  row('Project', report.root);
  if (report.source) row('Source', `${report.source.dir}  (${report.source.origin}${report.source.commitVerified ? `, commit ${report.source.commit.slice(0, 7)} matches the pin` : ''})`);
  row('Parts', report.parts.join(', '));

  const c = report.counts;
  if (report.mode === 'uninstall') {
    lines.push('', `  remove ${c.remove}   kept (edited) ${c.keepModified}   already gone ${c.forget}`);
  } else {
    lines.push('', `  create ${c.create}   update ${c.update}   unchanged ${c.unchanged}   kept (edited) ${c.keepModified}   conflicts ${c.conflict}   remove ${c.remove}${c.stale > 0 ? `   stale ${c.stale}` : ''}`);
  }
  if (!applied && report.stateFile?.remove) {
    lines.push(`  The install record ${report.stateFile.path} goes last, then the folders the install created, if they are empty. The ${SKILL_NAME} skill is not touched.`);
  }

  const skills = report.details?.skills;
  if (skills) {
    const facts = [
      skills.valid === skills.total ? 'all valid' : `${skills.valid} valid`,
      skills.patched.length > 0 ? `${skills.patched.length} repaired` : null,
      skills.executable > 0 ? `${skills.executable} executable` : null,
      skills.longBodies > 0 ? `${skills.longBodies} with bodies over 500 lines` : null,
    ].filter(Boolean);
    lines.push('', `Skills: ${plural(skills.total, 'skill')}, ${plural(skills.files, 'file')}; ${facts.join(', ')}`);
  }

  const steering = report.details?.steering;
  if (steering) {
    const on = steering.alwaysOn;
    lines.push(
      '',
      `Steering: ${plural(steering.files, 'file')} (${steering.adapter.files} from the ECC adapter, ${plural(steering.packs.files, 'language rule pack')}, ${steering.baseline.files} baseline); ` +
        `always on: ${plural(on.files, 'file')}, ${on.bytes.toLocaleString('en-US')} of ${on.limit.toLocaleString('en-US')} bytes`,
    );
  }

  const commands = report.details?.commands;
  if (commands) {
    const sources = [commands.withOverlay > 0 ? plural(commands.withOverlay, 'overlay') : null, commands.rewrites.replacements > 0 ? plural(commands.rewrites.replacements, 'replacement') + ` in ${plural(commands.rewrites.commandsChanged, 'command')}` : null].filter(Boolean);
    lines.push(
      '',
      `Commands: ${commands.registered} of ${commands.total} registered as /ecc-<name>${sources.length > 0 ? ` (${sources.join(', ')})` : ''}; ${commands.pending.length} pending (class B and C, not installed); ${commands.skipped.length} left to a skill of the same name; ${plural(commands.scripts.length, 'script')}`,
      `  Lint, which stops the plan for a command it would install: ${commands.clean} clean${commands.stillClaudeSpecific.length > 0 ? `, ${commands.stillClaudeSpecific.length} still have Claude Code wording (pending commands only)` : ''}`,
    );
  }

  const hooks = report.details?.hooks;
  if (hooks) {
    const state = hooks.disabled === hooks.converted ? 'all switched off' : `${hooks.disabled} of ${hooks.converted} switched off`;
    const left = hooks.skipped.length > 0 ? `; not converted: ${hooks.skipped.map((item) => item.name).join(', ')}` : '';
    lines.push(
      '',
      `Hooks: ${plural(hooks.converted, 'hook')} in .kiro/hooks, ${state}; actions: ${plural(hooks.agentActions, 'agent prompt')} (credits when on), ${plural(hooks.commandActions, 'script')}${left}; ${plural(hooks.scripts.length, 'script file')} installed`,
    );
  }

  const mcp = report.details?.mcp;
  if (mcp) {
    lines.push('', `MCP examples: ${plural(mcp.servers, 'server')} (${mcp.local} local, ${mcp.remote} remote) in ${mcp.files[0]}, every one switched off; ${mcp.fromAdapter} of them from the Kiro adapter of ECC`);
  }
  const owned = report.details?.owned;
  if (owned) {
    const hooks = owned.hooks.reduce((sum, file) => sum + file.names.length, 0);
    lines.push(
      '',
      `Owned: ${plural(owned.scripts.length, 'script')} in .kiro/ecc/scripts, ${plural(hooks, 'hook')} in ${plural(owned.hooks.length, 'file')} (all switched off), ${plural(owned.agents.length, 'panel agent')} (${owned.modelsKnown ? `${owned.modelsSet} with a model: line` : 'model list not read, no model: lines'}), ${plural(owned.workflows.length, 'workflow recipe')}`,
    );
  }
  const license = report.details?.license;
  if (license) lines.push('', `License: ${license.files.join(' and ')}`);
  const isolation = report.details?.isolation;
  if (isolation) {
    lines.push('', isolation.block ? `Isolation: a block in .kiroignore asks Kiro to ignore ${plural(isolation.folders.length, 'folder')} of other harnesses (${isolation.folders.join(', ')})` : 'Isolation: no folder of another harness found, so .kiroignore is left alone');
  }

  lines.push(...listLines(report, ['skip-conflict'], 'Skipped: these paths already exist and were not installed by ECC. They were left alone.'));
  lines.push(...listLines(report, ['keep-modified'], 'Kept: you edited these after the install, so they were not changed.'));
  lines.push(...listLines(report, ['stale'], 'Stale: no longer part of the install (run "update" to remove them).'));

  if (!applied && report.protected.length > 0) {
    lines.push(
      '',
      report.mode === 'uninstall'
        ? 'Kiro always asks before the agent changes these paths, so the installer removes what it put there itself once you confirm:'
        : 'Kiro always asks before the agent writes to these paths, so the installer writes them itself once you confirm:',
    );
    for (const item of report.protected) lines.push(`  ${item.path}${item.kind === 'directory' ? '/' : ''}  (${plural(item.files, 'file')})`);
  }

  if (report.notes.length > 0) {
    lines.push('', 'Notes');
    for (const note of report.notes) lines.push(`  ${note.level}: ${note.message}`);
  }
  if (report.problems.length > 0) {
    lines.push('', 'Problems');
    for (const problem of report.problems.slice(0, 20)) lines.push(`  ${problem.code}: ${problem.message}`);
    if (report.problems.length > 20) lines.push(`  ...and ${report.problems.length - 20} more`);
  }

  if (applied) {
    lines.push('');
    if (report.failure) {
      lines.push(`Stopped${report.failure.dest ? ` at ${report.failure.dest}` : ''}: ${report.failure.message}`);
      lines.push(`Written before the stop: ${plural(report.applied.written, 'file')}. Run the command again to continue; finished files are not touched twice.`);
    } else if (report.applied.written + report.applied.removed === 0 && !report.state.removed) {
      lines.push(report.mode === 'uninstall' ? 'Nothing to remove.' : 'Nothing to change: everything is already up to date.');
    } else if (report.mode === 'uninstall') {
      lines.push(`Removed ${plural(report.applied.removed, 'file')}. ${report.state.removed ? `The install record ${report.state.path} was removed too.` : `Install state: ${report.state.path} (${plural(report.state.files, 'file')} still tracked).`}`);
    } else {
      lines.push(`Wrote ${plural(report.applied.written, 'file')}, removed ${report.applied.removed}. Install state: ${report.state.path} (${plural(report.state.files, 'file')} tracked).`);
    }
  } else if (report.ok) {
    const nothing = report.mode === 'uninstall' ? 'Nothing to remove.' : 'Nothing to change: everything is already up to date.';
    lines.push('', report.changes === 0 ? nothing : `Nothing was ${report.mode === 'uninstall' ? 'removed' : 'written'}. ${hint ? `To apply: ${hint}` : ''}`.trim());
  } else {
    lines.push('', 'Nothing was written: fix the problems above first.');
  }
  return `${lines.join('\n')}\n`;
}

// ---- the commands ---------------------------------------------------------------

function checkAction(requested) {
  if (requested === undefined) return 'install';
  if (!ACTIONS.includes(requested)) throw new UsageError(`unknown action "${requested}" (expected ${ACTIONS.join(', ')})`);
  return requested;
}

/** An uninstall reads the install state and the project only, so the options about the ECC source mean nothing to it. */
function checkSourceOptions(mode, options) {
  const given = ['source', 'fetch', 'profile'].filter((name) => options[name]);
  if (mode === 'uninstall' && given.length > 0) {
    throw new UsageError(`uninstall does not read the ECC source, so ${given.map((name) => `--${name}`).join(' and ')} do not apply`);
  }
}

/** Quote a command-line argument for a POSIX shell, only when it needs it. */
const shellQuote = (arg) => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", "'\\''")}'`);

/** The command line that applies what was previewed, ready to copy. */
function applyHint(options, skillDir, mode) {
  const parts = ['node', path.join(skillDir, 'scripts', 'ecc-kiro.mjs'), mode];
  for (const name of ['root', 'only', 'source', 'profile']) if (options[name]) parts.push(`--${name}`, options[name]);
  parts.push('--yes');
  return parts.map(shellQuote).join(' ');
}

function finish(stdout, options, report, hint) {
  stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : formatPlanReport(report, { hint }));
  return report.ok ? EXIT.OK : EXIT.FAILED;
}

export const planCommand = {
  summary: 'preview an install, an update or an uninstall without changing anything (--action)',
  options: ['json', 'root', 'source', 'fetch', 'profile', 'only', 'action'],
  async run({ options, stdout, probes, skillDir, services, log }) {
    const mode = checkAction(options.action);
    checkSourceOptions(mode, options);
    const context = await prepare({ options, mode, probes, skillDir, services, log });
    return finish(stdout, options, { ...baseReport(PLAN_SCHEMA, context), dryRun: true }, applyHint(options, skillDir, mode));
  },
};

/**
 * install, update and uninstall. All three refuse to change anything without --yes, preview with --dry-run,
 * and report the same way. They differ in what they plan: install writes and keeps, update also removes
 * what the install no longer includes, and uninstall removes what the install created.
 */
function changingCommand(mode, { summary, verb, previewWith }) {
  return {
    summary,
    options: ['json', 'root', ...(mode === 'uninstall' ? [] : ['source', 'fetch', 'profile']), 'only', 'yes', 'dry-run'],
    async run({ options, stdout, probes, skillDir, services, log }) {
      if (options.yes && options['dry-run']) throw new UsageError('use either --yes or --dry-run, not both');
      if (!options.yes && !options['dry-run']) {
        throw new UsageError(`${mode} ${verb} files. Preview with ${previewWith} (or --dry-run), then run again with --yes`);
      }
      const context = await prepare({ options, mode, probes, skillDir, services, log });
      if (options['dry-run'] || context.problems.length > 0) {
        return finish(stdout, options, { ...baseReport(PLAN_SCHEMA, context), dryRun: true }, applyHint(options, skillDir, mode));
      }

      const now = services.now ? services.now() : new Date();
      const result = await applyDecisions({
        root: context.root,
        decisions: context.decisions,
        previous: context.previous,
        parts: context.parts,
        mode: context.mode,
        now,
        fs: services.fs,
      });
      const report = {
        ...baseReport(APPLY_SCHEMA, context),
        ok: result.failure === null,
        dryRun: false,
        applied: { written: result.written, removed: result.removed },
        state: { path: STATE_RELATIVE_PATH, status: result.state?.status ?? null, files: result.state?.files.length ?? 0, written: result.stateWritten, removed: result.stateRemoved },
        failure: result.failure,
      };
      return finish(stdout, options, report);
    },
  };
}

export const installCommand = changingCommand('install', {
  summary: 'install ECC into the project (needs --yes; preview first with plan)',
  verb: 'writes',
  previewWith: '"plan"',
});

export const updateCommand = changingCommand('update', {
  summary: 'bring an install up to date and remove files it no longer includes (needs --yes; preview first with --dry-run)',
  verb: 'writes and removes',
  previewWith: '"plan --action update"',
});

export const uninstallCommand = changingCommand('uninstall', {
  summary: 'remove the files an ECC install created (needs --yes; preview first with --dry-run)',
  verb: 'removes',
  previewWith: '"plan --action uninstall"',
});
