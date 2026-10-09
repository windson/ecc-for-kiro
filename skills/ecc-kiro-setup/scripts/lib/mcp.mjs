// The MCP server examples: ECC's catalog and the example of its Kiro adapter, as one file in the shape
// of Kiro's mcp.json with every server switched off, and a table that says what each server is.
//
// Pure. The files go to .kiro/ecc/. They never go to .kiro/settings, where Kiro would start the servers.

import { CodedError } from './exit.mjs';

export const MCP_CATEGORY = 'mcp';
export const MCP_EXAMPLE_DEST = '.kiro/ecc/mcp.json.example';
export const MCP_TABLE_DEST = '.kiro/ecc/mcp-servers.md';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isStringMap = (value) => isObject(value) && Object.values(value).every((item) => typeof item === 'string');

const SERVER_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
/** Every key a server may have in the two sources. Another key stops the conversion, so a new field is never dropped unseen. */
const SOURCE_KEYS = Object.freeze(['command', 'args', 'env', 'url', 'headers', 'description', 'type', 'disabled', 'autoApprove']);
/** Keys that are not carried over: Kiro does not use them, or they would approve tools without asking. */
const LEFT_OUT = Object.freeze(['description', 'type', 'disabled', 'autoApprove']);
/** The keys Kiro documents for a server, in the order they are written. */
const OUTPUT_ORDER = Object.freeze(['command', 'args', 'url', 'headers', 'env']);
/** A value the user has to fill in: a YOUR_..._HERE placeholder, a path to adapt, or a reference to a variable of their shell. */
const PLACEHOLDER = /YOUR_[A-Z0-9_]+|\/path\/to\/|\/absolute\/path\/|\$\{[A-Za-z0-9_]+\}/;

const fail = (code, where, message) => new CodedError(code, `${where}: ${message}`);

/** Check one server and return the entry to write, plus the keys that were left out. */
function convertServer({ name, entry, where }) {
  const at = `server "${name}"`;
  if (!SERVER_NAME.test(name)) throw fail('mcp-server-name', where, `${JSON.stringify(name)} is not a usable server name (letters, digits, dots, hyphens and underscores)`);
  if (!isObject(entry)) throw fail('mcp-server-shape', where, `${at} must be an object`);
  const unknown = Object.keys(entry).filter((key) => !SOURCE_KEYS.includes(key));
  if (unknown.length > 0) throw fail('mcp-unknown-field', where, `${at} has a field this build does not know (${unknown.join(', ')})`);

  const local = entry.command !== undefined;
  const remote = entry.url !== undefined;
  if (local === remote) throw fail('mcp-server-shape', where, `${at} needs either "command" or "url", and not both`);
  if (local && (typeof entry.command !== 'string' || entry.command === '')) throw fail('mcp-server-shape', where, `${at}: "command" must be text`);
  if (entry.args !== undefined && (!local || !Array.isArray(entry.args) || !entry.args.every((arg) => typeof arg === 'string'))) {
    throw fail('mcp-server-shape', where, `${at}: "args" must be a list of text and goes with "command"`);
  }
  if (remote) {
    let protocol = null;
    try {
      protocol = typeof entry.url === 'string' ? new URL(entry.url).protocol : null;
    } catch {
      // protocol stays null
    }
    if (protocol !== 'https:' && protocol !== 'http:') throw fail('mcp-server-shape', where, `${at}: "url" must be an http or https address`);
  }
  for (const key of ['env', 'headers']) {
    if (entry[key] !== undefined && !isStringMap(entry[key])) throw fail('mcp-server-shape', where, `${at}: "${key}" must map names to text`);
  }
  if (entry.headers !== undefined && !remote) throw fail('mcp-server-shape', where, `${at}: "headers" goes with "url"`);
  if (entry.description !== undefined && typeof entry.description !== 'string') throw fail('mcp-server-shape', where, `${at}: "description" must be text`);
  if (entry.type !== undefined && typeof entry.type !== 'string') throw fail('mcp-server-shape', where, `${at}: "type" must be text`);
  if (entry.disabled !== undefined && typeof entry.disabled !== 'boolean') throw fail('mcp-server-shape', where, `${at}: "disabled" must be true or false`);
  if (entry.autoApprove !== undefined && !(Array.isArray(entry.autoApprove) && entry.autoApprove.every((item) => typeof item === 'string'))) {
    throw fail('mcp-server-shape', where, `${at}: "autoApprove" must be a list of tool names`);
  }

  const out = {};
  for (const key of OUTPUT_ORDER) if (entry[key] !== undefined) out[key] = entry[key];
  out.disabled = true;
  return { out, left: LEFT_OUT.filter((key) => key !== 'disabled' && entry[key] !== undefined) };
}

