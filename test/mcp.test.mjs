// The MCP examples, with synthetic servers: what is carried over, what is left out, what stops the
// conversion, and what the table looks like.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CodedError } from '../skills/ecc-kiro-setup/scripts/lib/exit.mjs';
import { MCP_EXAMPLE_DEST, MCP_TABLE_DEST, convertMcp } from '../skills/ecc-kiro-setup/scripts/lib/mcp.mjs';

const CATALOG_PATH = 'mcp-configs/mcp-servers.json';
const ADAPTER_PATH = '.kiro/settings/mcp.json.example';

const catalog = (servers, extra = {}) => ({ path: CATALOG_PATH, text: JSON.stringify({ mcpServers: servers, ...extra }) });
const adapter = (servers) => ({ path: ADAPTER_PATH, text: JSON.stringify({ mcpServers: servers }) });
const convert = (catalogServers, adapterServers = {}, extra = {}) => convertMcp({ catalog: catalog(catalogServers, extra), adapter: adapter(adapterServers) });
const failure = (catalogServers, adapterServers, extra) => {
  try {
    convert(catalogServers, adapterServers, extra);
  } catch (error) {
    assert.ok(error instanceof CodedError, String(error));
    return error;
  }
  return assert.fail('expected the conversion to stop');
};
const example = (result) => JSON.parse(result.example);

const GITHUB = {
  command: 'npx',
  args: ['-y', '@example/server-github'],
  env: { GITHUB_TOKEN: 'YOUR_GITHUB_PAT_HERE' },
  description: 'GitHub operations',
};
const REMOTE = { type: 'http', url: 'https://mcp.example.com/mcp', description: 'A hosted server' };

