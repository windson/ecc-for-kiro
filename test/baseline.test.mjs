import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildAgentsSteering, buildHarnessSteering, parseAgentsMd } from '../skills/ecc-kiro-setup/scripts/lib/baseline.mjs';
import { CodedError } from '../skills/ecc-kiro-setup/scripts/lib/exit.mjs';
import { parseFrontmatter } from '../skills/ecc-kiro-setup/scripts/lib/frontmatter.mjs';

const codeOf = (fn) => {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof CodedError, `expected a CodedError, got ${error}`);
    return error.code;
  }
  return assert.fail('expected a throw');
};

const TABLE = [
  '| Agent | Purpose | When to Use |',
  '|-------|---------|-------------|',
  '| planner | Planning | Complex features |',
  '| code-reviewer | Review | After writing code |',
].join('\n');

/** A synthetic AGENTS.md with the sections the install reads. */
const agentsMd = ({ table = TABLE, principles = '1. **First** — Do it\n2. **Second** — Do more', orchestration = '', extra = '' } = {}) => [
  '# Project — Agent Instructions',
  'An intro with 99 agents.',
  '',
  '## Core Principles',
  '',
  principles,
  '',
  '## Available Agents',
  '',
  table,
  '',
  '## Agent Orchestration',
  '',
  orchestration || 'Use agents proactively:\n- Big feature → **ecc:planner**\n- Code written → **ecc:code-reviewer**\n\nRun agents in parallel.',
  '',
  '## Security Guidelines',
  '',
  'Not kept.',
  extra,
].join('\n');