/** Read one source: parse it, check its top level and convert each server. */
function readSource({ path, text, allowed }) {
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw fail('mcp-invalid-json', path, `not valid JSON (${error.message})`);
  }
  if (!isObject(value) || !isObject(value.mcpServers)) throw fail('mcp-shape', path, 'must be an object with an "mcpServers" object');
  const extra = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extra.length > 0) throw fail('mcp-shape', path, `has a top-level field this build does not know (${extra.join(', ')})`);
  return Object.entries(value.mcpServers).map(([name, entry]) => ({ name, path, description: isObject(entry) && typeof entry.description === 'string' ? entry.description : null, ...convertServer({ name, entry, where: path }) }));
}

// ---- the table ----------------------------------------------------------------

/** One line of text that is safe inside a table cell. */
const cell = (text) => String(text).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').replaceAll('|', '\\|').trim();
const code = (text) => `\`${cell(text).replaceAll('`', "'")}\``;

/** What the user has to fill in before a server works: the env and header entries that hold a placeholder, and a placeholder in the arguments. */
function needs(entry) {
  const names = [...Object.entries({ ...entry.env, ...entry.headers })].filter(([, value]) => PLACEHOLDER.test(value)).map(([name]) => name);
  if ((entry.args ?? []).some((arg) => PLACEHOLDER.test(arg))) names.push('a value in the arguments');
  return names.length === 0 ? 'nothing' : names.join(', ');
}

const starts = (entry) => (entry.command === undefined ? entry.url : [entry.command, ...(entry.args ?? [])].join(' '));

function buildTable(servers, counts) {
  const lines = [
    '# MCP server examples',
    '',
    `\`mcp.json.example\` holds ${counts.servers} MCP servers: ${counts.fromCatalog} from the catalog of ECC and ${counts.fromAdapter} from the example of ECC's Kiro adapter. Every one is switched off with "disabled": true. Kiro does not read the file, so nothing here starts a server.`,
    '',
    'To use a server:',
    '',
    '1. Copy its entry into `.kiro/settings/mcp.json` for this project, or into `~/.kiro/settings/mcp.json` for every project. Kiro does not let the agent write there, so edit the file yourself.',
    '2. Change "disabled" to false.',
    '3. Replace each placeholder such as `YOUR_API_KEY_HERE`. To keep a secret out of the file, write `${NAME}` and set NAME in your shell. Kiro asks you to approve each variable first.',
    '',
    "Keep the number of servers you switch on small, because each one adds tools to the model's context. These servers are third-party software and services with their own terms.",
    '',
    'Left out of the entries: the description (it is in the table), the `type` field, which Kiro does not use, and the tool approval lists of the adapter example. Add `autoApprove` yourself if you want a tool to run without asking.',
    '',
    '| Server | From | Starts | Needs | About |',
    '|---|---|---|---|---|',
  ];
  for (const server of servers) {
    const about = server.description === null ? "example of ECC's Kiro adapter" : server.description;
    lines.push(`| ${cell(server.name)} | ${server.from} | ${code(starts(server.out))} | ${cell(needs(server.out))} | ${cell(about)} |`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Convert the two sources.
 * @param {{ catalog: { path: string, text: string }, adapter: { path: string, text: string } }} input
 * @returns {{ example: string, table: string, summary: { servers: number, fromCatalog: number, fromAdapter: number, local: number, remote: number, names: string[], left: Record<string, number> } }}
 */
export function convertMcp({ catalog, adapter }) {
  const fromCatalog = readSource({ ...catalog, allowed: ['mcpServers', '_comments'] }).map((server) => ({ ...server, from: 'catalog' }));
  const fromAdapter = readSource({ ...adapter, allowed: ['mcpServers'] }).map((server) => ({ ...server, from: 'adapter' }));
  const servers = [...fromCatalog, ...fromAdapter];

  const seen = new Map();
  for (const server of servers) {
    if (seen.has(server.name)) throw fail('mcp-duplicate', server.path, `the server "${server.name}" is also in ${seen.get(server.name)}`);
    seen.set(server.name, server.path);
  }

  const left = {};
  for (const server of servers) for (const key of server.left) left[key] = (left[key] ?? 0) + 1;
  const summary = {
    servers: servers.length,
    fromCatalog: fromCatalog.length,
    fromAdapter: fromAdapter.length,
    local: servers.filter((server) => server.out.command !== undefined).length,
    remote: servers.filter((server) => server.out.url !== undefined).length,
    names: servers.map((server) => server.name),
    left: Object.fromEntries(Object.entries(left).sort(([a], [b]) => (a < b ? -1 : 1))),
  };
  const example = `${JSON.stringify({ mcpServers: Object.fromEntries(servers.map((server) => [server.name, server.out])) }, null, 2)}\n`;
  return { example, table: buildTable(servers, summary), summary };
}
