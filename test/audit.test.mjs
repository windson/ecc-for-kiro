// The harness audit: the rubric on hand-made snapshots, the gathering of a snapshot from a project, and the
// command through runCli.
import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import { ALWAYS_ON_LEAN, ALWAYS_ON_LIMIT, AUDIT_SCHEMA, CHECKS, PROBED_PATHS, RUBRIC_VERSION, SCOPES, formatAudit, normalizeScope, runAudit } from '../skills/ecc-kiro-setup/scripts/lib/audit.mjs';
import { gatherSnapshot } from '../skills/ecc-kiro-setup/scripts/lib/commands/audit.mjs';
import { EXIT, runCli, usage } from '../skills/ecc-kiro-setup/scripts/lib/cli.mjs';
import { captureStreams, memoryProbes } from './helpers.mjs';

const ROOT = '/work/project';
const empty = () => ({ files: new Set(), steering: [], skills: [], agents: [], hooks: [], agentsMdBytes: 0, packageScripts: null, gitignore: '', workflows: '' });
const rich = () => ({
  files: new Set(['test', 'eslint.config.js', '.kiro/ecc/scripts/quality-gate.sh', '.kiro/hooks/ecc-instinct-observe.json', '.kiro/specs', '.kiroignore', '.github/pull_request_template.md', '.github/CODEOWNERS']),
  steering: [
    { path: '.kiro/steering/product.md', bytes: 3000, inclusion: 'always' },
    { path: '.kiro/steering/ecc-typescript.md', bytes: 4000, inclusion: 'fileMatch' },
    { path: '.kiro/steering/ecc-plan.md', bytes: 6000, inclusion: 'manual' },
  ],
  skills: [{ name: 'tdd-workflow', description: 'Test first.' }],
  agents: [{ path: '.kiro/agents/planner.md', hasTools: true }],
  hooks: [{ path: '.kiro/hooks/ecc-git-push-review.json', hooks: [{ name: 'ecc-git-push-review', trigger: 'PreToolUse', enabled: true, action: 'command', command: 'node .kiro/ecc/scripts/git-push-guard.mjs' }] }],
  agentsMdBytes: 2000,
  packageScripts: { test: 'node --test', lint: 'eslint .' },
  gitignore: 'node_modules\n.env\n',
  workflows: 'name: ci\nsteps:\n  - run: npm test\n',
});
const check = (report, id) => report.checks.find((item) => item.id === id);