describe('parseAgentsMd', () => {
  it('reads the principles, the delegation rules and the roster, and drops the ecc: prefix', () => {
    const parsed = parseAgentsMd(agentsMd());
    assert.equal(parsed.principles, '1. **First** — Do it\n2. **Second** — Do more');
    assert.equal(parsed.orchestration, 'Use agents proactively:\n- Big feature → **planner**\n- Code written → **code-reviewer**\n\nRun agents in parallel.');
    assert.deepEqual(parsed.roster, [
      { name: 'planner', purpose: 'Planning', when: 'Complex features' },
      { name: 'code-reviewer', purpose: 'Review', when: 'After writing code' },
    ]);
  });

  it('leaves the other sections out', () => {
    const parsed = parseAgentsMd(agentsMd());
    assert.doesNotMatch(JSON.stringify(parsed), /Not kept|99 agents/);
  });

  it('does not take an "ecc:" that is not a prefix of a name', () => {
    const parsed = parseAgentsMd(agentsMd({ principles: '1. The word ecc: alone, and recc:x' }));
    assert.equal(parsed.principles, '1. The word ecc: alone, and recc:x');
  });

  it('does not mistake a heading inside a code block for a section', () => {
    const text = agentsMd({ orchestration: 'Use agents.\n\n```\n## Available Agents\n| x | y | z |\n```' });
    const parsed = parseAgentsMd(text);
    assert.equal(parsed.roster.length, 2);
    assert.match(parsed.orchestration, /```\n## Available Agents/);
  });

  it('accepts aligned separator rows', () => {
    const table = TABLE.replace('|-------|---------|-------------|', '| :--- | :---: | ---: |');
    assert.equal(parseAgentsMd(agentsMd({ table })).roster.length, 2);
  });

  it('stops when a section is missing or appears twice', () => {
    const without = agentsMd().replace('## Core Principles', '## Something Else');
    assert.equal(codeOf(() => parseAgentsMd(without)), 'agents-md-section');
    assert.throws(() => parseAgentsMd(without), { message: 'AGENTS.md: the section "Core Principles" was not found' });
    assert.equal(codeOf(() => parseAgentsMd(agentsMd({ extra: '\n## Core Principles\n\nAgain.' }))), 'agents-md-section');
    assert.equal(codeOf(() => parseAgentsMd('# Nothing here\n')), 'agents-md-section');
    const empty = agentsMd().replace('## Core Principles\n\n1. **First** — Do it\n2. **Second** — Do more\n', '## Core Principles\n');
    assert.equal(codeOf(() => parseAgentsMd(empty)), 'agents-md-section');
  });

  it('stops on a roster it cannot read', () => {
    const bad = (table) => codeOf(() => parseAgentsMd(agentsMd({ table })));
    assert.equal(bad('No table in this section.'), 'agents-md-table');
    assert.equal(bad(TABLE.replace('| Agent | Purpose | When to Use |', '| Name | Purpose | When to Use |')), 'agents-md-table');
    assert.equal(bad(`${TABLE}\n| only | two |`), 'agents-md-table');
    assert.equal(bad(`${TABLE}\n| a | b | c | d |`), 'agents-md-table');
    assert.equal(bad(`${TABLE}\n| Bad Name | x | y |`), 'agents-md-table');
    assert.equal(bad(`${TABLE}\n| planner | again | twice |`), 'agents-md-table');
    assert.equal(bad(`${TABLE}\n| empty-cell |  | y |`), 'agents-md-table');
    assert.equal(bad('| Agent | Purpose | When to Use |\n|---|---|---|'), 'agents-md-table');
  });
});

describe('buildAgentsSteering', () => {
  const build = (extra = {}) =>
    buildAgentsSteering({
      agentsMd: agentsMd(),
      agentNames: ['code-reviewer', 'planner'],
      describeAgent: () => null,
      skillCount: 7,
      ...extra,
    });

  it('is an always-on file named ecc-agents', () => {
    const result = build();
    assert.equal(result.name, 'ecc-agents');
    assert.equal(result.dest, '.kiro/steering/ecc-agents.md');
    assert.equal(result.inclusion, 'always');
    const { data } = parseFrontmatter(result.content);
    assert.deepEqual(data, { inclusion: 'always', name: 'ecc-agents', description: 'ECC working principles, when to hand work to a custom agent, and the roster of 2 ECC agents.' });
    assert.ok(result.content.startsWith('---\ninclusion: always\n'));
  });

  it('keeps the principles and delegation rules, says how to use an agent in Kiro, and lists the roster', () => {
    const { body } = parseFrontmatter(build().content);
    assert.match(body, /## Core principles\n\n1\. \*\*First\*\* — Do it\n2\. \*\*Second\*\* — Do more\n/);
    assert.match(body, /## Working with agents\n\nTo use an agent, name it in your request, for example "Use the code-reviewer agent/);
    assert.match(body, /Use agents proactively:\n- Big feature → \*\*planner\*\*\n- Code written → \*\*code-reviewer\*\*\n\nRun agents in parallel\./);
    assert.match(body, /## Agent roster\n\n\| Agent \| Purpose \| When to Use \|\n\|-------\|---------\|-------------\|\n\| planner \| Planning \| Complex features \|\n\| code-reviewer \| Review \| After writing code \|\n$/);
    assert.match(body, /ECC v2\.2\.3 gives this project 2 custom agents and 7 skills\./);
    assert.doesNotMatch(body, /ecc:/);
    assert.doesNotMatch(body, /Not kept|99 agents|Agent Instructions/);
  });

  it('fills in a row from the agent description for an agent the roster leaves out, and says so', () => {
    const descriptions = { 'db-tuner': 'Tunes database queries. Use after a slow query is found.', 'wordy-one': `${'word '.repeat(40)}end.`, 'pipe|agent': 'x' };
    const result = buildAgentsSteering({
      agentsMd: agentsMd(),
      agentNames: ['planner', 'code-reviewer', 'wordy-one', 'db-tuner', 'blank'],
      describeAgent: (name) => descriptions[name] ?? null,
      skillCount: 1,
    });
    assert.deepEqual(result.fromDescriptions, ['blank', 'db-tuner', 'wordy-one']);
    assert.equal(result.rosterRows, 5);
    const { body } = parseFrontmatter(result.content);
    const rows = body.split('\n').filter((line) => line.startsWith('| '));
    // rows[0] is the header; the roster rows come first, then the ones filled in from descriptions, by name.
    assert.equal(rows[1], '| planner | Planning | Complex features |');
    assert.equal(rows[3], '| blank | ECC agent | See the agent description |', 'no description: a plain label');
    assert.equal(rows[4], '| db-tuner | Tunes database queries | See the agent description |');
    assert.match(rows[5], /^\| wordy-one \| word word word .*word\.\.\. \| See the agent description \|$/);
    assert.ok(rows[5].split('|')[2].trim().length <= 104);
  });

  it('keeps a pipe in a description from breaking the table', () => {
    const result = buildAgentsSteering({ agentsMd: agentsMd(), agentNames: ['planner', 'code-reviewer', 'x'], describeAgent: () => 'Reads a | b.', skillCount: 1 });
    const row = parseFrontmatter(result.content).body.split('\n').find((line) => line.startsWith('| x '));
    assert.equal(row, '| x | Reads a / b | See the agent description |');
  });

  it('leaves out roster rows for agents that are not installed, and reports them', () => {
    const result = build({ agentNames: ['planner'] });
    assert.deepEqual(result.dropped, ['code-reviewer']);
    assert.equal(result.rosterRows, 1);
    assert.doesNotMatch(result.content, /\| code-reviewer \|/);
  });

  it('asks for a description only when the roster lacks the agent', () => {
    const asked = [];
    build({ agentNames: ['planner', 'code-reviewer', 'extra'], describeAgent: (name) => (asked.push(name), 'd') });
    assert.deepEqual(asked, ['extra']);
  });

  it('stops when AGENTS.md cannot be read, naming the file', () => {
    assert.equal(codeOf(() => build({ agentsMd: '# empty\n' })), 'agents-md-section');
    assert.throws(() => build({ agentsMd: '# empty\n', where: 'AGENTS.md' }), /^CodedError: AGENTS\.md: /);
  });
});

describe('buildHarnessSteering', () => {
  const harness = buildHarnessSteering();
  const { data, body } = parseFrontmatter(harness.content);

  it('is an always-on file named ecc-kiro-harness that starts with its frontmatter', () => {
    assert.equal(harness.name, 'ecc-kiro-harness');
    assert.equal(harness.dest, '.kiro/steering/ecc-kiro-harness.md');
    assert.equal(harness.inclusion, 'always');
    assert.deepEqual(Object.keys(data), ['inclusion', 'name', 'description']);
    assert.equal(data.name, 'ecc-kiro-harness');
    assert.ok(harness.content.startsWith('---\ninclusion: always\nname: ecc-kiro-harness\n'));
  });

  it('maps each kind of Claude Code wording to its Kiro equivalent', () => {
    const rows = body.split('\n').filter((line) => line.startsWith('| ')).slice(1);
    const find = (word) => rows.find((row) => row.includes(word));
    assert.match(find('Task tool'), /custom agent by name/);
    assert.match(find('TodoWrite'), /plan file/);
    assert.match(find('`/plan`'), /`\/ecc-plan`.*`\/ecc-code-review`/);
    assert.match(find('~/.claude'), /`~\/\.kiro\/\.\.\.`.*`\.kiro\/skills\/<name>\/`.*continuous-learning-v2\/scripts\/instinct-cli\.py/);
    assert.match(find('$CLAUDE_FILE_PATHS'), /^\| `\$CLAUDE_FILE_PATHS` in a hook command \| `\{\{filePath\}\}` in the command of a PostFileSave or PostFileCreate hook\..*JSON.*stdin\.? \|$/);
    assert.match(find('CLAUDE.md'), /\.kiro\/steering/);
    assert.match(find('$ARGUMENTS'), /text the user typed after the slash command/);
    assert.match(find('Hook events'), /\.kiro\/hooks\/\*\.json.*PostFileSave.*PostFileCreate.*switched off/);
    assert.match(find('model:'), /model of the current session/);
    assert.match(find('ecc:planner'), /plain name/);
    assert.match(find('configure-ecc'), /ecc-kiro-setup/);
    assert.match(find('Read, Grep, Glob'), /`read` \/ `write` \/ `shell` \/ `web`/);
    assert.match(find('Skill tool'), /description fits the task/);
    // Map question 6: the ecc-guide skill reads the layout of the ECC repository, which a Kiro project does not have.
    assert.match(find('ecc-guide'), /README\.md.*agent\.yaml.*manifests.*hooks\/hooks\.json.*paths of the ECC repository.*\.kiro\/skills\/\*\/SKILL\.md.*\.kiro\/agents\/\*\.md.*\.kiro\/steering\/ecc-\*\.md.*\.kiro\/hooks\/\*\.json.*\.kiro\/ecc\/install-state\.json.*ecc-kiro-setup/);
  });

  it('writes a well-formed two-column table', () => {
    const rows = body.split('\n').filter((line) => line.startsWith('|'));
    assert.ok(rows.length > 10);
    for (const row of rows) assert.equal(row.split('|').length, 4, row);
  });

  it('stays small, because it is sent with every request', () => {
    assert.ok(Buffer.byteLength(harness.content) < 4000, String(Buffer.byteLength(harness.content)));
  });

  it('uses short sentences without em dashes or exclamation marks', () => {
    assert.doesNotMatch(harness.content, /—|!/);
  });
});
