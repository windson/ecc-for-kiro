// Converting an ECC agent (Claude Code format) into a Kiro custom agent.
//
// Pure: text in, text out. The body, which holds the agent's instructions, is copied through
// unchanged. Only the frontmatter is rewritten, because Kiro names tools differently and has no
// per-agent model or color.

import { CodedError } from './exit.mjs';
import { FrontmatterError, parseFrontmatter, stringifyDocument } from './frontmatter.mjs';

/** Where Kiro looks for a project's custom agents. */
export const AGENT_DIR = '.kiro/agents';

/** Frontmatter keys an ECC agent may carry. Anything else is a surprise and stops the conversion. */
const KNOWN_KEYS = Object.freeze(['name', 'description', 'tools', 'model', 'color']);

/** Claude Code tool name to Kiro tool tag. */
export const TOOL_TAGS = Object.freeze({
  Read: 'read',
  Grep: 'read',
  Glob: 'read',
  Write: 'write',
  Edit: 'write',
  MultiEdit: 'write',
  Bash: 'shell',
  WebFetch: 'web',
  WebSearch: 'web',
  Task: 'subagent',
  Agent: 'subagent',
});

/** `mcp__<server>__<tool>`. Server names have no underscores, so the split is unambiguous. */
const MCP_TOOL = /^mcp__([A-Za-z0-9][A-Za-z0-9-]*)__([A-Za-z0-9][A-Za-z0-9_.-]*)$/;

const AGENT_NAME = /^[a-z0-9][a-z0-9-]*$/;
const MAX_NAME_LENGTH = 64;

/** Kiro's own agents are called kiro_default, kiro_planner, kiro_help and so on. */
const RESERVED_NAME = /^kiro[_-]/i;

/**
 * Agents that run shell commands may inspect the repository without asking: the four read-only
 * git commands. `--output` is excluded because git's diff options can write to a file. Every
 * other command keeps Kiro's default of asking.
 */
export const SHELL_PERMISSIONS = Object.freeze({
  rules: Object.freeze([
    Object.freeze({
      capability: 'shell',
      match: Object.freeze(['git diff*', 'git log*', 'git status*', 'git show*']),
      exclude: Object.freeze(['*--output*']),
      effect: 'allow',
    }),
  ]),
});

const fileStem = (sourcePath) => {
  const base = sourcePath.slice(sourcePath.lastIndexOf('/') + 1);
  return base.endsWith('.md') ? base.slice(0, -3) : base;
};

/**
 * Map one Claude Code tool name to a Kiro tool entry.
 * @returns {string} a tag such as `read`, or `@server/tool` for an MCP tool
 */
export function mapTool(name, where = 'tools') {
  if (Object.hasOwn(TOOL_TAGS, name)) return TOOL_TAGS[name];
  const mcp = MCP_TOOL.exec(name);
  if (mcp) return `@${mcp[1]}/${mcp[2]}`;
  throw new CodedError('agent-tool-unknown', `${where}: unknown tool ${JSON.stringify(name)}`, {
    fix: 'Add it to TOOL_TAGS in lib/agents.mjs once you know what it maps to.',
  });
}

/**
 * Turn the `tools` value of an ECC agent into Kiro tool entries, first occurrence order, no duplicates.
 * @param {unknown} value a comma-separated string, or a list of names
 * @returns {string[]}
 */
export function mapTools(value, where = 'tools') {
  const names = typeof value === 'string' ? value.split(',') : Array.isArray(value) ? value : null;
  if (names === null) throw new CodedError('agent-tools', `${where}: tools must be a comma-separated string or a list`);
  const result = [];
  for (const raw of names) {
    const name = typeof raw === 'string' ? raw.trim() : '';
    if (name === '') throw new CodedError('agent-tools', `${where}: tools contains an empty name`);
    const tag = mapTool(name, where);
    if (!result.includes(tag)) result.push(tag);
  }
  if (result.length === 0) throw new CodedError('agent-tools', `${where}: tools is empty`);
  return result;
}

const sameKeysAs = (value) => JSON.parse(JSON.stringify(value));

/**
 * Convert one ECC agent file.
 * @param {{ path: string, text: string }} input `path` is the ECC-relative path, for example `agents/planner.md`
 * @returns {{ name: string, dest: string, content: string, tools: string[], shellRules: boolean, dropped: { model: string | null, color: string | null } }}
 */
export function convertAgent({ path: sourcePath, text }) {
  let doc;
  try {
    doc = parseFrontmatter(text);
  } catch (error) {
    if (error instanceof FrontmatterError) throw new CodedError('agent-frontmatter', `${sourcePath}: ${error.message}`);
    throw error;
  }
  if (!doc.hasFrontmatter) throw new CodedError('agent-frontmatter', `${sourcePath}: the agent has no frontmatter`);

  const unknown = Object.keys(doc.data).filter((key) => !KNOWN_KEYS.includes(key));
  if (unknown.length > 0) {
    throw new CodedError('agent-key-unknown', `${sourcePath}: unexpected frontmatter key(s): ${unknown.join(', ')}`, {
      fix: 'Decide what the key means in Kiro, then teach lib/agents.mjs about it.',
    });
  }

  const stem = fileStem(sourcePath);
  const { name, description, tools } = doc.data;
  if (typeof name !== 'string' || name === '') throw new CodedError('agent-name', `${sourcePath}: the agent has no name`);
  if (name !== stem) throw new CodedError('agent-name', `${sourcePath}: name ${JSON.stringify(name)} does not match the file name ${JSON.stringify(stem)}`);
  if (!AGENT_NAME.test(name) || name.length > MAX_NAME_LENGTH) {
    throw new CodedError('agent-name', `${sourcePath}: ${JSON.stringify(name)} is not a valid agent name (lowercase letters, digits and hyphens, at most ${MAX_NAME_LENGTH} characters)`);
  }
  if (RESERVED_NAME.test(name)) {
    throw new CodedError('agent-name-reserved', `${sourcePath}: ${JSON.stringify(name)} looks like one of Kiro's built-in agents (kiro_...)`);
  }
  if (typeof description !== 'string' || description.trim() === '') {
    throw new CodedError('agent-description', `${sourcePath}: the agent has no description`);
  }
  for (const key of ['model', 'color']) {
    if (key in doc.data && typeof doc.data[key] !== 'string') {
      throw new CodedError('agent-frontmatter', `${sourcePath}: ${key} must be a string`);
    }
  }
  if (tools === undefined) throw new CodedError('agent-tools', `${sourcePath}: the agent has no tools line`);

  const mapped = mapTools(tools, sourcePath);
  const shellRules = mapped.includes('shell');

  const frontmatter = { name, description: description.trim(), tools: mapped };
  if (shellRules) frontmatter.permissions = sameKeysAs(SHELL_PERMISSIONS);

  return {
    name,
    dest: `${AGENT_DIR}/${name}.md`,
    content: stringifyDocument(frontmatter, doc.body, { eol: doc.eol }),
    tools: mapped,
    shellRules,
    dropped: { model: doc.data.model ?? null, color: doc.data.color ?? null },
  };
}
