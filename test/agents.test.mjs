import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AGENT_DIR, SHELL_PERMISSIONS, TOOL_TAGS, convertAgent, mapTool, mapTools } from '../skills/ecc-kiro-setup/scripts/lib/agents.mjs';
import { CodedError } from '../skills/ecc-kiro-setup/scripts/lib/exit.mjs';
import { parseFrontmatter } from '../skills/ecc-kiro-setup/scripts/lib/frontmatter.mjs';

const agent = (frontmatter, body = '\n## Body\n\nDo the work.\n') => `---\n${frontmatter}\n---\n${body}`;
const PLANNER = agent('name: planner\ndescription: Plans work.\ntools: Read, Grep, Glob\nmodel: opus');

const codeOf = (fn) => {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof CodedError, `expected a CodedError, got ${error}`);
    return error.code;
  }
  return assert.fail('expected an error');
};

describe('mapTool', () => {
  it('maps every Claude Code tool ECC uses to a Kiro tag', () => {
    const expected = {
      Read: 'read', Grep: 'read', Glob: 'read',
      Write: 'write', Edit: 'write', MultiEdit: 'write',
      Bash: 'shell',
      WebFetch: 'web', WebSearch: 'web',
      Task: 'subagent', Agent: 'subagent',
    };
    assert.deepEqual({ ...TOOL_TAGS }, expected);
    for (const [name, tag] of Object.entries(expected)) assert.equal(mapTool(name), tag, name);
  });

  it('maps MCP tools to @server/tool, keeping hyphens and underscores in the tool name', () => {
    assert.equal(mapTool('mcp__context7__resolve-library-id'), '@context7/resolve-library-id');
    assert.equal(mapTool('mcp__context7__query-docs'), '@context7/query-docs');
    assert.equal(mapTool('mcp__playwright__browser_take_screenshot'), '@playwright/browser_take_screenshot');
    assert.equal(mapTool('mcp__my-server__do.thing'), '@my-server/do.thing');
  });

  it('rejects anything else, including names that only look like properties of an object', () => {
    for (const name of ['NotebookEdit', 'read', 'mcp__only', 'mcp____tool', 'mcp__srv__', 'mcp__a_b__tool', '__proto__', 'constructor', 'toString', 'hasOwnProperty', '']) {
      assert.equal(codeOf(() => mapTool(name)), 'agent-tool-unknown', JSON.stringify(name));
    }
  });
});

describe('mapTools', () => {
  it('reads a comma-separated string, keeps first-seen order and drops duplicates', () => {
    assert.deepEqual(mapTools('Read, Grep, Glob, Bash'), ['read', 'shell']);
    assert.deepEqual(mapTools('Bash,Read,Edit,Write,Grep'), ['shell', 'read', 'write']);
    assert.deepEqual(mapTools('  Read ,  Read  '), ['read']);
  });

  it('accepts a list', () => {
    assert.deepEqual(mapTools(['Read', 'WebSearch', 'WebFetch']), ['read', 'web']);
  });

  it('rejects empty, malformed and non-string input', () => {
    for (const value of ['', '  ', 'Read,,Grep', 'Read,', ',Read', [], ['Read', ''], ['Read', 3], 7, null, { Read: true }]) {
      assert.equal(codeOf(() => mapTools(value)), 'agent-tools', JSON.stringify(value));
    }
  });
});

