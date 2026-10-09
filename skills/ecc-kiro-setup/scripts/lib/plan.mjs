// Working out what an install consists of: which parts there are, and the files each one produces.
//
// Pure. The bytes of the ECC source are passed in (already checked against the profile), and the
// result is a list of files to write. Deciding what to do with each one on a given project is
// lib/state.mjs; touching the disk is io/apply.mjs.

import { AGENT_DIR, convertAgent } from './agents.mjs';
import { buildAgentsSteering, buildHarnessSteering } from './baseline.mjs';
import { ALWAYS_ON_LIMIT_BYTES, KIROIGNORE_CATEGORY, KIROIGNORE_FILE } from './constants.mjs';
import { CodedError, UsageError } from './exit.mjs';
import { FrontmatterError, parseFrontmatter } from './frontmatter.mjs';
import { sha256Hex } from './hash.mjs';
import { GUARD_DEST, GUARD_SOURCE, HOOK_CATEGORY, HOOK_SCRIPT_CATEGORY, convertHook } from './hooks.mjs';
import { buildBlock } from './kiroignore.mjs';
import { MCP_CATEGORY, MCP_EXAMPLE_DEST, MCP_TABLE_DEST, convertMcp } from './mcp.mjs';
import { OWNED_CATEGORIES, buildOwnedFiles, parseModelList } from './owned.mjs';
import { LICENSE_CATEGORY, LICENSE_DEST, NOTICES_DEST, buildNotices } from './notices.mjs';
import { compareStrings } from './paths.mjs';
import { PACKS, buildRulePack, packStem } from './rule-packs.mjs';
import { patchSkillMarkdown, validateSkillMarkdown } from './skills.mjs';
import {
  COMMAND_CATEGORY,
  KIRO_BUILTIN_COMMANDS,
  QUALITY_GATE,
  SCRIPT_CATEGORY,
  applyRewriteRules,
  compileLintPatterns,
  compileRewriteRules,
  droppedSettings,
  findNameCollisions,
  lintCommand,
  parseCommand,
  parseOverlay,
  qualityGateParts,
  renderCommand,
  requiredProblems,
  scriptDest,
  validateClasses,
  validateLintPatterns,
  validateRewriteRules,
  validateSnippets,
} from './slash-commands.mjs';
import { managedPathProblem } from './state.mjs';
import { AGENTS_STEM, HARNESS_STEM, convertAdapterSteering, steeringName } from './steering.mjs';

/**
 * @typedef {object} PlannedFile
 * @property {string} dest project-relative destination, forward slashes
 * @property {string | Uint8Array} content
 * @property {string} sha256 hash of `content`
 * @property {string | string[]} source ECC path(s) it comes from
 * @property {string} category what kind of file (agent, skill, steering); recorded in the install state
 * @property {string} part which part of the install produced it
 * @property {string[]} [blockedBy] other paths that, if present, make this file unwelcome
 * @property {string} [anchor] the main file of the folder this file belongs to; if that file exists and is not ECC's, this file is skipped
 * @property {number} [mode] permission bits for the new file; only set for executable files
 */

/** @typedef {{ code: string, message: string, path?: string }} Problem */
/** @typedef {{ level: 'info' | 'warn', code: string, message: string }} Note */

const decoder = new TextDecoder('utf-8', { fatal: true });

/** Decode a source file as UTF-8, or throw a CodedError naming the file. */
function decodeSource(bytes, path) {
  try {
    return decoder.decode(bytes);
  } catch {
    throw new CodedError('source-encoding', `${path}: not valid UTF-8`);
  }
}

const EXECUTABLE_MODE = 0o755;

// ---- the agents part ----------------------------------------------------------

function buildAgents({ profile, sourceFiles, existing }) {
  const planned = [];
  const problems = [];
  const notes = [];
  const seen = new Map();
  let droppedModel = 0;
  let droppedColor = 0;
  const shadowed = [];

  for (const entry of profile.entries.filter((item) => item.category === 'agent')) {
    const bytes = sourceFiles.get(entry.path);
    if (bytes === undefined) {
      problems.push({ code: 'source-missing', message: `${entry.path} was not read from the ECC source`, path: entry.path });
      continue;
    }
    let converted;
    try {
      converted = convertAgent({ path: entry.path, text: decodeSource(bytes, entry.path) });
    } catch (error) {
      if (!(error instanceof CodedError)) throw error;
      problems.push({ code: error.code, message: error.message, path: entry.path });
      continue;
    }
    if (seen.has(converted.name)) {
      problems.push({ code: 'agent-duplicate', message: `${entry.path} and ${seen.get(converted.name)} both define the agent "${converted.name}"`, path: entry.path });
      continue;
    }
    seen.set(converted.name, entry.path);
    if (converted.dropped.model !== null) droppedModel += 1;
    if (converted.dropped.color !== null) droppedColor += 1;
    if (existing.globalAgents.has(converted.name)) shadowed.push(converted.name);
    planned.push({
      dest: converted.dest,
      content: converted.content,
      sha256: sha256Hex(converted.content),
      source: entry.path,
      category: 'agent',
      part: 'agents',
      // Kiro reads .md and .json agents from the same folder; two files with one name would clash.
      blockedBy: [`${AGENT_DIR}/${converted.name}.json`],
    });
  }

  if (droppedModel + droppedColor > 0) {
    const what = [droppedModel > 0 ? `${droppedModel} ${droppedModel === 1 ? 'agent names' : 'agents name'} a Claude model` : null, droppedColor > 0 ? `${droppedColor} a color` : null];
    notes.push({
      level: 'info',
      code: 'agent-model-dropped',
      message: `${what.filter(Boolean).join(' and ')}; neither is carried over, so every agent uses the model of the session that runs it`,
    });
  }
  if (shadowed.length > 0) {
    notes.push({
      level: 'warn',
      code: 'agent-shadows-global',
      message: `${shadowed.length} agent name${shadowed.length === 1 ? '' : 's'} also exist${shadowed.length === 1 ? 's' : ''} in your global agents folder (${shadowed.join(', ')}); in this project the project copy wins`,
    });
  }
  return { planned, problems, notes, details: null };
}

// ---- the skills part ----------------------------------------------------------

export const SKILL_DIR = '.kiro/skills';

/** Count how often each value occurs, as a plain object sorted by name. */
const tally = (values) => {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Object.fromEntries([...counts].sort(([a], [b]) => compareStrings(a, b)));
};

