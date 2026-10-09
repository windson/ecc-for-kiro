// The two always-on files that replace Kimi's AGENTS.md for Kiro: ecc-agents.md and ecc-kiro-harness.md.
//
// ecc-agents.md keeps what AGENTS.md says about working principles and when to hand work to an
// agent, and adds the roster of agents. It is read from AGENTS.md at install time instead of being
// copied into this tool. ecc-kiro-harness.md is written here: it tells the model how the Claude
// Code wording found all over ECC maps to Kiro.
//
// Pure: text in, text out.

import { ECC_VERSION } from './constants.mjs';
import { CodedError } from './exit.mjs';
import { compareStrings } from './paths.mjs';
import { AGENTS_STEM, HARNESS_STEM, steeringDest, steeringName, writeSteering } from './steering.mjs';

const AGENT_NAME = /^[a-z0-9][a-z0-9-]*$/;
const ROSTER_HEADER = ['Agent', 'Purpose', 'When to Use'];
const FALLBACK_WHEN = 'See the agent description';
const MAX_PURPOSE_CHARS = 100;

// ---- reading AGENTS.md ------------------------------------------------------------------

/** The `## ` sections of a document, as lines with blank lines trimmed off both ends. Fenced blocks are skipped. */
function splitSections(text, where) {
  const sections = new Map();
  let current = null;
  let fenced = false;
  for (const line of text.split('\n')) {
    if (/^ {0,3}(?:`{3,}|~{3,})/.test(line)) fenced = !fenced;
    const heading = fenced ? null : /^## +(.+?) *$/.exec(line);
    if (heading !== null) {
      current = heading[1];
      if (sections.has(current)) throw new CodedError('agents-md-section', `${where}: the section "${current}" appears twice`);
      sections.set(current, []);
    } else if (current !== null) {
      sections.get(current).push(line);
    }
  }
  for (const lines of sections.values()) {
    while (lines.length > 0 && lines[0].trim() === '') lines.shift();
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
  }
  return sections;
}

function parseRoster(lines, where) {
  const rows = [];
  const seen = new Set();
  let header = false;
  for (const line of lines) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length !== ROSTER_HEADER.length) {
      throw new CodedError('agents-md-table', `${where}: a roster row needs ${ROSTER_HEADER.length} columns, found ${cells.length} in ${JSON.stringify(line.slice(0, 60))}`);
    }
    if (!header) {
      if (cells.join('|') !== ROSTER_HEADER.join('|')) throw new CodedError('agents-md-table', `${where}: the roster table should start with | ${ROSTER_HEADER.join(' | ')} |`);
      header = true;
      continue;
    }
    if (cells.every((cell) => /^:?-+:?$/.test(cell))) continue;
    const [name, purpose, when] = cells;
    if (!AGENT_NAME.test(name)) throw new CodedError('agents-md-table', `${where}: ${JSON.stringify(name)} is not an agent name`);
    if (seen.has(name)) throw new CodedError('agents-md-table', `${where}: the roster lists ${name} twice`);
    if (purpose === '' || when === '') throw new CodedError('agents-md-table', `${where}: the roster row for ${name} has an empty cell`);
    seen.add(name);
    rows.push({ name, purpose, when });
  }
  if (!header || rows.length === 0) throw new CodedError('agents-md-table', `${where}: no agent roster table found`);
  return rows;
}

/** ECC marks its agents `ecc:planner` because it ships as a Claude plugin. Here they are plain names. */
const dropPluginPrefix = (text) => text.replace(/\becc:(?=[a-z0-9])/g, '');

/**
 * Read the parts of AGENTS.md this install keeps.
 * @param {string} text
 * @param {string} where
 * @returns {{ principles: string, orchestration: string, roster: { name: string, purpose: string, when: string }[] }}
 */
export function parseAgentsMd(text, where = 'AGENTS.md') {
  const sections = splitSections(text, where);
  const need = (title) => {
    if (!sections.has(title) || sections.get(title).length === 0) {
      throw new CodedError('agents-md-section', `${where}: the section "${title}" was not found`, {
        fix: 'AGENTS.md changed. Check parseAgentsMd in lib/baseline.mjs.',
      });
    }
    return sections.get(title);
  };
  return {
    principles: dropPluginPrefix(need('Core Principles').join('\n')),
    orchestration: dropPluginPrefix(need('Agent Orchestration').join('\n')),
    roster: parseRoster(need('Available Agents'), where),
  };
}

// ---- ecc-agents.md -----------------------------------------------------------------------------

/** The first sentence of an agent description, short enough for one table cell. */
function purposeFrom(description) {
  const flat = description.replace(/\s+/g, ' ').replaceAll('|', '/').trim();
  const sentence = /^.*?[.!?](?=\s|$)/.exec(flat)?.[0] ?? flat;
  if (sentence.length <= MAX_PURPOSE_CHARS) return sentence.replace(/\.$/, '');
  const cut = sentence.slice(0, MAX_PURPOSE_CHARS);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 1)).trimEnd()}...`;
}

const rosterLine = ({ name, purpose, when }) => `| ${name} | ${purpose} | ${when} |`;

/**
 * ecc-agents.md.
 * @param {object} input
 * @param {string} input.agentsMd text of ECC's AGENTS.md
 * @param {string[]} input.agentNames the agents that get installed
 * @param {(name: string) => string | null} input.describeAgent the description of an agent; only asked for agents the roster leaves out
 * @param {number} input.skillCount number of skills that get installed
 */
export function buildAgentsSteering({ agentsMd, agentNames, describeAgent, skillCount, where = 'AGENTS.md' }) {
  const parsed = parseAgentsMd(agentsMd, where);
  const installed = new Set(agentNames);

  const listed = parsed.roster.filter((row) => installed.has(row.name));
  const dropped = parsed.roster.filter((row) => !installed.has(row.name)).map((row) => row.name);
  const have = new Set(listed.map((row) => row.name));
  const fromDescriptions = agentNames
    .filter((name) => !have.has(name))
    .sort(compareStrings)
    .map((name) => ({ name, purpose: purposeFrom(describeAgent(name) ?? '') || 'ECC agent', when: FALLBACK_WHEN }));
  const roster = [...listed, ...fromDescriptions];

  const body = [
    '',
    '# ECC agents and working principles',
    '',
    `ECC v${ECC_VERSION} gives this project ${agentNames.length} custom agents and ${skillCount} skills. This note is adapted from ECC's AGENTS.md for Kiro.`,
    '',
    '## Core principles',
    '',
    parsed.principles,
    '',
    '## Working with agents',
    '',
    'To use an agent, name it in your request, for example "Use the code-reviewer agent to review src/auth/". Kiro runs it as a sub-agent with its own context, and it can also pick an agent from the agent description.',
    '',
    parsed.orchestration,
    '',
    '## Agent roster',
    '',
    rosterLine({ name: ROSTER_HEADER[0], purpose: ROSTER_HEADER[1], when: ROSTER_HEADER[2] }),
    '|-------|---------|-------------|',
    ...roster.map(rosterLine),
    '',
  ].join('\n');

  const description = `ECC working principles, when to hand work to a custom agent, and the roster of ${agentNames.length} ECC agents.`;
  return {
    stem: AGENTS_STEM,
    name: steeringName(AGENTS_STEM),
    dest: steeringDest(AGENTS_STEM),
    content: writeSteering({ inclusion: 'always', name: steeringName(AGENTS_STEM), description, body }),
    inclusion: 'always',
    description,
    rosterRows: roster.length,
    fromDescriptions: fromDescriptions.map((row) => row.name),
    dropped,
  };
}

// ---- ecc-kiro-harness.md -------------------------------------------------------------------------

const HARNESS_ROWS = [
  ['Task tool, Agent tool, `subagent_type`', 'Hand the work to a custom agent by name, for example "Use the planner agent to ...". The agents are in `.kiro/agents`.'],
  ['TodoWrite', 'Keep the steps in a plan file such as `plan.md` and tick them off as you go.'],
  ['Read, Grep, Glob / Write, Edit / Bash / WebFetch, WebSearch', 'The Kiro tools `read` / `write` / `shell` / `web`.'],
  ['Skill tool', 'Kiro loads a skill when its description fits the task. Name the skill to be sure.'],
  ['`/plan`, `/code-review` and other ECC commands', '`/ecc-plan`, `/ecc-code-review`. Type `/` to list the ones installed.'],
  ['`~/.claude/...`, `$CLAUDE_PLUGIN_ROOT`', '`~/.kiro/...` for personal files. ECC skills and their scripts are in `.kiro/skills/<name>/`, for example `.kiro/skills/continuous-learning-v2/scripts/instinct-cli.py`.'],
  ['`$CLAUDE_FILE_PATHS` in a hook command', '`{{filePath}}` in the command of a PostFileSave or PostFileCreate hook. Kiro also sends the path as JSON on the command\'s stdin.'],
  ['CLAUDE.md', 'Steering files in `.kiro/steering`, and AGENTS.md.'],
  ['`$ARGUMENTS`', 'The text the user typed after the slash command.'],
  ['Hook events PreToolUse, PostToolUse, UserPromptSubmit, Stop, SessionStart', 'Kiro hook triggers with the same names, in `.kiro/hooks/*.json`. A file edit is PostFileSave and a new file is PostFileCreate. Tool matchers use `shell`, `write` and `read`. ECC hooks ship switched off.'],
  ['`model: opus`, `sonnet`, `haiku`', 'The model of the current session. ECC\'s model choices are not used.'],
  ['`ecc:planner` and other plugin-prefixed names', 'The plain name, for example `planner`.'],
  ['`configure-ecc` skill', 'Use the `ecc-kiro-setup` skill in Kiro. `configure-ecc` is for other harnesses.'],
  [
    '`ecc-guide` skill: `README.md`, `agent.yaml`, `manifests/`, `commands/`, `skills/`, `agents/`, `hooks/hooks.json`, `node scripts/...`',
    'These are paths of the ECC repository, which a Kiro project does not have. Read `.kiro/skills/*/SKILL.md`, `.kiro/agents/*.md`, `.kiro/steering/ecc-*.md` (rules and commands), `.kiro/hooks/*.json` and `.kiro/ecc/install-state.json` (what is installed) instead. For install questions use `ecc-kiro-setup`.',
  ],
];

/** ecc-kiro-harness.md: how Claude Code wording maps to Kiro. */
export function buildHarnessSteering() {
  const description = 'How Claude Code wording in ECC agents, skills, rules and commands maps to Kiro.';
  const body = [
    '',
    '# ECC on Kiro',
    '',
    `ECC v${ECC_VERSION} was written for Claude Code. This project runs it in Kiro, so read the Claude wording in ECC agents, skills, rules and commands like this.`,
    '',
    '| ECC says | In Kiro |',
    '|---|---|',
    ...HARNESS_ROWS.map(([says, kiro]) => `| ${says} | ${kiro} |`),
    '',
    'Rules that show hook setup for `~/.claude/settings.json` list checks worth automating. Create them as Kiro hooks.',
    '',
  ].join('\n');
  return {
    stem: HARNESS_STEM,
    name: steeringName(HARNESS_STEM),
    dest: steeringDest(HARNESS_STEM),
    content: writeSteering({ inclusion: 'always', name: steeringName(HARNESS_STEM), description, body }),
    inclusion: 'always',
    description,
  };
}