describe('runAudit', () => {
  it('scores an empty project low and a prepared one high, in the same shape', () => {
    const poor = runAudit(empty());
    const good = runAudit(rich());
    assert.ok(good.overall_score > poor.overall_score + 40, `${poor.overall_score} against ${good.overall_score}`);
    assert.equal(good.overall_score, good.max_score, 'the prepared project passes every check');
    assert.deepEqual([poor.max_score, good.max_score, poor.category_count], [80, 80, 8]);
  });
  it('gives the same answer for the same snapshot, whatever the order of its lists', () => {
    const a = rich();
    const b = { ...rich(), steering: [...rich().steering].reverse(), skills: [...rich().skills].reverse() };
    assert.deepEqual(runAudit(a), runAudit(b));
    assert.equal(JSON.stringify(runAudit(a)), JSON.stringify(runAudit(a)));
  });
  it('has the output contract of ECC\'s audit: scores, categories, checks and the top three actions', () => {
    const report = runAudit(empty(), { root: ROOT });
    assert.deepEqual(Object.keys(report), ['schema', 'rubric_version', 'scope', 'root', 'overall_score', 'max_score', 'category_count', 'applicable_categories', 'categories', 'checks', 'top_actions']);
    assert.deepEqual([report.schema, report.rubric_version, report.scope, report.root], [AUDIT_SCHEMA, RUBRIC_VERSION, 'repo', ROOT]);
    assert.equal(report.overall_score, report.categories.reduce((sum, category) => sum + category.score, 0));
    assert.deepEqual(report.applicable_categories, ['Tool Coverage', 'Context Efficiency', 'Quality Gates', 'Memory Persistence', 'Eval Coverage', 'Security Guardrails', 'Cost Efficiency', 'GitHub Integration']);
    for (const category of report.categories) assert.deepEqual(Object.keys(category), ['name', 'score', 'max', 'points', 'max_points']);
    for (const item of report.checks) assert.deepEqual(Object.keys(item), ['id', 'category', 'points', 'earned', 'pass', 'path', 'description', 'fix']);
    assert.equal(report.top_actions.length, 3);
    assert.deepEqual(report.top_actions.map((item) => item.points), [...report.top_actions.map((item) => item.points)].sort((a, b) => b - a), 'biggest first');
    assert.deepEqual(Object.keys(report.top_actions[0]), ['category', 'id', 'fix', 'path', 'points']);
  });
  it('has no top actions when everything passes, and no fix text on a passing check', () => {
    const report = runAudit(rich());
    assert.deepEqual(report.top_actions, []);
    assert.ok(report.checks.every((item) => item.pass && item.fix === null && item.earned === item.points));
  });
  it('normalizes each category to 10 points', () => {
    const report = runAudit(rich());
    assert.ok(report.categories.every((category) => category.max === 10 && category.score === 10));
    const partial = runAudit({ ...rich(), agents: [], skills: [] });
    const tools = partial.categories.find((category) => category.name === 'Tool Coverage');
    assert.deepEqual([tools.points, tools.max_points, tools.score], [4, 10, 4]);
  });
  it('limits the checks and the categories to the scope, and refuses an unknown scope', () => {
    const hooks = runAudit(rich(), { scope: 'hooks' });
    assert.ok(hooks.checks.every((item) => CHECKS.find((c) => c.id === item.id).scopes.includes('hooks')));
    assert.ok(hooks.category_count < 8 && hooks.max_score === hooks.category_count * 10);
    assert.ok(!hooks.applicable_categories.includes('GitHub Integration'), 'GitHub is repo scope only');
    for (const scope of SCOPES) assert.ok(runAudit(rich(), { scope }).checks.length > 0, scope);
    assert.equal(normalizeScope(undefined), 'repo');
    assert.equal(normalizeScope('SKILLS'), 'skills');
    assert.throws(() => normalizeScope('everything'), /unknown scope "everything" \(expected repo, hooks, skills, commands, agents\)/);
  });
  it('has unique ids, whole points and a fix for every check', () => {
    assert.equal(new Set(CHECKS.map((item) => item.id)).size, CHECKS.length);
    for (const item of CHECKS) {
      assert.ok(Number.isInteger(item.points) && item.points > 0, item.id);
      assert.ok(item.fix.endsWith('.') && item.description.endsWith('.'), item.id);
      assert.ok(item.scopes.includes('repo'), `${item.id} counts in the repo scope`);
      assert.ok(SCOPES.includes(item.scopes[0]) && item.scopes.every((scope) => SCOPES.includes(scope)), item.id);
    }
    for (const scope of SCOPES) assert.ok(CHECKS.some((item) => item.scopes.includes(scope)), scope);
  });
  it('looks at nothing Claude-specific', () => {
    assert.doesNotMatch(JSON.stringify(CHECKS.map(({ pass, ...rest }) => rest)), /\.claude|CLAUDE|opencode|hooks\.json/);
  });

  describe('the checks', () => {
    const fails = (patch, id) => check(runAudit({ ...rich(), ...patch }), id).pass === false;
    it('count always-on steering only, against the two limits', () => {
      const big = (bytes, inclusion = 'always') => [{ path: '.kiro/steering/x.md', bytes, inclusion }];
      assert.equal(fails({ steering: big(ALWAYS_ON_LIMIT) }, 'ctx-always-on-limit'), false);
      assert.equal(fails({ steering: big(ALWAYS_ON_LIMIT + 1) }, 'ctx-always-on-limit'), true);
      assert.equal(fails({ steering: big(ALWAYS_ON_LEAN + 1) }, 'cost-always-on-lean'), true);
      assert.equal(fails({ steering: big(ALWAYS_ON_LIMIT * 4, 'manual') }, 'ctx-always-on-limit'), false, 'manual steering costs nothing until used');
      assert.equal(fails({ steering: big(10_001) }, 'cost-large-always-on'), true);
      assert.equal(fails({ steering: big(10_001, 'fileMatch') }, 'cost-large-always-on'), false);
    });
    it('want a short AGENTS.md', () => {
      assert.equal(fails({ agentsMdBytes: 0 }, 'ctx-agents-md'), true);
      assert.equal(fails({ agentsMdBytes: 20_001 }, 'ctx-agents-md'), true);
      assert.equal(fails({ agentsMdBytes: 20_000 }, 'ctx-agents-md'), false);
    });
    it('want skill descriptions of 1 to 1024 characters', () => {
      assert.equal(fails({ skills: [{ name: 'a', description: null }] }, 'ctx-skill-descriptions'), true);
      assert.equal(fails({ skills: [{ name: 'a', description: 'x'.repeat(1025) }] }, 'ctx-skill-descriptions'), true);
      assert.equal(fails({ skills: [{ name: 'a', description: 'x'.repeat(1024) }] }, 'ctx-skill-descriptions'), false);
      assert.equal(fails({ skills: [] }, 'ctx-skill-descriptions'), true, 'no skills is not a pass');
    });
    it('find a test and a lint command in package.json or in the config of a language', () => {
      assert.equal(fails({ packageScripts: { lint: 'x' }, files: new Set() }, 'qg-test-command'), true);
      assert.equal(fails({ packageScripts: null, files: new Set(['go.mod']) }, 'qg-test-command'), false);
      assert.equal(fails({ packageScripts: null, files: new Set(['ruff.toml']) }, 'qg-lint-command'), false);
      assert.equal(fails({ packageScripts: { test: 'x' }, files: new Set() }, 'qg-lint-command'), true);
    });
    it('count only the agent-prompt hooks that are on, against a limit of three', () => {
      const hook = (name, enabled, action = 'agent') => ({ name, trigger: 'PostFileSave', enabled, action, command: '' });
      const four = [{ path: '.kiro/hooks/a.json', hooks: [1, 2, 3, 4].map((n) => hook(`h${n}`, true)) }];
      assert.equal(fails({ hooks: four }, 'cost-agent-hooks'), true);
      assert.equal(fails({ hooks: [{ path: 'x', hooks: [...four[0].hooks.slice(0, 3), hook('off', false), hook('cmd', true, 'command')] }] }, 'cost-agent-hooks'), false);
    });
    it('find the push guard by the command a hook runs', () => {
      assert.equal(fails({ hooks: [] }, 'sec-push-guard'), true);
      assert.equal(fails({ hooks: [{ path: 'x', hooks: [{ name: 'g', trigger: 'PreToolUse', enabled: false, action: 'command', command: 'node .kiro/ecc/scripts/git-push-guard.mjs' }] }] }, 'sec-push-guard'), false, 'installed counts, switched on or not');
    });
    it('want every agent to list its tools', () => {
      assert.equal(fails({ agents: [{ path: 'a', hasTools: true }, { path: 'b', hasTools: false }] }, 'sec-agent-tools'), true);
      assert.equal(fails({ agents: [] }, 'sec-agent-tools'), true);
    });
    it('read .env from .gitignore and CI tests from the workflow text', () => {
      assert.equal(fails({ gitignore: 'node_modules\n' }, 'sec-env-ignored'), true);
      assert.equal(fails({ gitignore: '.env.local\n' }, 'sec-env-ignored'), false);
      assert.equal(fails({ gitignore: '*.env\n' }, 'sec-env-ignored'), false);
      assert.equal(fails({ workflows: 'name: lint\nrun: npm run lint\n' }, 'eval-ci-tests'), true);
      assert.equal(fails({ workflows: '\n' }, 'gh-workflows'), false, 'a workflow file with no text still counts as a workflow');
      assert.equal(fails({ workflows: '' }, 'gh-workflows'), true);
    });
  });
});