describe('convertMcp: what ends up in the example', () => {
  it('writes one entry per server in the shape of Kiro\'s mcp.json, every one switched off', () => {
    const result = convert({ github: GITHUB, hosted: REMOTE });
    assert.deepEqual(example(result), {
      mcpServers: {
        github: { command: 'npx', args: ['-y', '@example/server-github'], env: { GITHUB_TOKEN: 'YOUR_GITHUB_PAT_HERE' }, disabled: true },
        hosted: { url: 'https://mcp.example.com/mcp', disabled: true },
      },
    });
    assert.ok(result.example.endsWith('}\n'));
    assert.ok(result.example.startsWith('{\n  "mcpServers": {\n'), 'indented by two');
  });

  it('keeps the placeholders and the values of env and headers exactly as they are', () => {
    const result = convert({
      jira: { command: 'uvx', args: ['mcp-atlassian==0.21.0'], env: { JIRA_URL: 'YOUR_JIRA_URL_HERE', TOKEN: '${TOKEN}' } },
      memx: { url: 'https://mcp.example.com/mcp', headers: { Authorization: 'Bearer YOUR_KEY_HERE' } },
      files: { command: 'npx', args: ['-y', 'server', '/path/to/your/projects'] },
    });
    const servers = example(result).mcpServers;
    assert.deepEqual(servers.jira.env, { JIRA_URL: 'YOUR_JIRA_URL_HERE', TOKEN: '${TOKEN}' });
    assert.deepEqual(servers.memx.headers, { Authorization: 'Bearer YOUR_KEY_HERE' });
    assert.deepEqual(servers.files.args, ['-y', 'server', '/path/to/your/projects']);
  });

  it('writes the keys in a fixed order, with disabled last', () => {
    const result = convert({ s: { env: { A: 'x' }, args: ['a'], command: 'run' }, r: { headers: { H: 'v' }, url: 'https://example.com/m' } });
    const servers = example(result).mcpServers;
    assert.deepEqual(Object.keys(servers.s), ['command', 'args', 'env', 'disabled']);
    assert.deepEqual(Object.keys(servers.r), ['url', 'headers', 'disabled']);
  });

  it('puts the servers of the catalog first and those of the adapter after them, in the order of the sources', () => {
    const result = convert({ zeta: { command: 'z' }, alpha: { command: 'a' } }, { beta: { command: 'b' }, aardvark: { command: 'c' } });
    assert.deepEqual(Object.keys(example(result).mcpServers), ['zeta', 'alpha', 'beta', 'aardvark']);
    assert.deepEqual(result.summary.names, ['zeta', 'alpha', 'beta', 'aardvark']);
  });

  it('turns a server that was on in its source off, whatever the source said', () => {
    const result = convert({ a: { command: 'a' } }, { on: { command: 'x', disabled: false }, off: { command: 'y', disabled: true }, bare: { command: 'z' } });
    for (const server of Object.values(example(result).mcpServers)) assert.strictEqual(server.disabled, true);
    assert.equal(result.example.includes('"disabled": false'), false);
  });

  it('leaves out description, type and autoApprove, and says how many of each it left out', () => {
    const result = convert(
      { a: { ...GITHUB }, b: { ...REMOTE }, c: { command: 'c' } },
      { d: { command: 'd', disabled: false, autoApprove: ['search_docs', 'fetch_doc'] }, e: { command: 'e', autoApprove: ['x'] } },
    );
    for (const key of ['description', 'type', 'autoApprove', 'approve']) assert.equal(result.example.includes(`"${key}"`), false, key);
    assert.deepEqual(result.summary.left, { autoApprove: 2, description: 1 + 1, type: 1 });
  });

  it('counts the servers by where they came from and how they run', () => {
    const result = convert({ a: GITHUB, b: REMOTE, c: { command: 'c' } }, { d: { command: 'd' } });
    assert.deepEqual(
      { servers: result.summary.servers, fromCatalog: result.summary.fromCatalog, fromAdapter: result.summary.fromAdapter, local: result.summary.local, remote: result.summary.remote },
      { servers: 4, fromCatalog: 3, fromAdapter: 1, local: 3, remote: 1 },
    );
  });

  it('accepts a local server on localhost over plain http, and an empty adapter', () => {
    const result = convert({ dev: { type: 'http', url: 'http://localhost:18801/mcp' } });
    assert.equal(example(result).mcpServers.dev.url, 'http://localhost:18801/mcp');
    assert.equal(result.summary.fromAdapter, 0);
  });

  it('gives the same text for the same input', () => {
    const a = convert({ github: GITHUB, hosted: REMOTE }, { x: { command: 'x' } });
    const b = convert({ github: GITHUB, hosted: REMOTE }, { x: { command: 'x' } });
    assert.equal(a.example, b.example);
    assert.equal(a.table, b.table);
  });

  it('writes to .kiro/ecc and never to .kiro/settings', () => {
    assert.equal(MCP_EXAMPLE_DEST, '.kiro/ecc/mcp.json.example');
    assert.equal(MCP_TABLE_DEST, '.kiro/ecc/mcp-servers.md');
    for (const dest of [MCP_EXAMPLE_DEST, MCP_TABLE_DEST]) assert.equal(dest.includes('settings'), false, dest);
  });
});