function buildSkills({ profile, sourceFiles, sourceExecutable, existing }) {
  const planned = [];
  const problems = [];
  const notes = [];
  const patched = [];
  const warnings = [];
  const extraFields = [];
  const overlaps = [];

  const bySkill = new Map();
  for (const entry of profile.entries.filter((item) => item.category === 'skill')) {
    if (!bySkill.has(entry.skill)) bySkill.set(entry.skill, []);
    bySkill.get(entry.skill).push(entry);
  }

  for (const [skill, entries] of [...bySkill].sort(([a], [b]) => compareStrings(a, b))) {
    const main = entries.find((entry) => entry.rel === 'SKILL.md');
    if (!main) {
      problems.push({ code: 'skill-md-missing', message: `the skill "${skill}" has no SKILL.md`, path: entries[0].path });
      continue;
    }
    const mainBytes = sourceFiles.get(main.path);
    let text;
    try {
      text = decodeSource(mainBytes, main.path);
    } catch (error) {
      problems.push({ code: error.code, message: error.message, path: main.path });
      continue;
    }

    let finalText = text;
    let verdict = validateSkillMarkdown(text, { dirName: skill });
    if (!verdict.ok) {
      const repair = patchSkillMarkdown(text, { dirName: skill });
      if (repair !== null) {
        finalText = repair.text;
        verdict = validateSkillMarkdown(finalText, { dirName: skill });
        if (verdict.ok) patched.push({ skill, ...repair.patches[0] });
      }
    }
    if (!verdict.ok) {
      problems.push({ code: 'skill-invalid', message: `${main.path}: ${verdict.errors.map((item) => `${item.code} (${item.message})`).join('; ')}`, path: main.path });
      continue;
    }
    for (const warning of verdict.warnings) warnings.push({ skill, code: warning.code });
    for (const field of verdict.info.extraFields) extraFields.push(field);
    if (existing.globalSkills.has(skill)) overlaps.push(skill);

    for (const entry of entries) {
      const bytes = sourceFiles.get(entry.path);
      if (bytes === undefined) {
        problems.push({ code: 'source-missing', message: `${entry.path} was not read from the ECC source`, path: entry.path });
        continue;
      }
      const content = entry === main && finalText !== text ? finalText : bytes;
      const file = {
        dest: `${SKILL_DIR}/${skill}/${entry.rel}`,
        content,
        sha256: sha256Hex(content),
        source: entry.path,
        category: 'skill',
        part: 'skills',
        // If the folder already holds someone else's skill, none of its files are added to it.
        anchor: `${SKILL_DIR}/${skill}/SKILL.md`,
      };
      if (sourceExecutable.has(entry.path)) file.mode = EXECUTABLE_MODE;
      planned.push(file);
    }
  }

  if (patched.length > 0) {
    notes.push({
      level: 'warn',
      code: 'skill-patched',
      message: `${patched.length} skill${patched.length === 1 ? '' : 's'} broke a Kiro rule and had only their frontmatter repaired (${patched.map((item) => `${item.skill}: ${item.code}`).join(', ')})`,
    });
  }
  if (overlaps.length > 0) {
    notes.push({
      level: 'warn',
      code: 'skill-shadows-global',
      message: `${overlaps.length} skill${overlaps.length === 1 ? '' : 's'} also exist${overlaps.length === 1 ? 's' : ''} in your global skills folder (${overlaps.join(', ')}); in this project the project copy wins`,
    });
  }
  const long = warnings.filter((item) => item.code === 'body-long').length;
  const otherWarnings = warnings.filter((item) => item.code !== 'body-long');
  if (otherWarnings.length > 0) {
    notes.push({ level: 'info', code: 'skill-warnings', message: `${otherWarnings.length} skill warning${otherWarnings.length === 1 ? '' : 's'}: ${[...new Set(otherWarnings.map((item) => `${item.skill} ${item.code}`))].join(', ')}` });
  }

  const extras = tally(extraFields);
  const details = {
    skills: {
      total: bySkill.size,
      valid: bySkill.size - problems.filter((item) => item.code === 'skill-invalid' || item.code === 'skill-md-missing').length,
      files: planned.length,
      executable: planned.filter((file) => file.mode !== undefined).length,
      patched,
      longBodies: long,
      otherWarnings,
      extraFields: extras,
      overlapsGlobal: overlaps,
    },
  };
  if (Object.keys(extras).length > 0) {
    notes.push({
      level: 'info',
      code: 'skill-extra-fields',
      message: `some skills use frontmatter fields outside the Agent Skills standard (${Object.entries(extras).map(([field, count]) => `${field} x${count}`).join(', ')}); they are copied unchanged`,
    });
  }
  return { planned, problems, notes, details };
}

// ---- the steering part -----------------------------------------------------------

export const STEERING_CATEGORY = 'steering';

const utf8Length = (text) => Buffer.byteLength(text, 'utf8');

