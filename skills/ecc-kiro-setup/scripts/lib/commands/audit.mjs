import path from 'node:path';

import { PROBED_PATHS, formatAudit, normalizeScope, runAudit } from '../audit.mjs';
import { EXIT, UsageError } from '../exit.mjs';
import { FrontmatterError, parseFrontmatter } from '../frontmatter.mjs';

const MAX_WORKFLOW_TEXT = 200_000;
const INCLUSIONS = new Set(['always', 'fileMatch', 'manual', 'auto']);

const join = (...parts) => parts.join('/');

/** Parse text as JSON; null when it is not. */
function parseJson(text) {
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Look at the project and build the snapshot the rubric scores. Read-only. Nothing that could hold a secret is
 * kept: the MCP settings, environment files and message text are never opened.
 * @param {{ root: string, probes: any }} input
 * @returns {Promise<import('../audit.mjs').Snapshot>}
 */
export async function gatherSnapshot({ root, probes }) {
  const at = (rel) => path.join(root, ...rel.split('/'));
  const stat = (rel) => probes.stat(at(rel));
  const read = (rel) => probes.readText(at(rel));
  const list = async (rel) => (await probes.readdir(at(rel))) ?? [];

  const files = new Set();
  for (const rel of PROBED_PATHS) if ((await stat(rel)) !== null) files.add(rel);

  const steering = [];
  for (const name of (await list('.kiro/steering')).filter((item) => item.endsWith('.md'))) {
    const rel = join('.kiro/steering', name);
    const info = await stat(rel);
    if (info?.type !== 'file') continue;
    let inclusion = 'always';
    try {
      const { data } = parseFrontmatter((await read(rel)) ?? '');
      if (typeof data.inclusion === 'string' && INCLUSIONS.has(data.inclusion)) inclusion = data.inclusion;
    } catch (error) {
      if (!(error instanceof FrontmatterError)) throw error;
    }
    steering.push({ path: rel, bytes: info.size, inclusion });
  }

  const skills = [];
  for (const name of await list('.kiro/skills')) {
    const text = await read(join('.kiro/skills', name, 'SKILL.md'));
    if (text === null) continue;
    let description = null;
    try {
      const value = parseFrontmatter(text).data.description;
      if (typeof value === 'string') description = value;
    } catch (error) {
      if (!(error instanceof FrontmatterError)) throw error;
    }
    skills.push({ name, description });
  }

  const agents = [];
  for (const name of (await list('.kiro/agents')).filter((item) => item.endsWith('.md') || item.endsWith('.json'))) {
    const rel = join('.kiro/agents', name);
    const text = await read(rel);
    if (text === null) continue;
    let tools;
    if (name.endsWith('.json')) {
      tools = parseJson(text)?.tools;
    } else {
      try {
        tools = parseFrontmatter(text).data.tools;
      } catch (error) {
        if (!(error instanceof FrontmatterError)) throw error;
      }
    }
    agents.push({ path: rel, hasTools: Array.isArray(tools) ? tools.length > 0 : typeof tools === 'string' && tools.trim() !== '' });
  }

  const hooks = [];
  for (const name of (await list('.kiro/hooks')).filter((item) => item.endsWith('.json'))) {
    const rel = join('.kiro/hooks', name);
    const value = parseJson(await read(rel));
    if (!Array.isArray(value?.hooks)) continue;
    hooks.push({
      path: rel,
      hooks: value.hooks
        .filter((hook) => hook !== null && typeof hook === 'object')
        .map((hook) => ({
          name: typeof hook.name === 'string' ? hook.name : '',
          trigger: typeof hook.trigger === 'string' ? hook.trigger : '',
          enabled: hook.enabled !== false,
          action: typeof hook.action?.type === 'string' ? hook.action.type : '',
          command: typeof hook.action?.command === 'string' ? hook.action.command : '',
        })),
    });
  }

  const agentsMd = await stat('AGENTS.md');
  const scripts = parseJson(await read('package.json'))?.scripts;

  let workflows = '';
  for (const name of (await list('.github/workflows')).filter((item) => /\.ya?ml$/.test(item))) {
    workflows += `${(await read(join('.github/workflows', name))) ?? ''}\n`;
    if (workflows.length > MAX_WORKFLOW_TEXT) break;
  }

  return {
    files,
    steering,
    skills,
    agents,
    hooks,
    agentsMdBytes: agentsMd?.type === 'file' ? agentsMd.size : 0,
    packageScripts: scripts !== null && typeof scripts === 'object' && !Array.isArray(scripts) ? scripts : null,
    gitignore: (await read('.gitignore')) ?? '',
    workflows,
  };
}

export const auditCommand = {
  summary: 'score the project against a fixed Kiro rubric: steering, skills, agents, hooks, tests, CI (read-only)',
  options: ['json', 'format', 'root'],
  positionals: { max: 1, usage: '[scope]', help: 'repo (default), hooks, skills, commands or agents' },
  async run({ options, positionals = [], stdout, probes }) {
    const root = path.resolve(options.root ?? probes.cwd);
    let scope;
    try {
      scope = normalizeScope(positionals[0]);
    } catch (error) {
      throw new UsageError(error.message);
    }
    const format = options.format ?? (options.json ? 'json' : 'text');
    if (format !== 'text' && format !== 'json') throw new UsageError(`--format must be text or json (found "${format}")`);
    const report = runAudit(await gatherSnapshot({ root, probes }), { scope, root });
    stdout.write(format === 'json' ? `${JSON.stringify(report, null, 2)}\n` : formatAudit(report));
    return EXIT.OK;
  },
};
