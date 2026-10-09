// The harness audit: a fixed rubric that scores how well a project is set up for Kiro.
//
// Pure: a snapshot of the project goes in (see io in lib/commands/audit.mjs for how it is gathered), a scorecard
// comes out. The same snapshot always gives the same scorecard, so two runs can be compared.
//
// This replaces ECC's harness-audit.js for Kiro projects. ECC's script looks for .claude/plugins,
// .claude/settings.json, hooks/hooks.json and .opencode/commands, so a Kiro project would score low for the
// wrong reasons. The rubric here is original. It keeps the shape of ECC's output (overall_score, max_score,
// categories, checks, top_actions) and the names of the categories, and checks the Kiro surfaces instead:
// steering and its size, skills, agents, hooks, AGENTS.md, .kiroignore, test and lint scripts, and CI.

export const AUDIT_SCHEMA = 'ecc-kiro.audit.v1';
export const RUBRIC_VERSION = '2026-10-08';
export const SCOPES = Object.freeze(['repo', 'hooks', 'skills', 'commands', 'agents']);

/** Kiro sends all always-on steering with every request. The installer keeps it under this. */
export const ALWAYS_ON_LIMIT = 25_000;
/** The point at which a cost check starts to complain. */
export const ALWAYS_ON_LEAN = 15_000;
const AGENTS_MD_LIMIT = 20_000;
const AGENT_PROMPT_HOOK_LIMIT = 3;
const LARGE_FILE = 10_000;

/**
 * @typedef {object} Snapshot
 * @property {Set<string>} files project-relative paths that exist, among the ones the audit asks about
 * @property {{ path: string, bytes: number, inclusion: string }[]} steering files in .kiro/steering
 * @property {{ name: string, description: string | null }[]} skills folders in .kiro/skills that have a SKILL.md
 * @property {{ path: string, hasTools: boolean }[]} agents files in .kiro/agents
 * @property {{ path: string, hooks: { name: string, trigger: string, enabled: boolean, action: string, command: string }[] }[]} hooks files in .kiro/hooks
 * @property {number} agentsMdBytes size of AGENTS.md, 0 when it is missing
 * @property {Record<string, string> | null} packageScripts the scripts of package.json, or null
 * @property {string} gitignore text of .gitignore, or ''
 * @property {string} workflows the text of the files in .github/workflows, or ''
 */

const has = (snapshot, ...paths) => paths.some((path) => snapshot.files.has(path));
const alwaysOnBytes = (snapshot) => snapshot.steering.filter((file) => file.inclusion === 'always').reduce((sum, file) => sum + file.bytes, 0);
const enabledHooks = (snapshot) => snapshot.hooks.flatMap((file) => file.hooks.filter((hook) => hook.enabled).map((hook) => ({ ...hook, path: file.path })));
const allHooks = (snapshot) => snapshot.hooks.flatMap((file) => file.hooks.map((hook) => ({ ...hook, path: file.path })));
const TEST_DIRS = ['test', 'tests', '__tests__', 'spec', 'specs'];
const LINT_CONFIGS = ['eslint.config.js', 'eslint.config.mjs', '.eslintrc', '.eslintrc.json', '.eslintrc.js', '.eslintrc.cjs', 'biome.json', 'biome.jsonc', 'ruff.toml', '.ruff.toml', '.golangci.yml', '.golangci.yaml', '.flake8', '.pylintrc', 'clippy.toml', '.rubocop.yml'];
const TEST_MARKERS = ['pytest.ini', 'tox.ini', 'go.mod', 'Cargo.toml', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'phpunit.xml', 'jest.config.js', 'jest.config.ts', 'vitest.config.ts', 'vitest.config.js'];

/**
 * The checks. Each has a category, the points it is worth, the scopes it counts in, and a function that
 * says whether it passes. `path` is where the fix goes. Checks never read anything but the snapshot.
 */