function buildSteering({ profile, sourceFiles, languageGlobs }) {
  const planned = [];
  const problems = [];
  const notes = [];
  const alwaysOn = [];
  const inclusions = { always: 0, fileMatch: 0, manual: 0 };
  let references = 0;

  const add = (built, source) => {
    planned.push({
      dest: built.dest,
      content: built.content,
      sha256: sha256Hex(built.content),
      source,
      category: STEERING_CATEGORY,
      part: 'steering',
    });
    if (built.inclusion === 'always') alwaysOn.push({ dest: built.dest, bytes: utf8Length(built.content) });
  };
  const textOf = (entry) => {
    const bytes = sourceFiles.get(entry.path);
    if (bytes === undefined) {
      problems.push({ code: 'source-missing', message: `${entry.path} was not read from the ECC source`, path: entry.path });
      return null;
    }
    try {
      return decodeSource(bytes, entry.path);
    } catch (error) {
      problems.push({ code: error.code, message: error.message, path: entry.path });
      return null;
    }
  };
  const attempt = (where, build) => {
    try {
      return build();
    } catch (error) {
      if (!(error instanceof CodedError)) throw error;
      problems.push({ code: error.code, message: error.message, path: where });
      return null;
    }
  };

  // The steering files of ECC's own Kiro adapter, fixed for current Kiro.
  const adapterEntries = profile.entries.filter((entry) => entry.category === 'adapter-steering');
  const known = new Set(adapterEntries.map((entry) => entry.name));
  for (const entry of adapterEntries) {
    const text = textOf(entry);
    if (text === null) continue;
    const built = attempt(entry.path, () => convertAdapterSteering({ path: entry.path, text, known }));
    if (built === null) continue;
    inclusions[built.inclusion] += 1;
    references += built.references;
    add(built, entry.path);
  }

  // One file per language rule pack the adapter has no steering for.
  const skills = new Set(profile.entries.filter((entry) => entry.category === 'skill').map((entry) => entry.skill));
  const packs = [];
  for (const pack of Object.keys(PACKS)) {
    const entries = profile.entries.filter((entry) => entry.category === 'rule' && entry.pack === pack);
    if (entries.length === 0) continue;
    const files = entries.map((entry) => ({ path: entry.path, file: entry.file, text: textOf(entry) }));
    if (files.some((file) => file.text === null)) continue;
    const override = Object.hasOwn(languageGlobs, pack) ? languageGlobs[pack] : undefined;
    const built = attempt(`rules/${pack}`, () => buildRulePack({ pack, files, override, steering: known, skills }));
    if (built === null) continue;
    packs.push(built);
    add(built, built.sources);
  }

  // The always-on baseline that replaces Kimi's AGENTS.md: ecc-agents.md (made from AGENTS.md) and ecc-kiro-harness.md.
  const agentEntries = new Map(profile.entries.filter((entry) => entry.category === 'agent').map((entry) => [entry.name, entry]));
  const describeAgent = (name) => {
    const bytes = sourceFiles.get(agentEntries.get(name).path);
    if (bytes === undefined) return null;
    try {
      const description = parseFrontmatter(decoder.decode(bytes)).data.description;
      return typeof description === 'string' ? description : null;
    } catch (error) {
      if (error instanceof FrontmatterError || error instanceof TypeError) return null;
      throw error;
    }
  };
  let agentsFile = null;
  const agentsMd = profile.entries.find((entry) => entry.category === 'agents-md');
  if (agentsMd === undefined) {
    problems.push({ code: 'agents-md-missing', message: 'the profile has no AGENTS.md, so ecc-agents.md cannot be written' });
  } else {
    const text = textOf(agentsMd);
    const agentNames = [...agentEntries.keys()].sort(compareStrings);
    agentsFile = text === null ? null : attempt(agentsMd.path, () => buildAgentsSteering({ agentsMd: text, agentNames, describeAgent, skillCount: skills.size, where: agentsMd.path }));
    if (agentsFile !== null) add(agentsFile, agentsMd.path);
  }
  add(buildHarnessSteering(), null);

  const count = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const filledIn = agentsFile?.fromDescriptions ?? [];
  if (filledIn.length > 0) {
    notes.push({
      level: 'info',
      code: 'steering-roster-fallback',
      message: `AGENTS.md leaves ${count(filledIn.length, 'agent')} out of its roster (${filledIn.join(', ')}); ${filledIn.length === 1 ? 'its row comes' : 'their rows come'} from the agent description`,
    });
  }
  const leftOut = agentsFile?.dropped ?? [];
  if (leftOut.length > 0) {
    notes.push({
      level: 'info',
      code: 'steering-roster-extra',
      message: `the AGENTS.md roster names ${count(leftOut.length, 'agent')} that ${leftOut.length === 1 ? 'is' : 'are'} not installed (${leftOut.join(', ')}); left out`,
    });
  }
  const overridden = packs.filter((pack) => pack.overridden).map((pack) => pack.pack);
  if (overridden.length > 0) {
    notes.push({
      level: 'info',
      code: 'steering-globs-overridden',
      message: `${count(overridden.length, 'rule pack')} ${overridden.length === 1 ? 'uses' : 'use'} the file patterns from assets/language-globs.json instead of the ones in the rules (${overridden.join(', ')})`,
    });
  }

  // Everything that is always on is sent with every request, so the total has a limit.
  const bytes = alwaysOn.reduce((sum, file) => sum + file.bytes, 0);
  if (bytes > ALWAYS_ON_LIMIT_BYTES) {
    const biggest = [...alwaysOn].sort((a, b) => b.bytes - a.bytes).slice(0, 3).map((file) => `${file.dest.split('/').pop()} ${file.bytes}`);
    problems.push({
      code: 'always-on-too-large',
      message: `the always-on steering is ${bytes} bytes, over the limit of ${ALWAYS_ON_LIMIT_BYTES}; it is sent with every request (largest: ${biggest.join(', ')})`,
    });
  }

  const sum = (key) => packs.reduce((total, pack) => total + pack[key], 0);
  const details = {
    steering: {
      files: planned.length,
      adapter: { files: adapterEntries.length, ...inclusions, references },
      packs: { files: packs.length, sources: sum('files'), overridden, linksMapped: sum('linksMapped'), linksUnlinked: sum('linksUnlinked') },
      baseline: { files: agentsFile === null ? 1 : 2, rosterRows: agentsFile?.rosterRows ?? 0, fromDescriptions: filledIn, dropped: leftOut },
      alwaysOn: { files: alwaysOn.length, bytes, limit: ALWAYS_ON_LIMIT_BYTES },
    },
  };
  return { planned, problems, notes, details };
}

// ---- the commands part -----------------------------------------------------------

/** The data files the commands part cannot run without, in assets/commands. */
export const COMMAND_ASSET_FILES = Object.freeze({ classes: 'classes.json', rules: 'rewrite-rules.json', snippets: 'snippets.json', lint: 'lint-patterns.json' });
const COMMAND_ASSET_CHECKS = Object.freeze({ classes: validateClasses, rules: validateRewriteRules, snippets: validateSnippets, lint: validateLintPatterns });

const sum = (values) => values.reduce((total, value) => total + value, 0);
const nameList = (names, limit = 12) => (names.length <= limit ? names.join(', ') : `${names.slice(0, limit).join(', ')} and ${names.length - limit} more`);

/**
 * Every ECC command is in one of four states.
 * - skipped: a skill of the same name is installed and gives the entry, so no command is written.
 * - registered: a steering file /ecc-<name>. Class A commands, after the rewrite rules; a command
 *   with a current overlay; and quality-gate, which the engine builds. The lint must pass or the plan stops.
 * - pending: class B and C commands without a current overlay. They are listed, not installed.
 * The scripts of the Kiro adapter (quality-gate.sh and format.sh) are installed next to them.
 */