describe('convertMcp: what stops it', () => {
  it('stops on a field it does not know, so a field a later release adds is not dropped unseen', () => {
    const error = failure({ a: { command: 'a', oauth: { clientId: 'x' } } });
    assert.equal(error.code, 'mcp-unknown-field');
    assert.match(error.message, new RegExp(`^${CATALOG_PATH}: server "a" has a field this build does not know \\(oauth\\)$`));
    assert.equal(failure({}, { b: { command: 'b', timeout: 5 } }).code, 'mcp-unknown-field');
  });

  it('stops on a server that is neither local nor remote, or both', () => {
    assert.equal(failure({ a: { args: ['x'] } }).code, 'mcp-server-shape');
    assert.equal(failure({ a: { command: 'x', url: 'https://example.com/m' } }).code, 'mcp-server-shape');
    assert.match(failure({ a: {} }).message, /needs either "command" or "url", and not both/);
  });

  it('stops on values of the wrong kind', () => {
    const cases = {
      'command is a list': { command: ['x'] },
      'command is empty': { command: '' },
      'args is text': { command: 'x', args: '-y' },
      'args holds a number': { command: 'x', args: [1] },
      'args with a url': { url: 'https://example.com/m', args: ['x'] },
      'url is not an address': { url: 'not a url' },
      'url is a file': { url: 'file:///etc/passwd' },
      'url is javascript': { url: 'javascript:alert(1)' },
      'env holds a number': { command: 'x', env: { A: 1 } },
      'env is a list': { command: 'x', env: ['A'] },
      'headers with a command': { command: 'x', headers: { A: 'b' } },
      'headers hold a number': { url: 'https://example.com/m', headers: { A: 2 } },
      'description is a number': { command: 'x', description: 5 },
      'type is a number': { command: 'x', type: 5 },
      'disabled is text': { command: 'x', disabled: 'no' },
      'autoApprove is text': { command: 'x', autoApprove: 'all' },
    };
    for (const [name, entry] of Object.entries(cases)) assert.equal(failure({ a: entry }).code, 'mcp-server-shape', name);
    assert.equal(failure({ a: 'just text' }).code, 'mcp-server-shape');
    assert.equal(failure({ a: null }).code, 'mcp-server-shape');
    assert.equal(failure({ a: ['command'] }).code, 'mcp-server-shape');
  });

  it('stops on a server name that is not a plain name', () => {
    for (const name of ['', '__proto__', '-x', '.hidden', 'a b', 'a/b', 'a|b', 'a\nb', 'x`y']) {
      assert.equal(failure(JSON.parse(`{${JSON.stringify(name)}: {"command": "x"}}`)).code, 'mcp-server-name', JSON.stringify(name));
    }
  });

  it('stops on a server that both sources define, and names both places', () => {
    const error = failure({ shared: { command: 'a' } }, { shared: { command: 'b' } });
    assert.equal(error.code, 'mcp-duplicate');
    assert.match(error.message, new RegExp(`^${ADAPTER_PATH}: the server "shared" is also in ${CATALOG_PATH}$`));
  });

  it('stops on a file that is not what it should be', () => {
    const bad = (source, other) => {
      try {
        convertMcp(other === 'adapter' ? { catalog: catalog({}), adapter: source } : { catalog: source, adapter: adapter({}) });
      } catch (error) {
        return error;
      }
      return assert.fail('expected a failure');
    };
    assert.equal(bad({ path: CATALOG_PATH, text: '{ nope' }).code, 'mcp-invalid-json');
    assert.match(bad({ path: CATALOG_PATH, text: '{ nope' }).message, new RegExp(`^${CATALOG_PATH}: not valid JSON`));
    assert.equal(bad({ path: CATALOG_PATH, text: '[]' }).code, 'mcp-shape');
    assert.equal(bad({ path: CATALOG_PATH, text: '{}' }).code, 'mcp-shape');
    assert.equal(bad({ path: CATALOG_PATH, text: '{"mcpServers": []}' }).code, 'mcp-shape');
    assert.equal(bad({ path: CATALOG_PATH, text: '{"mcpServers": {}, "servers": {}}' }).code, 'mcp-shape');
    assert.equal(bad({ path: ADAPTER_PATH, text: '{"mcpServers": {}, "_comments": {}}' }, 'adapter').code, 'mcp-shape', '_comments belongs to the catalog only');
    assert.equal(bad({ path: ADAPTER_PATH, text: 'x' }, 'adapter').code, 'mcp-invalid-json');
  });

  it('accepts _comments in the catalog, and leaves it out of the example', () => {
    const result = convert({ a: { command: 'a' } }, {}, { _comments: { usage: 'Copy the servers you need to your ~/.claude.json' } });
    assert.equal(result.example.includes('_comments'), false);
    assert.equal(result.example.includes('claude'), false);
  });
});