export const CHECKS = Object.freeze([
  // Tool Coverage
  { id: 'tool-agents', category: 'Tool Coverage', points: 3, scopes: ['repo', 'agents'], path: '.kiro/agents/', description: 'At least one custom agent is defined.', fix: 'Add a custom agent in .kiro/agents (for example a reviewer with read-only tools).', pass: (s) => s.agents.length > 0 },
  { id: 'tool-skills', category: 'Tool Coverage', points: 3, scopes: ['repo', 'skills'], path: '.kiro/skills/', description: 'At least one skill with a SKILL.md is installed.', fix: 'Add a skill folder with a SKILL.md under .kiro/skills.', pass: (s) => s.skills.length > 0 },
  { id: 'tool-hooks', category: 'Tool Coverage', points: 2, scopes: ['repo', 'hooks'], path: '.kiro/hooks/', description: 'At least one hook file is defined.', fix: 'Add a hook file in .kiro/hooks for a check you want on every run.', pass: (s) => s.hooks.length > 0 },
  { id: 'tool-commands', category: 'Tool Coverage', points: 2, scopes: ['repo', 'commands'], path: '.kiro/steering/', description: 'At least one manually included steering file works as a slash command.', fix: 'Add a steering file with "inclusion: manual" for a workflow you run on demand.', pass: (s) => s.steering.some((file) => file.inclusion === 'manual') },

  // Context Efficiency
  { id: 'ctx-always-on-limit', category: 'Context Efficiency', points: 4, scopes: ['repo'], path: '.kiro/steering/', description: `Always-on steering stays under ${ALWAYS_ON_LIMIT} bytes.`, fix: 'Move long guidance to file-match or manual steering, or into skills.', pass: (s) => alwaysOnBytes(s) <= ALWAYS_ON_LIMIT },
  { id: 'ctx-agents-md', category: 'Context Efficiency', points: 2, scopes: ['repo'], path: 'AGENTS.md', description: `AGENTS.md exists and is under ${AGENTS_MD_LIMIT} bytes.`, fix: 'Add a short AGENTS.md with the commands, layout and rules an agent needs.', pass: (s) => s.agentsMdBytes > 0 && s.agentsMdBytes <= AGENTS_MD_LIMIT },
  { id: 'ctx-file-match', category: 'Context Efficiency', points: 2, scopes: ['repo'], path: '.kiro/steering/', description: 'Some steering loads only for matching files.', fix: 'Give language or framework rules "inclusion: fileMatch" with a fileMatchPattern.', pass: (s) => s.steering.some((file) => file.inclusion === 'fileMatch') },
  { id: 'ctx-skill-descriptions', category: 'Context Efficiency', points: 2, scopes: ['repo', 'skills'], path: '.kiro/skills/', description: 'Every skill has a description of 1 to 1024 characters.', fix: 'Write a description for each skill; it is what the agent reads to decide whether to load it.', pass: (s) => s.skills.length > 0 && s.skills.every((skill) => typeof skill.description === 'string' && skill.description.trim() !== '' && skill.description.length <= 1024) },

  // Quality Gates
  { id: 'qg-test-command', category: 'Quality Gates', points: 4, scopes: ['repo'], path: 'package.json', description: 'The project has a test command.', fix: 'Add a "test" script to package.json, or the test config of your language.', pass: (s) => typeof s.packageScripts?.test === 'string' || has(s, ...TEST_MARKERS) },
  { id: 'qg-lint-command', category: 'Quality Gates', points: 3, scopes: ['repo'], path: 'package.json', description: 'The project has a lint or format command.', fix: 'Add a "lint" script or a linter config (ESLint, Biome, Ruff, golangci-lint).', pass: (s) => typeof s.packageScripts?.lint === 'string' || has(s, ...LINT_CONFIGS) },
  { id: 'qg-gate-script', category: 'Quality Gates', points: 3, scopes: ['repo', 'hooks'], path: '.kiro/ecc/scripts/quality-gate.sh', description: 'A quality gate script is installed, or a hook runs a check.', fix: 'Install the ECC commands part (it adds quality-gate.sh) or add a hook that runs your checks.', pass: (s) => has(s, '.kiro/ecc/scripts/quality-gate.sh') || allHooks(s).some((hook) => hook.action === 'command') },

  // Memory Persistence
  { id: 'mem-steering-memory', category: 'Memory Persistence', points: 4, scopes: ['repo'], path: '.kiro/steering/', description: 'Project knowledge is kept in steering or AGENTS.md.', fix: 'Write down the product, structure and conventions in .kiro/steering or AGENTS.md.', pass: (s) => s.agentsMdBytes > 0 || s.steering.length > 0 },
  { id: 'mem-instinct-hooks', category: 'Memory Persistence', points: 3, scopes: ['repo', 'hooks'], path: '.kiro/hooks/ecc-instinct-observe.json', description: 'The instinct observer hook is installed.', fix: 'Install the owned part; it adds ecc-instinct-observe.json, switched off.', pass: (s) => has(s, '.kiro/hooks/ecc-instinct-observe.json') },
  { id: 'mem-specs', category: 'Memory Persistence', points: 3, scopes: ['repo'], path: '.kiro/specs/', description: 'Specs are kept in .kiro/specs.', fix: 'Capture larger changes as specs so the decisions outlive the chat.', pass: (s) => has(s, '.kiro/specs') },

  // Eval Coverage
  { id: 'eval-tests', category: 'Eval Coverage', points: 5, scopes: ['repo'], path: 'test/', description: 'The project has a test folder.', fix: 'Add tests under test/ or tests/.', pass: (s) => has(s, ...TEST_DIRS) },
  { id: 'eval-ci-tests', category: 'Eval Coverage', points: 5, scopes: ['repo'], path: '.github/workflows/', description: 'CI runs the tests.', fix: 'Add a workflow that runs the test command on every pull request.', pass: (s) => /\btest\b/i.test(s.workflows) },

  // Security Guardrails
  { id: 'sec-kiroignore', category: 'Security Guardrails', points: 3, scopes: ['repo'], path: '.kiroignore', description: '.kiroignore exists.', fix: 'Add a .kiroignore for folders the agent should not read.', pass: (s) => has(s, '.kiroignore') },
  { id: 'sec-env-ignored', category: 'Security Guardrails', points: 3, scopes: ['repo'], path: '.gitignore', description: '.gitignore lists .env files.', fix: 'Add .env to .gitignore.', pass: (s) => /^\.env\b/m.test(s.gitignore) || /^\*\.env\b/m.test(s.gitignore) },
  { id: 'sec-push-guard', category: 'Security Guardrails', points: 2, scopes: ['repo', 'hooks'], path: '.kiro/hooks/ecc-git-push-review.json', description: 'A hook guards git push.', fix: 'Install the hooks part; it adds ecc-git-push-review.json, switched off.', pass: (s) => allHooks(s).some((hook) => /git-push-guard/.test(hook.command)) },
  { id: 'sec-agent-tools', category: 'Security Guardrails', points: 2, scopes: ['repo', 'agents'], path: '.kiro/agents/', description: 'Every custom agent lists its tools.', fix: 'Add a tools list to each agent so it only has what it needs.', pass: (s) => s.agents.length > 0 && s.agents.every((agent) => agent.hasTools) },

  // Cost Efficiency
  { id: 'cost-always-on-lean', category: 'Cost Efficiency', points: 4, scopes: ['repo'], path: '.kiro/steering/', description: `Always-on steering stays under ${ALWAYS_ON_LEAN} bytes.`, fix: 'Trim the always-on steering; every request carries it.', pass: (s) => alwaysOnBytes(s) <= ALWAYS_ON_LEAN },
  { id: 'cost-agent-hooks', category: 'Cost Efficiency', points: 3, scopes: ['repo', 'hooks'], path: '.kiro/hooks/', description: `At most ${AGENT_PROMPT_HOOK_LIMIT} agent-prompt hooks are switched on; each firing costs credits.`, fix: 'Switch off agent-prompt hooks you do not need, or replace them with command hooks.', pass: (s) => enabledHooks(s).filter((hook) => hook.action === 'agent').length <= AGENT_PROMPT_HOOK_LIMIT },
  { id: 'cost-large-always-on', category: 'Cost Efficiency', points: 3, scopes: ['repo', 'commands'], path: '.kiro/steering/', description: `No single always-on steering file is over ${LARGE_FILE} bytes.`, fix: 'Split a large always-on file, or change it to manual or file-match inclusion.', pass: (s) => s.steering.every((file) => file.inclusion !== 'always' || file.bytes <= LARGE_FILE) },

  // GitHub Integration
  { id: 'gh-workflows', category: 'GitHub Integration', points: 4, scopes: ['repo'], path: '.github/workflows/', description: 'At least one GitHub Actions workflow exists.', fix: 'Add a workflow under .github/workflows.', pass: (s) => s.workflows !== '' },
  { id: 'gh-pr-template', category: 'GitHub Integration', points: 3, scopes: ['repo'], path: '.github/pull_request_template.md', description: 'A pull request template exists.', fix: 'Add .github/pull_request_template.md.', pass: (s) => has(s, '.github/pull_request_template.md', '.github/PULL_REQUEST_TEMPLATE.md', '.github/PULL_REQUEST_TEMPLATE') },
  { id: 'gh-ownership', category: 'GitHub Integration', points: 3, scopes: ['repo'], path: '.github/CODEOWNERS', description: 'CODEOWNERS or issue templates exist.', fix: 'Add .github/CODEOWNERS or .github/ISSUE_TEMPLATE.', pass: (s) => has(s, '.github/CODEOWNERS', 'CODEOWNERS', '.github/ISSUE_TEMPLATE') },
]);