function buildCommands({ profile, sourceFiles, sourceExecutable, existing, commandAssets }) {
  const planned = [];
  const problems = [];
  const notes = [];
  const entriesOf = (category) => profile.entries.filter((entry) => entry.category === category);
  const count = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const assets = commandAssets ?? {};

  // The data: every file must be there and valid, or nothing can be built or checked.
  for (const [key, file] of Object.entries(COMMAND_ASSET_FILES)) {
    const where = `assets/commands/${file}`;
    if (assets[key] === undefined) problems.push({ code: 'command-assets-missing', message: `${where} was not found in the skill folder`, path: where });
    else for (const found of COMMAND_ASSET_CHECKS[key](assets[key])) problems.push({ code: found.code, message: `${where}: ${found.message}`, path: where });
  }
  if (problems.length > 0) return { planned, problems, notes, details: null };

  const readText = (entry) => {
    const bytes = sourceFiles.get(entry.path);
    if (bytes === undefined) {
      problems.push({ code: 'source-missing', message: `${entry.path} was not read from the ECC source`, path: entry.path });
      return null;
    }
    try {
      return decodeSource(bytes, entry.path);
    } catch (error) {
      problems.push({ code: error.code, message: error.message, path: entry.path });
      return null;
    }
  };

  // The scripts of ECC's Kiro adapter. Their execute bit is the one they have in the checkout.
  const scripts = new Set();
  for (const entry of entriesOf('adapter-script')) {
    const bytes = sourceFiles.get(entry.path);
    if (bytes === undefined) {
      problems.push({ code: 'source-missing', message: `${entry.path} was not read from the ECC source`, path: entry.path });
      continue;
    }
    const file = {
      dest: scriptDest(entry.path.slice(entry.path.lastIndexOf('/') + 1)),
      content: bytes,
      sha256: sha256Hex(bytes),
      source: entry.path,
      category: SCRIPT_CATEGORY,
      part: 'commands',
    };
    if (sourceExecutable.has(entry.path)) file.mode = EXECUTABLE_MODE;
    planned.push(file);
    scripts.add(file.dest);
  }

  const commands = [];
  for (const entry of entriesOf('command')) {
    const text = readText(entry);
    if (text === null) continue;
    try {
      commands.push({ ...parseCommand({ path: entry.path, text }), sha256: entry.sha256 });
    } catch (error) {
      if (!(error instanceof CodedError)) throw error;
      problems.push({ code: error.code, message: error.message, path: entry.path });
    }
  }

  const classes = assets.classes.commands;
  const installedSkills = new Set(entriesOf('skill').map((entry) => entry.skill));
  const skipped = [];
  for (const command of commands) {
    const entry = classes[command.name];
    if (entry === undefined) {
      problems.push({ code: 'command-class-missing', message: `${command.name} has no class in assets/commands/classes.json`, path: command.path });
    } else if (entry.skill !== undefined) {
      if (installedSkills.has(entry.skill)) skipped.push({ name: command.name, skill: entry.skill });
      else problems.push({ code: 'command-skill-missing', message: `${command.name} is left to the skill "${entry.skill}", which is not installed`, path: command.path });
    }
  }
  const skippedNames = new Set(skipped.map((item) => item.name));
  const names = commands.filter((command) => !skippedNames.has(command.name)).map((command) => command.name);

  const compiled = compileRewriteRules(assets.rules, { commands: names, installedSkills });
  const lint = compileLintPatterns(assets.lint.patterns, { commands: names, uninstalledSkills: compiled.uninstalledSkills });

  // Overlays: used while the hash in the header is the hash of the ECC file, else reported.
  const overlays = new Map();
  const overlayStatus = [];
  const byName = new Map(commands.map((command) => [command.name, command]));
  for (const [name, text] of [...(assets.overlays ?? new Map())].sort(([a], [b]) => compareStrings(a, b))) {
    const command = byName.get(name);
    if (command === undefined) {
      overlayStatus.push({ name, status: 'orphan' });
      continue;
    }
    try {
      const overlay = parseOverlay({ name, text });
      if (overlay.sha256 === command.sha256) overlays.set(name, overlay);
      overlayStatus.push({ name, status: overlay.sha256 === command.sha256 ? 'used' : 'stale' });
    } catch (error) {
      if (!(error instanceof CodedError)) throw error;
      problems.push({ code: error.code, message: error.message, path: `assets/commands/overlays/${name}.md` });
    }
  }

  const render = (command, overlay, builtin) => {
    if (overlay !== null) {
      const description = overlay.description ?? applyRewriteRules(command.description, compiled.rules, { name: command.name, check: false }).text;
      return { ...renderCommand({ name: command.name, description, hint: command.hint, body: overlay.body, credit: overlay.credit, snippets: assets.snippets }), applied: {}, protectedLines: 0 };
    }
    if (builtin) {
      const parts = qualityGateParts({ script: scriptDest('quality-gate.sh'), format: scriptDest('format.sh') });
      return { ...renderCommand({ name: command.name, snippets: assets.snippets, ...parts }), applied: {}, protectedLines: 0 };
    }
    const body = applyRewriteRules(command.body, compiled.rules, { name: command.name });
    const description = applyRewriteRules(command.description, compiled.rules, { name: command.name, check: false }).text;
    return {
      ...renderCommand({ name: command.name, description, hint: command.hint, agent: command.agent, body: body.text, appended: body.appended, snippets: assets.snippets }),
      applied: body.applied,
      protectedLines: body.protectedLines,
    };
  };

  const registered = [];
  const pending = [];
  const stillClaudeSpecific = {};
  const applied = {};
  let protectedCount = 0;
  let changed = 0;
  let linted = 0;
  for (const command of commands) {
    const entry = classes[command.name];
    if (entry === undefined || skippedNames.has(command.name)) continue;
    const overlay = overlays.get(command.name) ?? null;
    const builtin = overlay === null && entry.builtin === QUALITY_GATE;
    const register = overlay !== null || builtin || entry.class === 'A';
    if (builtin && !scripts.has(scriptDest('quality-gate.sh'))) {
      problems.push({ code: 'command-script-missing', message: `${command.name} runs ${scriptDest('quality-gate.sh')}, which the profile does not provide`, path: command.path });
      continue;
    }
    let rendered;
    let hits = [];
    let required = [];
    try {
      rendered = render(command, overlay, builtin);
      hits = lintCommand(rendered.content, lint);
      required = requiredProblems(rendered.content, rendered.header);
    } catch (error) {
      if (!(error instanceof CodedError)) throw error;
      if (register) problems.push({ code: error.code, message: error.message, path: command.path });
      else stillClaudeSpecific[command.name] = ['rewrite-failed'];
      if (!register) linted += 1;
      continue;
    }
    if (register) {
      if (hits.length > 0 || required.length > 0) {
        const why = [...(hits.length > 0 ? [`the text still has Claude Code wording (${hits.join(', ')})`] : []), ...required].join('; ');
        problems.push({ code: 'command-lint', message: `${command.name} is not installed: ${why}`, path: command.path });
        continue;
      }
      planned.push({
        dest: rendered.dest,
        content: rendered.content,
        sha256: sha256Hex(rendered.content),
        source: builtin ? [command.path, '.kiro/scripts/quality-gate.sh'] : command.path,
        category: COMMAND_CATEGORY,
        part: 'commands',
      });
      registered.push({ ...command, fromOverlay: overlay !== null, builtin });
      for (const [id, n] of Object.entries(rendered.applied)) applied[id] = (applied[id] ?? 0) + n;
      protectedCount += rendered.protectedLines;
      if (Object.keys(rendered.applied).length > 0) changed += 1;
    } else {
      linted += 1;
      if (hits.length > 0) stillClaudeSpecific[command.name] = hits;
      const hasStaleOverlay = overlayStatus.some((item) => item.name === command.name && item.status === 'stale');
      pending.push({ name: command.name, class: entry.class, reason: entry.reason, missing: entry.missing, ...(entry.design === undefined ? {} : { design: entry.design }), ...(hasStaleOverlay ? { overlay: 'stale' } : {}) });
    }
  }
  linted += registered.length;

  // Names: the /ecc-<name> names against skills, agents, other steering, Kiro's own commands and the user's.
  const steering = new Set([
    ...entriesOf('adapter-steering').map((entry) => steeringName(entry.name)),
    ...Object.keys(PACKS).filter((pack) => profile.entries.some((entry) => entry.category === 'rule' && entry.pack === pack)).map((pack) => steeringName(packStem(pack))),
    steeringName(AGENTS_STEM),
    steeringName(HARNESS_STEM),
  ]);
  const agents = new Set(entriesOf('agent').map((entry) => entry.name));
  const { collisions, avoided } = findNameCollisions({ commands: names, skills: installedSkills, agents, steering, globalSkills: existing.globalSkills, globalAgents: existing.globalAgents });
  for (const found of collisions) problems.push({ code: 'command-name-collision', message: `${found.name} is also ${found.with}, so the command cannot be registered under that name` });

  const dropped = droppedSettings(registered);
  const stale = overlayStatus.filter((item) => item.status === 'stale').map((item) => item.name);
  const orphan = overlayStatus.filter((item) => item.status === 'orphan').map((item) => item.name);
  const pendingClasses = { B: pending.filter((item) => item.class === 'B').length, C: pending.filter((item) => item.class === 'C').length };

  if (pending.length > 0) {
    notes.push({
      level: 'info',
      code: 'commands-pending',
      message: `${count(pending.length, 'command')} ${pending.length === 1 ? 'is' : 'are'} pending and not installed: ${pendingClasses.B} need a Kiro-native rewrite (class B) and ${pendingClasses.C} need a piece this install does not have (class C). details.commands.pending says what each one needs`,
    });
  }
  if (skipped.length > 0) {
    notes.push({
      level: 'info',
      code: 'commands-skipped',
      message: `${count(skipped.length, 'command')} not registered because an installed skill of the same name gives the entry (${skipped.map((item) => `${item.name}: /${item.skill}`).join(', ')})`,
    });
  }
  if (stale.length > 0) {
    notes.push({ level: 'warn', code: 'command-overlay-stale', message: `${count(stale.length, 'overlay')} in assets/commands/overlays ${stale.length === 1 ? 'is' : 'are'} out of date (${stale.join(', ')}): the ECC file changed after ${stale.length === 1 ? 'it was' : 'they were'} written, so the ECC text is used or the command stays pending` });
  }
  if (orphan.length > 0) {
    notes.push({ level: 'warn', code: 'command-overlay-orphan', message: `${count(orphan.length, 'overlay')} in assets/commands/overlays name${orphan.length === 1 ? 's' : ''} no ECC command (${orphan.join(', ')}); ${orphan.length === 1 ? 'it is' : 'they are'} ignored` });
  }
  const droppedKeys = Object.entries(dropped);
  if (droppedKeys.length > 0) {
    notes.push({
      level: 'info',
      code: 'command-fields-dropped',
      message: `Claude Code settings that Kiro steering has no equivalent for are left out: ${droppedKeys.map(([key, list]) => `${key} (${nameList(list)})`).join('; ')}`,
    });
  }
  if (avoided.length > 0) {
    notes.push({
      level: 'info',
      code: 'command-names',
      message: `checked the ${count(names.length, 'command name')} against ${installedSkills.size} skills, ${agents.size} agents, ${steering.size} steering files and ${KIRO_BUILTIN_COMMANDS.length} Kiro commands: no clash. Without the ecc- prefix ${nameList(avoided.map((item) => `${item.name} (${item.with})`))} would clash`,
    });
  }

  const stillNames = Object.keys(stillClaudeSpecific).sort(compareStrings);
  const details = {
    commands: {
      total: commands.length,
      registered: registered.length,
      clean: linted - stillNames.length,
      stillClaudeSpecific: stillNames,
      matches: Object.fromEntries(stillNames.map((name) => [name, stillClaudeSpecific[name]])),
      withOverlay: registered.filter((item) => item.fromOverlay).length,
      overlays: overlayStatus,
      pending: pending.sort((a, b) => compareStrings(a.name, b.name)),
      skipped,
      rewrites: { commandsChanged: changed, replacements: sum(Object.values(applied)), byRule: Object.fromEntries(Object.entries(applied).sort(([a], [b]) => compareStrings(a, b))), protectedLines: protectedCount },
      scripts: [...scripts].sort(compareStrings),
      names: { checked: { skills: installedSkills.size, agents: agents.size, steering: steering.size, builtins: KIRO_BUILTIN_COMMANDS.length }, collisions, avoided },
      dropped,
    },
  };
  return { planned, problems, notes, details };
}