describe('convertAgent', () => {
  it('rewrites the frontmatter and leaves the body alone', () => {
    const result = convertAgent({ path: 'agents/planner.md', text: PLANNER });
    assert.equal(result.name, 'planner');
    assert.equal(result.dest, '.kiro/agents/planner.md');
    assert.equal(
      result.content,
      ['---', 'name: "planner"', 'description: "Plans work."', 'tools: ["read"]', '---', '', '## Body', '', 'Do the work.', ''].join('\n'),
    );
    assert.deepEqual(result.tools, ['read']);
    assert.equal(result.shellRules, false);
    assert.deepEqual(result.dropped, { model: 'opus', color: null });
  });

  it('copies the body byte for byte, whatever it contains', () => {
    const body = '\n---\nnot frontmatter: `x`\n\t\ttabs, trailing spaces   \n\n\n# こんにちは ✓\n```yaml\n---\n```\nno final newline';
    const result = convertAgent({ path: 'agents/planner.md', text: agent('name: planner\ndescription: Plans.\ntools: Read', body) });
    assert.equal(parseFrontmatter(result.content).body, body);
    assert.ok(result.content.endsWith(body));
  });

  it('gives agents that run shell commands permission rules for read-only git, and nobody else', () => {
    const shell = convertAgent({ path: 'agents/code-reviewer.md', text: agent('name: code-reviewer\ndescription: Reviews.\ntools: Read, Grep, Glob, Bash\nmodel: sonnet') });
    assert.deepEqual(shell.tools, ['read', 'shell']);
    assert.equal(shell.shellRules, true);
    const parsed = parseFrontmatter(shell.content).data;
    assert.deepEqual(parsed.permissions, JSON.parse(JSON.stringify(SHELL_PERMISSIONS)));
    assert.deepEqual(parsed.permissions.rules[0].match, ['git diff*', 'git log*', 'git status*', 'git show*']);
    assert.deepEqual(parsed.permissions.rules[0].exclude, ['*--output*']);
    assert.equal(parsed.permissions.rules[0].effect, 'allow');
    assert.equal(parsed.permissions.rules[0].capability, 'shell');

    const plain = convertAgent({ path: 'agents/planner.md', text: PLANNER });
    assert.equal('permissions' in parseFrontmatter(plain.content).data, false);
    const writer = convertAgent({ path: 'agents/tdd.md', text: agent('name: tdd\ndescription: Tests.\ntools: Read, Write, Edit') });
    assert.equal('permissions' in parseFrontmatter(writer.content).data, false, 'write without shell gets no rules');
  });

  it('maps MCP tools the way docs-lookup needs them', () => {
    const result = convertAgent({
      path: 'agents/docs-lookup.md',
      text: agent('name: docs-lookup\ndescription: Looks up docs.\ntools: Read, Grep, mcp__context7__resolve-library-id, mcp__context7__query-docs\nmodel: haiku'),
    });
    assert.deepEqual(result.tools, ['read', '@context7/resolve-library-id', '@context7/query-docs']);
    assert.deepEqual(parseFrontmatter(result.content).data.tools, result.tools);
  });

  it('keeps a description intact through quoting: colons, quotes, hashes, unicode, leading symbols', () => {
    const description = `Use "quotes": yes # not a comment, 'single', * star, @at, - dash, [x], {y}, é✓, back\\slash`;
    const text = agent(`name: planner\ndescription: ${JSON.stringify(description)}\ntools: Read`);
    const result = convertAgent({ path: 'agents/planner.md', text });
    assert.equal(parseFrontmatter(result.content).data.description, description);
  });

  it('reads folded and quoted descriptions', () => {
    const folded = convertAgent({ path: 'agents/planner.md', text: agent('name: planner\ndescription: >-\n  Plans\n  work.\ntools: Read') });
    assert.equal(parseFrontmatter(folded.content).data.description, 'Plans work.');
    const single = convertAgent({ path: 'agents/planner.md', text: agent("name: planner\ndescription: 'It''s a plan'\ntools: Read") });
    assert.equal(parseFrontmatter(single.content).data.description, "It's a plan");
  });

  it('writes CRLF frontmatter for a CRLF file and still copies the body unchanged', () => {
    const text = '---\r\nname: planner\r\ndescription: Plans.\r\ntools: Read\r\n---\r\n\r\n## Body\r\n';
    const result = convertAgent({ path: 'agents/planner.md', text });
    assert.ok(result.content.startsWith('---\r\nname: "planner"\r\n'));
    assert.ok(result.content.endsWith('---\r\n\r\n## Body\r\n'));
    assert.doesNotMatch(result.content.replace(/\r\n/g, ''), /\n/);
  });

  it('accepts a BOM and reports color and model as dropped', () => {
    const text = `\uFEFF${agent('name: planner\ndescription: Plans.\ntools: Read\nmodel: haiku\ncolor: green')}`;
    const result = convertAgent({ path: 'agents/planner.md', text });
    assert.ok(result.content.startsWith('---\n'));
    assert.deepEqual(result.dropped, { model: 'haiku', color: 'green' });
    assert.equal('model' in parseFrontmatter(result.content).data, false);
    assert.equal('color' in parseFrontmatter(result.content).data, false);
  });

  it('puts every agent in .kiro/agents under its own name', () => {
    assert.equal(AGENT_DIR, '.kiro/agents');
    const result = convertAgent({ path: 'agents/go-build-resolver.md', text: agent('name: go-build-resolver\ndescription: Fixes.\ntools: Read') });
    assert.equal(result.dest, '.kiro/agents/go-build-resolver.md');
  });

  describe('stops with a clear code on', () => {
    const run = (path, text) => codeOf(() => convertAgent({ path, text }));

    it('missing or broken frontmatter', () => {
      assert.equal(run('agents/planner.md', '# just a body\n'), 'agent-frontmatter');
      assert.equal(run('agents/planner.md', agent('name: planner\nname: planner\ndescription: x\ntools: Read')), 'agent-frontmatter');
      assert.equal(run('agents/planner.md', '---\nname: planner\n'), 'agent-frontmatter');
      assert.equal(run('agents/planner.md', agent('name: planner\ndescription: has: a colon\ntools: Read')), 'agent-frontmatter');
    });

    it('keys that are not part of the ECC agent format', () => {
      assert.equal(run('agents/planner.md', agent('name: planner\ndescription: x\ntools: Read\ntemperature: 0.2')), 'agent-key-unknown');
      assert.equal(run('agents/planner.md', agent('name: planner\ndescription: x\ntools: Read\nallowedTools: [read]')), 'agent-key-unknown');
    });

    it('a name that is missing, differs from the file, or is not valid', () => {
      assert.equal(run('agents/planner.md', agent('description: x\ntools: Read')), 'agent-name');
      assert.equal(run('agents/planner.md', agent('name: architect\ndescription: x\ntools: Read')), 'agent-name');
      assert.equal(run('agents/Planner.md', agent('name: Planner\ndescription: x\ntools: Read')), 'agent-name');
      assert.equal(run('agents/my_agent.md', agent('name: my_agent\ndescription: x\ntools: Read')), 'agent-name');
      assert.equal(run('agents/-x.md', agent('name: -x\ndescription: x\ntools: Read')), 'agent-name');
      const long = 'a'.repeat(65);
      assert.equal(run(`agents/${long}.md`, agent(`name: ${long}\ndescription: x\ntools: Read`)), 'agent-name');
    });

    it('a name that could be mistaken for one of Kiro\'s own agents', () => {
      for (const name of ['kiro_default', 'kiro-planner', 'KIRO_help']) {
        assert.ok(['agent-name', 'agent-name-reserved'].includes(run(`agents/${name}.md`, agent(`name: ${name}\ndescription: x\ntools: Read`))), name);
      }
      assert.equal(run('agents/kiro-planner.md', agent('name: kiro-planner\ndescription: x\ntools: Read')), 'agent-name-reserved');
      assert.equal(run('agents/kiro_default.md', agent('name: kiro_default\ndescription: x\ntools: Read')), 'agent-name');
    });

    it('a missing or empty description', () => {
      assert.equal(run('agents/planner.md', agent('name: planner\ntools: Read')), 'agent-description');
      assert.equal(run('agents/planner.md', agent('name: planner\ndescription: ""\ntools: Read')), 'agent-description');
      assert.equal(run('agents/planner.md', agent('name: planner\ndescription:   \ntools: Read')), 'agent-description');
    });

    it('tools that are missing, empty or unknown', () => {
      assert.equal(run('agents/planner.md', agent('name: planner\ndescription: x')), 'agent-tools');
      assert.equal(run('agents/planner.md', agent('name: planner\ndescription: x\ntools: ""')), 'agent-tools');
      assert.equal(run('agents/planner.md', agent('name: planner\ndescription: x\ntools: Read, NotebookEdit')), 'agent-tool-unknown');
    });

    it('a model or color that is not a string', () => {
      assert.equal(run('agents/planner.md', agent('name: planner\ndescription: x\ntools: Read\nmodel: [opus]')), 'agent-frontmatter');
      assert.equal(run('agents/planner.md', agent('name: planner\ndescription: x\ntools: Read\ncolor: 3')), 'agent-frontmatter');
    });
  });
});