describe('formatAudit', () => {
  it('writes the score, a line per category, the failed checks with their paths and the top actions', () => {
    const text = formatAudit(runAudit(empty()));
    assert.match(text, /^Harness audit \(repo, rubric 2026-10-08\): \d+\/80\n- Tool Coverage: 0\/10 \(0\/10 pts\)\n/);
    assert.match(text, /\nFailed checks:\n- \[Tool Coverage\] tool-agents: At least one custom agent is defined\. \(\.kiro\/agents\/\)\n/);
    assert.match(text, /\nTop 3 actions:\n1\) \[[^\]]+\] [^\n]+ \([^)]+\)\n2\) /);
    assert.doesNotMatch(formatAudit(runAudit(rich())), /Failed checks|Top \d action/);
  });
});

describe('gatherSnapshot', () => {
  const at = (rel) => path.join(ROOT, ...rel.split('/'));
  const project = (files) => memoryProbes({ cwd: ROOT, files: Object.fromEntries(Object.entries(files).map(([rel, text]) => [at(rel), text])) });
  const SKILL = '---\nname: tdd-workflow\ndescription: Test first.\n---\n# Body\n';
  const FILES = {
    'AGENTS.md': 'rules',
    '.gitignore': 'node_modules\n.env\n',
    'package.json': JSON.stringify({ scripts: { test: 'node --test' } }),
    '.kiroignore': '.claude/\n',
    '.kiro/steering/always.md': 'no frontmatter means always on',
    '.kiro/steering/lang.md': '---\ninclusion: fileMatch\nfileMatchPattern: "**/*.ts"\n---\nbody',
    '.kiro/steering/cmd.md': '---\ninclusion: manual\ndescription: "x"\n---\nbody',
    '.kiro/steering/weird.md': '---\ninclusion: sometimes\n---\nbody',
    '.kiro/steering/broken.md': '---\ninclusion: manual\n',
    '.kiro/steering/notes.txt': 'not markdown',
    '.kiro/skills/tdd-workflow/SKILL.md': SKILL,
    '.kiro/skills/no-skill-md/README.md': 'x',
    '.kiro/agents/planner.md': '---\nname: planner\ntools: ["read"]\n---\nbody',
    '.kiro/agents/old.json': JSON.stringify({ name: 'old', tools: ['read', 'write'] }),
    '.kiro/agents/bare.md': '---\nname: bare\n---\nbody',
    '.kiro/hooks/ecc-a.json': JSON.stringify({ version: 'v1', hooks: [{ name: 'a', trigger: 'Stop', action: { type: 'agent', prompt: 'p' }, enabled: false }, { name: 'b', trigger: 'PreToolUse', matcher: 'shell', action: { type: 'command', command: 'node x.mjs' } }] }),
    '.kiro/hooks/bad.json': '{ nope',
    '.github/workflows/ci.yml': 'name: ci\nrun: npm test\n',
    '.github/workflows/readme.txt': 'ignored',
    'test/a.test.js': 'x',
  };
  it('reads steering, skills, agents, hooks and the files the rubric asks about', async () => {
    const snapshot = await gatherSnapshot({ root: ROOT, probes: project(FILES) });
    assert.deepEqual(snapshot.steering.map((item) => [item.path, item.inclusion]), [
      ['.kiro/steering/always.md', 'always'],
      ['.kiro/steering/broken.md', 'always'],
      ['.kiro/steering/cmd.md', 'manual'],
      ['.kiro/steering/lang.md', 'fileMatch'],
      ['.kiro/steering/weird.md', 'always'],
    ]);
    assert.equal(snapshot.steering[0].bytes, FILES['.kiro/steering/always.md'].length);
    assert.deepEqual(snapshot.skills, [{ name: 'tdd-workflow', description: 'Test first.' }]);
    assert.deepEqual(snapshot.agents.map((item) => [item.path, item.hasTools]), [['.kiro/agents/bare.md', false], ['.kiro/agents/old.json', true], ['.kiro/agents/planner.md', true]]);
    assert.deepEqual(snapshot.hooks, [{ path: '.kiro/hooks/ecc-a.json', hooks: [
      { name: 'a', trigger: 'Stop', enabled: false, action: 'agent', command: '' },
      { name: 'b', trigger: 'PreToolUse', enabled: true, action: 'command', command: 'node x.mjs' },
    ] }]);
    assert.equal(snapshot.agentsMdBytes, 5);
    assert.deepEqual(snapshot.packageScripts, { test: 'node --test' });
    assert.equal(snapshot.gitignore, FILES['.gitignore']);
    assert.match(snapshot.workflows, /npm test/);
    assert.doesNotMatch(snapshot.workflows, /ignored/);
    assert.deepEqual([...snapshot.files].sort(), ['.kiroignore', 'test']);
    assert.ok([...snapshot.files].every((item) => PROBED_PATHS.includes(item)));
  });
  it('gives an empty snapshot for an empty project', async () => {
    const snapshot = await gatherSnapshot({ root: ROOT, probes: memoryProbes({ cwd: ROOT }) });
    assert.deepEqual(snapshot, empty());
  });
  it('never opens the MCP settings or an .env file', async () => {
    const opened = [];
    const probes = project({ ...FILES, '.kiro/settings/mcp.json': '{"mcpServers":{"x":{"env":{"TOKEN":"secret"}}}}', '.env': 'TOKEN=secret' });
    const readText = probes.readText.bind(probes);
    probes.readText = async (file) => {
      opened.push(path.relative(ROOT, file));
      return readText(file);
    };
    await gatherSnapshot({ root: ROOT, probes });
    assert.ok(!opened.some((item) => item.includes('settings') || item === '.env'), opened.join(', '));
  });
});