// ---- the hooks part --------------------------------------------------------------

/**
 * The hooks of ECC's Kiro adapter as Kiro v1 hook files, every one switched off, and the script that the
 * git push hook runs. The converter (lib/hooks.mjs) checks each hook against the v1 format, and a hook that
 * fails stops the plan. A hook that is started by hand (quality-gate) has no v1 trigger and is left out:
 * the commands part installs it as /ecc-quality-gate.
 */
function buildHooks({ profile, sourceFiles, hookAssets }) {
  const planned = [];
  const problems = [];
  const notes = [];
  const count = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

  const entries = profile.entries.filter((entry) => entry.category === 'adapter-hook');
  const converted = [];
  const skipped = [];
  for (const entry of entries) {
    const bytes = sourceFiles.get(entry.path);
    if (bytes === undefined) {
      problems.push({ code: 'source-missing', message: `${entry.path} was not read from the ECC source`, path: entry.path });
      continue;
    }
    let result;
    try {
      result = convertHook({ path: entry.path, text: decodeSource(bytes, entry.path) });
    } catch (error) {
      if (!(error instanceof CodedError)) throw error;
      problems.push({ code: error.code, message: error.message, path: entry.path });
      continue;
    }
    if (result.skipped) {
      skipped.push({ name: result.name, reason: result.skipped.reason });
      continue;
    }
    // Two hooks with one name would be written to one path, which buildPlanned reports as dest-duplicate.
    converted.push(result);
    planned.push({ dest: result.dest, content: result.content, sha256: sha256Hex(result.content), source: entry.path, category: HOOK_CATEGORY, part: 'hooks' });
  }

  // The script is this tool's own text, read from the skill folder. It is installed only when a hook runs it.
  const scripts = [];
  if (converted.some((item) => item.usesGuard)) {
    if (typeof hookAssets?.guard !== 'string' || hookAssets.guard === '') {
      problems.push({ code: 'hook-assets-missing', message: `${GUARD_SOURCE} was not found in the skill folder, and the git push hook runs it`, path: GUARD_SOURCE });
    } else {
      planned.push({ dest: GUARD_DEST, content: hookAssets.guard, sha256: sha256Hex(hookAssets.guard), source: null, category: HOOK_SCRIPT_CATEGORY, part: 'hooks' });
      scripts.push(GUARD_DEST);
    }
  }

  const agentActions = converted.filter((item) => item.hook.action.type === 'agent').length;
  const commandActions = converted.length - agentActions;
  const adapted = converted.filter((item) => item.adapted !== null).map((item) => ({ name: item.name, why: item.adapted }));
  if (converted.length > 0) {
    notes.push({
      level: 'info',
      code: 'hooks-disabled',
      message:
        `${count(converted.length, 'hook')} ${converted.length === 1 ? 'is' : 'are'} installed switched off. Turn one on in the Agent Hooks panel of the IDE, or set "enabled" to true in its file in .kiro/hooks. ` +
        `${agentActions} run${agentActions === 1 ? 's' : ''} an agent prompt, which uses credits each time the hook fires; ${commandActions} run${commandActions === 1 ? 's' : ''} a script and use${commandActions === 1 ? 's' : ''} none`,
    });
  }
  if (adapted.length > 0) {
    notes.push({
      level: 'info',
      code: 'hooks-adapted',
      message: `${count(adapted.length, 'hook')} differ${adapted.length === 1 ? 's' : ''} from a one to one conversion (${adapted.map((item) => item.name).join(', ')}); details.hooks.adapted says why`,
    });
  }
  if (skipped.length > 0) {
    const gate = skipped.some((item) => item.name === 'quality-gate');
    notes.push({
      level: 'info',
      code: 'hooks-skipped',
      message: `${count(skipped.length, 'hook')} not converted (${skipped.map((item) => item.name).join(', ')}): a hook that is started by hand has no v1 trigger${gate ? '. The commands part installs quality-gate as /ecc-quality-gate' : ''}`,
    });
  }

  const details = {
    hooks: {
      total: entries.length,
      converted: converted.length,
      disabled: converted.filter((item) => item.hook.enabled === false).length,
      agentActions,
      commandActions,
      byTrigger: tally(converted.map((item) => item.hook.trigger)),
      adapted,
      skipped,
      scripts,
    },
  };
  return { planned, problems, notes, details };
}