describe('convertMcp: the table', () => {
  const rows = (table) => table.split('\n').filter((line) => line.startsWith('| ') && !line.startsWith('| Server'));

  it('has one row per server, after a header, and tells the user what to do with the example', () => {
    const { table } = convert({ github: GITHUB, hosted: REMOTE }, { docs: { command: 'npx', args: ['-y', 'react-docs-mcp'] } });
    const lines = table.split('\n');
    assert.equal(lines[0], '# MCP server examples');
    assert.ok(lines.includes('| Server | From | Starts | Needs | About |'));
    assert.ok(lines.includes('|---|---|---|---|---|'));
    assert.equal(rows(table).length, 3);
    assert.match(table, /holds 3 MCP servers: 2 from the catalog of ECC and 1 from the example of ECC's Kiro adapter/);
    assert.match(table, /Every one is switched off with "disabled": true\. Kiro does not read the file/);
    assert.match(table, /Copy its entry into `\.kiro\/settings\/mcp\.json` for this project/);
    assert.match(table, /Kiro does not let the agent write there, so edit the file yourself/);
    assert.ok(table.includes('write `${NAME}` and set NAME in your shell'));
    assert.ok(table.endsWith('|\n'));
  });

  it('says how each server starts and what it needs', () => {
    const { table } = convert(
      {
        github: GITHUB,
        hosted: REMOTE,
        authed: { url: 'https://mcp.example.com/mcp', headers: { Authorization: 'Bearer YOUR_KEY_HERE' } },
        files: { command: 'npx', args: ['-y', 'server', '/path/to/your/projects'] },
        plain: { command: 'tool', args: ['mcp'] },
        both: { command: 'tool', args: ['--project-ref=YOUR_PROJECT_REF'], env: { A: 'x', B: 'y' } },
        mixed: { command: 'tool', env: { LEVEL: 'ERROR', TOKEN: '${MY_TOKEN}', KEY: 'YOUR_KEY_HERE' } },
      },
      { docs: { command: 'npx', args: ['-y', 'react-docs-mcp'] } },
    );
    const byName = Object.fromEntries(rows(table).map((line) => [line.split(' | ')[0].slice(2), line.split(' | ').slice(1)]));
    assert.deepEqual(byName.github.slice(0, 3), ['catalog', '`npx -y @example/server-github`', 'GITHUB_TOKEN']);
    assert.deepEqual(byName.hosted.slice(0, 3), ['catalog', '`https://mcp.example.com/mcp`', 'nothing']);
    assert.equal(byName.authed[2], 'Authorization');
    assert.equal(byName.files[2], 'a value in the arguments');
    assert.equal(byName.plain[2], 'nothing');
    assert.equal(byName.both[2], 'a value in the arguments', 'A and B already hold a value, so they are not needed');
    assert.equal(byName.mixed[2], 'TOKEN, KEY', 'a reference to a variable and a placeholder are needed, a plain value is not');
    assert.deepEqual(byName.docs.slice(0, 2), ['adapter', '`npx -y react-docs-mcp`']);
  });

  it('shows the description of ECC, and a line of its own for the adapter servers that have none', () => {
    const { table } = convert({ github: GITHUB }, { docs: { command: 'x' } });
    assert.match(table, /\| github \| catalog \| `npx -y @example\/server-github` \| GITHUB_TOKEN \| GitHub operations \|/);
    assert.match(table, /\| docs \| adapter \| `x` \| nothing \| example of ECC's Kiro adapter \|/);
  });

  it('keeps hostile text in one table cell: no pipe, no line break, no control character, no backtick in code', () => {
    const { table } = convert({
      evil: { command: 'run`rm`', args: ['a|b'], description: 'Line one\nline two | still the cell\r\n| a | fake | row |\u0007 <script>x</script>' },
    });
    const row = rows(table);
    assert.equal(row.length, 1, 'one row, whatever the description holds');
    assert.equal(row[0].split(/(?<!\\)\|/).length, 7, 'five cells between the outer pipes');
    assert.equal(/[\u0000-\u0008\u000b-\u001f\u007f]/.test(row[0]), false);
    assert.match(row[0], /`run'rm' a\\\|b`/);
    assert.match(row[0], /Line one line two \\\| still the cell \\\| a \\\| fake \\\| row \\\| <script>x<\/script>/);
  });
});