/** The paths a snapshot must say exist or not, for the checks above. */
export const PROBED_PATHS = Object.freeze([
  ...new Set([
    ...TEST_DIRS,
    ...LINT_CONFIGS,
    ...TEST_MARKERS,
    '.kiro/ecc/scripts/quality-gate.sh',
    '.kiro/hooks/ecc-instinct-observe.json',
    '.kiro/specs',
    '.kiroignore',
    '.github/pull_request_template.md',
    '.github/PULL_REQUEST_TEMPLATE.md',
    '.github/PULL_REQUEST_TEMPLATE',
    '.github/CODEOWNERS',
    'CODEOWNERS',
    '.github/ISSUE_TEMPLATE',
  ]),
]);

export function normalizeScope(scope) {
  const value = (scope ?? 'repo').toLowerCase();
  if (!SCOPES.includes(value)) throw new RangeError(`unknown scope "${scope}" (expected ${SCOPES.join(', ')})`);
  return value;
}

/**
 * Score a project.
 * @param {Snapshot} snapshot
 * @param {{ scope?: string, root?: string }} [options]
 */
export function runAudit(snapshot, { scope = 'repo', root = '.' } = {}) {
  const wanted = normalizeScope(scope);
  const checks = CHECKS.filter((check) => check.scopes.includes(wanted)).map((check) => {
    const pass = check.pass(snapshot) === true;
    return { id: check.id, category: check.category, points: check.points, earned: pass ? check.points : 0, pass, path: check.path, description: check.description, fix: pass ? null : check.fix };
  });
  const names = [...new Set(checks.map((check) => check.category))];
  const categories = names.map((name) => {
    const inCategory = checks.filter((check) => check.category === name);
    const maxPoints = inCategory.reduce((sum, check) => sum + check.points, 0);
    const points = inCategory.reduce((sum, check) => sum + check.earned, 0);
    return { name, score: Math.round((10 * points) / maxPoints), max: 10, points, max_points: maxPoints };
  });
  const failed = checks.filter((check) => !check.pass).sort((a, b) => b.points - a.points || (a.id < b.id ? -1 : 1));
  return {
    schema: AUDIT_SCHEMA,
    rubric_version: RUBRIC_VERSION,
    scope: wanted,
    root,
    overall_score: categories.reduce((sum, category) => sum + category.score, 0),
    max_score: categories.length * 10,
    category_count: categories.length,
    applicable_categories: names,
    categories,
    checks,
    top_actions: failed.slice(0, 3).map((check) => ({ category: check.category, id: check.id, fix: check.fix, path: check.path, points: check.points })),
  };
}

/** The scorecard as text. */
export function formatAudit(report) {
  const lines = [`Harness audit (${report.scope}, rubric ${report.rubric_version}): ${report.overall_score}/${report.max_score}`];
  for (const category of report.categories) lines.push(`- ${category.name}: ${category.score}/${category.max} (${category.points}/${category.max_points} pts)`);
  const failed = report.checks.filter((check) => !check.pass);
  if (failed.length > 0) {
    lines.push('', 'Failed checks:');
    for (const check of failed) lines.push(`- [${check.category}] ${check.id}: ${check.description} (${check.path})`);
  }
  if (report.top_actions.length > 0) {
    lines.push('', `Top ${report.top_actions.length} action${report.top_actions.length === 1 ? '' : 's'}:`);
    report.top_actions.forEach((action, index) => lines.push(`${index + 1}) [${action.category}] ${action.fix} (${action.path})`));
  }
  return `${lines.join('\n')}\n`;
}