// ---- the owned part ------------------------------------------------------------------

/**
 * The pieces this tool writes itself: three scripts, the hook files that run them (hookify and the instinct
 * observer, both switched off), three read-only panel agents, and the orch-review workflow recipe. The panel
 * agents get a `model:` from the local model list where one is known and none where it is not.
 */
function buildOwned({ profile, ownedAssets, models }) {
  const notes = [];
  const parsed = typeof models === 'string' ? parseModelList(models) : Array.isArray(models) ? models : null;
  const agentNames = profile.entries.filter((entry) => entry.category === 'agent').map((entry) => entry.name);
  const built = buildOwnedFiles({ scripts: ownedAssets?.scripts ?? {}, models: parsed, agentNames, hash: sha256Hex });

  const hookFiles = built.planned.filter((file) => file.category === 'owned-hook');
  const hookCount = hookFiles.reduce((sum, file) => sum + JSON.parse(file.content).hooks.length, 0);
  notes.push({
    level: 'info',
    code: 'owned-hooks-disabled',
    message:
      `${hookCount} owned hooks in ${hookFiles.length} files are installed switched off: hookify (4 hooks, a script, no credits) and the instinct observer (2 hooks, ECC's observe.sh, no credits). ` +
      'Turn one on in the Agent Hooks panel of the IDE, or set "enabled" to true in its file in .kiro/hooks',
  });
  const set = built.agents.filter((agent) => agent.model !== null);
  notes.push({
    level: 'info',
    code: 'panel-models',
    message: built.modelsKnown
      ? `panel agents: ${built.agents.map((agent) => `${agent.name} ${agent.model === null ? 'has no model: line (no match in the local model list), so it uses the session model' : `uses ${agent.model}`}`).join('; ')}. Whether a sub-agent applies the model: of its agent file is not proven`
      : 'the local model list could not be read (kiro-cli chat --list-models), so the three panel agents have no model: line and use the model of the session',
  });
  if (built.missingAgents.length > 0) {
    notes.push({
      level: 'warn',
      code: 'owned-workflow-agents',
      message: `the orch-review recipe names ${built.missingAgents.length === 1 ? 'an agent' : 'agents'} that ${built.missingAgents.length === 1 ? 'is' : 'are'} not in this install (${built.missingAgents.join(', ')}); a step that names a missing agent fails when the workflow starts, so ${built.missingAgents.length === 1 ? 'it must' : 'they must'} exist in .kiro/agents or in your own agents folder`,
    });
  }
  const details = {
    owned: {
      missingAgents: built.missingAgents,
      scripts: built.planned.filter((file) => file.category === 'owned-script').map((file) => file.dest),
      hooks: hookFiles.map((file) => ({ file: file.dest, names: JSON.parse(file.content).hooks.map((hook) => hook.name) })),
      agents: built.agents,
      workflows: built.planned.filter((file) => file.category === 'owned-workflow').map((file) => file.dest),
      modelsKnown: built.modelsKnown,
      modelsSet: set.length,
    },
  };
  return { planned: built.planned, problems: built.problems, notes, details };
}