describe('the audit command', () => {
  const run = async (argv, files = {}, cwd = ROOT) => {
    const streams = captureStreams();
    const code = await runCli(argv, {
      stdout: streams.stdout,
      stderr: streams.stderr,
      probes: memoryProbes({ cwd, files: Object.fromEntries(Object.entries(files).map(([rel, text]) => [path.join(cwd, ...rel.split('/')), text])) }),
      skillDir: '/skill',
      services: {},
    });
    return { code, out: streams.out, err: streams.err };
  };
  it('prints the scorecard as text, and always exits 0 because the score is advice', async () => {
    const result = await run(['audit']);
    assert.equal(result.code, EXIT.OK);
    assert.match(result.out, /^Harness audit \(repo, rubric/);
  });
  it('takes the scope as an argument and the format as --json or --format json, and prints the same JSON', async () => {
    const viaFlag = await run(['audit', 'hooks', '--json']);
    const viaFormat = await run(['audit', 'hooks', '--format', 'json']);
    assert.equal(viaFlag.out, viaFormat.out);
    const report = JSON.parse(viaFlag.out);
    assert.deepEqual([report.schema, report.scope, report.root], [AUDIT_SCHEMA, 'hooks', ROOT]);
    assert.equal((await run(['audit', '--format', 'text'])).out.startsWith('Harness audit'), true);
  });
  it('audits the folder named by --root', async () => {
    const result = await run(['audit', '--json', '--root', '/elsewhere'], {}, ROOT);
    assert.equal(JSON.parse(result.out).root, '/elsewhere');
  });
  it('gives a higher score to a project with steering, tests and an AGENTS.md, and the same output on a second run', async () => {
    const files = { 'AGENTS.md': 'rules', 'test/a.test.js': 'x', 'package.json': '{"scripts":{"test":"t"}}', '.kiro/steering/p.md': 'product' };
    const poor = JSON.parse((await run(['audit', '--json'])).out);
    const better = JSON.parse((await run(['audit', '--json'], files)).out);
    assert.ok(better.overall_score > poor.overall_score);
    assert.equal((await run(['audit', '--json'], files)).out, (await run(['audit', '--json'], files)).out);
  });
  it('is a usage error for an unknown scope, a second argument and a wrong format', async () => {
    for (const argv of [['audit', 'everything'], ['audit', 'repo', 'hooks'], ['audit', '--format', 'xml']]) {
      const result = await run(argv);
      assert.equal(result.code, EXIT.USAGE, argv.join(' '));
    }
    assert.match((await run(['audit', 'everything'])).err, /unknown scope "everything"/);
    assert.match((await run(['audit', 'repo', 'hooks'])).err, /unexpected argument "hooks"/);
  });
  it('does not take a scope on the other commands', async () => {
    assert.match((await run(['doctor', 'repo'])).err, /unexpected argument "repo"/);
  });
  it('is listed in the usage text with its scope argument', () => {
    assert.match(usage(), /\n {2}audit {2,}score the project against a fixed Kiro rubric[^\n]*\n {2,}options: --json --format --root \[scope\] \(repo \(default\), hooks, skills, commands or agents\)\n/);
  });
});