// ---- the mcp part ------------------------------------------------------------------

/**
 * The MCP server examples: the catalog of ECC and the example of its Kiro adapter, as one file in the shape of
 * Kiro's mcp.json with every server switched off, and a table of what each server is. Both go to .kiro/ecc/.
 * They never go to .kiro/settings, where Kiro would start the servers (and the agent may not write anyway).
 */
function buildMcpExamples({ profile, sourceFiles }) {
  const planned = [];
  const problems = [];
  const notes = [];
  const sources = {};
  for (const [key, category] of [['catalog', 'mcp-catalog'], ['adapter', 'adapter-mcp-example']]) {
    const entry = profile.entries.find((item) => item.category === category);
    if (entry === undefined) {
      problems.push({ code: 'mcp-source-missing', message: `the profile has no ${category} file, so the MCP examples cannot be written` });
      continue;
    }
    const bytes = sourceFiles.get(entry.path);
    if (bytes === undefined) {
      problems.push({ code: 'source-missing', message: `${entry.path} was not read from the ECC source`, path: entry.path });
      continue;
    }
    try {
      sources[key] = { path: entry.path, text: decodeSource(bytes, entry.path) };
    } catch (error) {
      if (!(error instanceof CodedError)) throw error;
      problems.push({ code: error.code, message: error.message, path: entry.path });
    }
  }
  if (problems.length > 0) return { planned, problems, notes, details: null };

  let converted;
  try {
    converted = convertMcp(sources);
  } catch (error) {
    if (!(error instanceof CodedError)) throw error;
    return { planned, problems: [{ code: error.code, message: error.message }], notes, details: null };
  }
  const source = [sources.catalog.path, sources.adapter.path];
  for (const [dest, content] of [[MCP_EXAMPLE_DEST, converted.example], [MCP_TABLE_DEST, converted.table]]) {
    planned.push({ dest, content, sha256: sha256Hex(content), source, category: MCP_CATEGORY, part: 'mcp' });
  }

  const { summary } = converted;
  notes.push({
    level: 'info',
    code: 'mcp-examples',
    message:
      `${summary.servers} MCP servers are written to ${MCP_EXAMPLE_DEST}, every one with "disabled": true, and a table of what they are to ${MCP_TABLE_DEST}. ` +
      'Kiro reads neither file. To use a server, copy its entry into .kiro/settings/mcp.json yourself; Kiro does not let the agent write there',
  });
  const left = Object.entries(summary.left);
  if (left.length > 0) {
    notes.push({
      level: 'info',
      code: 'mcp-left-out',
      message: `left out of the entries: ${left.map(([key, n]) => `${key} (${n})`).join(', ')}. Kiro does not use description and type, and autoApprove would approve tools without asking`,
    });
  }
  const details = {
    mcp: {
      servers: summary.servers,
      fromCatalog: summary.fromCatalog,
      fromAdapter: summary.fromAdapter,
      local: summary.local,
      remote: summary.remote,
      left: summary.left,
      files: [MCP_EXAMPLE_DEST, MCP_TABLE_DEST],
    },
  };
  return { planned, problems, notes, details };
}

// ---- the license part ---------------------------------------------------------------

/** ECC's LICENSE, copied as it is, and the notices that name ECC's release and the projects its files credit. */
function buildLicense({ profile, sourceFiles }) {
  const entry = profile.entries.find((item) => item.category === 'license');
  if (entry === undefined) {
    return { planned: [], problems: [{ code: 'license-missing', message: 'the profile has no ECC LICENSE file, so the license cannot be installed' }], notes: [], details: null };
  }
  const bytes = sourceFiles.get(entry.path);
  if (bytes === undefined) {
    return { planned: [], problems: [{ code: 'source-missing', message: `${entry.path} was not read from the ECC source`, path: entry.path }], notes: [], details: null };
  }
  const notices = buildNotices({ licenseSha256: entry.sha256 });
  const planned = [
    { dest: LICENSE_DEST, content: bytes, sha256: sha256Hex(bytes), source: entry.path, category: LICENSE_CATEGORY, part: 'license' },
    { dest: NOTICES_DEST, content: notices, sha256: sha256Hex(notices), source: null, category: LICENSE_CATEGORY, part: 'license' },
  ];
  return { planned, problems: [], notes: [], details: { license: { files: [LICENSE_DEST, NOTICES_DEST], licenseSha256: entry.sha256 } } };
}

// ---- the isolation part --------------------------------------------------------------

/**
 * A managed block in .kiroignore that hides the folders of other harnesses from Kiro, so their
 * instructions are not read next to the ECC steering. Only folders that exist are listed.
 */
function buildIsolation({ harnessDirs }) {
  const folders = [...new Set(harnessDirs)].sort(compareStrings);
  if (folders.length === 0) {
    const notes = [{ level: 'info', code: 'isolation-none', message: `no folder of another harness was found in the project, so ${KIROIGNORE_FILE} is left alone` }];
    return { planned: [], problems: [], notes, details: { isolation: { folders, block: false } } };
  }
  const block = buildBlock(folders);
  const planned = [{ dest: KIROIGNORE_FILE, content: block, sha256: sha256Hex(block), source: null, category: KIROIGNORE_CATEGORY, part: 'isolation' }];
  const notes = [
    {
      level: 'info',
      code: 'isolation-ide',
      message:
        `a block in ${KIROIGNORE_FILE} asks Kiro to ignore ${folders.join(', ')}. The IDE reads only the ignore files named in its Agent Ignore Files setting (kiroAgent.agentIgnoreFiles), so add ${KIROIGNORE_FILE} there. ` +
        `kiro-cli 2.28.0 with --v3 did not enforce ${KIROIGNORE_FILE} in a headless test`,
    },
  ];
  return { planned, problems: [], notes, details: { isolation: { folders, block: true } } };
}

// ---- the parts -----------------------------------------------------------------

/**
 * The parts of an install, in the order they run. A part names the ECC files it reads
 * (`profileCategories`, narrowed by `select` when it needs only some of them), the kind of file it
 * writes (`installCategories`), and how to build them.
 */
export const PARTS = Object.freeze({
  agents: {
    summary: 'the 68 ECC agents, converted to Kiro custom agents in .kiro/agents',
    profileCategories: ['agent'],
    installCategories: ['agent'],
    build: buildAgents,
  },
  skills: {
    summary: 'the 88 ECC skills (the Kimi set and the six orch-* extras), copied unchanged into .kiro/skills',
    profileCategories: ['skill'],
    installCategories: ['skill'],
    build: buildSkills,
  },
  steering: {
    summary: 'ECC steering in .kiro/steering: the 22 adapter files fixed for Kiro, 11 language rule packs, and the always-on baseline',
    // The agents are read for the roster rows AGENTS.md leaves out. The skills are only counted and named, from the profile.
    profileCategories: ['adapter-steering', 'rule', 'agents-md', 'agent'],
    select: (entry) => (entry.category === 'rule' ? Object.hasOwn(PACKS, entry.pack) : true),
    installCategories: [STEERING_CATEGORY],
    build: buildSteering,
  },
  commands: {
    summary: 'the ECC commands as /ecc-<name> manual steering in .kiro/steering (class A, after the rewrite rules and the lint), with the scripts of the Kiro adapter in .kiro/ecc/scripts',
    // The skills, agents and steering are only named, from the profile, to check the command names.
    profileCategories: ['command', 'adapter-script'],
    installCategories: [COMMAND_CATEGORY, SCRIPT_CATEGORY],
    build: buildCommands,
  },
  hooks: {
    summary: 'the ECC event hooks as Kiro v1 hook files in .kiro/hooks, every one switched off, with the script the git push hook runs in .kiro/ecc/scripts',
    profileCategories: ['adapter-hook'],
    installCategories: [HOOK_CATEGORY, HOOK_SCRIPT_CATEGORY],
    build: buildHooks,
  },
  owned: {
    summary: 'what this tool writes itself: hookify and the instinct observer as switched-off hooks with their scripts, usage-report and feature-check scripts, three read-only panel agents, and the orch-review workflow recipe',
    // It reads the skill folder and the local model list, not the ECC source. The agents are only named, from the profile.
    profileCategories: [],
    installCategories: OWNED_CATEGORIES,
    build: buildOwned,
  },
  mcp: {
    summary: 'the MCP server examples of ECC in .kiro/ecc/mcp.json.example, every server switched off, with a table of what they are',
    profileCategories: ['mcp-catalog', 'adapter-mcp-example'],
    installCategories: [MCP_CATEGORY],
    build: buildMcpExamples,
  },
  license: {
    summary: "ECC's MIT license and the third-party notices in .kiro/ecc",
    profileCategories: ['license'],
    installCategories: [LICENSE_CATEGORY],
    build: buildLicense,
  },
  isolation: {
    summary: 'a managed block in .kiroignore that hides the folders of other harnesses, only the ones that exist',
    // It reads the project, not the ECC source.
    profileCategories: [],
    installCategories: [KIROIGNORE_CATEGORY],
    build: buildIsolation,
  },
});

export const PART_ORDER = Object.freeze(Object.keys(PARTS));

/**
 * Turn `--only a,b` into part names in run order. No value means every part this build has.
 * @param {string | undefined} only
 */
export function resolveParts(only) {
  if (only === undefined) return [...PART_ORDER];
  const wanted = only.split(',').map((item) => item.trim());
  if (wanted.some((item) => item === '')) throw new UsageError('--only needs part names separated by commas');
  for (const name of wanted) {
    if (!Object.hasOwn(PARTS, name)) throw new UsageError(`unknown part "${name}" for --only (available in this build: ${PART_ORDER.join(', ')})`);
  }
  return PART_ORDER.filter((name) => wanted.includes(name));
}

/** Whether a part reads this profile entry. */
const partReads = (part, entry) => part.profileCategories.includes(entry.category) && (part.select === undefined || part.select(entry));

/** The profile entries the given parts read. */
export function entriesFor(parts, profile) {
  return profile.entries.filter((entry) => parts.some((name) => partReads(PARTS[name], entry)));
}

/** The install categories the given parts own: the scope of a reconcile. */
export function scopeFor(parts) {
  return new Set(parts.flatMap((name) => PARTS[name].installCategories));
}

/**
 * Build every file the chosen parts install.
 * @param {object} input
 * @param {string[]} input.parts
 * @param {{ entries: any[] }} input.profile
 * @param {Map<string, Uint8Array>} input.sourceFiles ECC path -> bytes, already checked against the profile
 * @param {Set<string>} [input.sourceExecutable] ECC paths that are executable in the checkout
 * @param {{ globalAgents?: Set<string>, globalSkills?: Set<string> }} [input.existing] what the machine already has, for warnings
 * @param {{ classes?: any, rules?: any, snippets?: any, lint?: any, overlays?: Map<string, string> }} [input.commandAssets] the data files of assets/commands and the text of each overlay
 * @param {{ guard?: string }} [input.hookAssets] the text of scripts/runtime/git-push-guard.mjs, which the git push hook runs
 * @param {{ scripts?: Record<string, string> }} [input.ownedAssets] the texts of the scripts in scripts/runtime that the owned part installs
 * @param {string | object[] | null} [input.models] the output of kiro-cli chat --list-models -f json (or the parsed list), for the model: of the panel agents
 * @param {Record<string, string[]>} [input.languageGlobs] file patterns per rule pack that replace the ones in the rules (assets/language-globs.json)
 * @param {string[]} [input.harnessDirs] the folders of other harnesses that exist in the project, for the isolation part
 * @returns {{ planned: PlannedFile[], problems: Problem[], notes: Note[], details: Record<string, any> }}
 */
export function buildPlanned({ parts, profile, sourceFiles, sourceExecutable = new Set(), existing = {}, languageGlobs = {}, commandAssets, hookAssets, ownedAssets, models = null, harnessDirs = [] }) {
  const planned = [];
  const problems = [];
  const notes = [];
  const details = {};
  const context = {
    profile,
    sourceFiles,
    sourceExecutable,
    languageGlobs,
    commandAssets,
    hookAssets,
    ownedAssets,
    models,
    harnessDirs,
    existing: { globalAgents: existing.globalAgents ?? new Set(), globalSkills: existing.globalSkills ?? new Set() },
  };

  for (const name of parts) {
    const built = PARTS[name].build(context);
    planned.push(...built.planned);
    problems.push(...built.problems);
    notes.push(...built.notes);
    Object.assign(details, built.details ?? {});
  }

  const seen = new Set();
  for (const file of planned) {
    const why = managedPathProblem(file.dest);
    if (why) problems.push({ code: 'dest-unsafe', message: `${file.dest} ${why}`, path: file.dest });
    if (seen.has(file.dest)) problems.push({ code: 'dest-duplicate', message: `two files would be written to ${file.dest}`, path: file.dest });
    seen.add(file.dest);
  }
  return { planned: planned.sort((a, b) => compareStrings(a.dest, b.dest)), problems, notes, details };
}
