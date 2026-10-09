// The validator for Kiro workflow recipes: each rule of the authoring page, one at a time.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BUNDLED_WORKFLOW_AGENTS, MAX_DEPTH, MAX_STEPS, validateWorkflowRecipe } from '../skills/ecc-kiro-setup/scripts/lib/workflow-schema.mjs';

const step = (id, extra = {}) => ({ type: 'step', id, agent: 'wf-planner', prompt: `Do ${id}.`, ...extra });
const recipe = (steps, extra = {}) => ({ name: 'r', inputs: { task: 'prompt' }, steps, ...extra });
const codes = (value, options) => validateWorkflowRecipe(value, options).map((item) => item.code);
const messages = (value, options) => validateWorkflowRecipe(value, options).map((item) => item.message);

describe('validateWorkflowRecipe', () => {
  it('accepts the two-step example of the authoring page', () => {
    const value = {
      name: 'plan-and-implement',
      description: 'Plan a change, then implement it',
      inputs: { task: 'prompt' },
      steps: [
        { type: 'step', id: 'plan', agent: 'wf-planner', prompt: 'Create an implementation plan for: {{task}}. Do not edit files.' },
        { type: 'step', id: 'implement', agent: 'wf-coder', prompt: 'Implement this plan, then run relevant tests:\n\n{{previous.output}}' },
      ],
    };
    assert.deepEqual(validateWorkflowRecipe(value), []);
    assert.deepEqual(validateWorkflowRecipe(value, { knownAgents: BUNDLED_WORKFLOW_AGENTS }), []);
  });
  it('needs an object with a name and a non-empty list of steps, and refuses unknown keys', () => {
    assert.deepEqual(codes(null), ['workflow-shape']);
    assert.deepEqual(codes({ steps: [step('a')] }), ['workflow-name']);
    assert.deepEqual(codes({ name: 'r', steps: [] }), ['workflow-steps']);
    assert.deepEqual(codes(recipe([step('a')], { extra: 1 })), ['workflow-key-unknown']);
    assert.deepEqual(codes(recipe([step('a')], { description: 5 })), ['workflow-description']);
    assert.deepEqual(codes(recipe([step('a')], { inputs: ['x'] })), ['workflow-inputs']);
    assert.deepEqual(codes(recipe([step('a')], { inputs: { 'bad name': 'prompt' } })), ['workflow-inputs']);
  });
  it('checks the fields of every node type and refuses unknown keys and unknown types', () => {
    assert.deepEqual(codes(recipe([{ type: 'step', id: 'a', agent: 'x' }])), ['workflow-step']);
    assert.deepEqual(codes(recipe([{ type: 'step', id: 'a', prompt: 'p' }])), ['workflow-step']);
    assert.deepEqual(codes(recipe([step('a', { cap: 1 })])), ['workflow-key-unknown']);
    assert.deepEqual(codes(recipe([{ type: 'loop', id: 'a' }])), ['workflow-node-type']);
    assert.deepEqual(codes(recipe([{ id: 'a' }])), ['workflow-node-type']);
    assert.deepEqual(codes(recipe([{ type: 'sequence', id: 's', steps: [] }])), ['workflow-container']);
    assert.deepEqual(codes(recipe([{ type: 'watch', id: 'w', handler: 'github-pr' }])), ['workflow-watch']);
    assert.deepEqual(codes(recipe([{ type: 'watch', id: 'w', handler: 'command', config: { command: 'node x.mjs' } }, step('after', { prompt: 'Use {{w.output}}.' })])), []);
    assert.deepEqual(codes(recipe([step('a', { captureOutput: 'yes' })])), ['workflow-step']);
    assert.deepEqual(codes(recipe([step('a', { modelId: '' })])), ['workflow-step']);
  });
  it('needs a unique id on every node', () => {
    assert.deepEqual(codes(recipe([step('a'), step('a')])), ['workflow-id-duplicate']);
    assert.deepEqual(codes(recipe([{ type: 'step', agent: 'x', prompt: 'p' }])), ['workflow-id']);
    assert.deepEqual(codes(recipe([step('a b')])), ['workflow-id']);
    assert.deepEqual(codes(recipe([{ type: 'sequence', id: 'a', steps: [step('a')] }])), ['workflow-id-duplicate']);
  });
  it('limits a recipe to 50 steps and 8 levels', () => {
    const many = Array.from({ length: MAX_STEPS + 1 }, (_, index) => step(`s${index}`));
    assert.deepEqual(codes(recipe(many)), ['workflow-too-many-steps']);
    assert.deepEqual(codes(recipe(many.slice(0, MAX_STEPS))), []);
    let nested = step('leaf');
    for (let level = 1; level < MAX_DEPTH; level += 1) nested = { type: 'sequence', id: `n${level}`, steps: [nested] };
    assert.deepEqual(codes(recipe([nested])), [], 'eight levels are fine');
    assert.deepEqual(codes(recipe([{ type: 'sequence', id: 'top', steps: [nested] }])), ['workflow-depth']);
  });
  it('needs a finite cap and a cap action on every repeat, and one way to stop at most', () => {
    const repeat = (extra) => ({ type: 'repeat', id: 'loop', maxIterations: 3, onMaxIterations: 'pause', steps: [step('body')], ...extra });
    assert.deepEqual(codes(recipe([repeat()])), []);
    assert.deepEqual(codes(recipe([repeat({ maxIterations: undefined })])), ['workflow-repeat']);
    assert.deepEqual(codes(recipe([repeat({ maxIterations: 0 })])), ['workflow-repeat']);
    assert.deepEqual(codes(recipe([repeat({ maxIterations: 1.5 })])), ['workflow-repeat']);
    assert.deepEqual(codes(recipe([repeat({ onMaxIterations: 'stop' })])), ['workflow-repeat']);
    assert.deepEqual(codes(recipe([repeat({ stopCondition: { completionSignal: 'success' }, stopWhen: 'w.terminal' })])), ['workflow-repeat']);
    assert.deepEqual(codes(recipe([repeat({ stopWhen: 'body.output contains DONE' })])), []);
  });
  it('checks stop conditions, and keeps file checks inside the workspace', () => {
    const repeat = (stopCondition) => recipe([{ type: 'repeat', id: 'loop', maxIterations: 3, onMaxIterations: 'abort', stopCondition, steps: [step('body')] }]);
    assert.deepEqual(codes(repeat({ fileCheck: { path: '.kiro/out/status.json', jsonPath: 'done', value: true } })), []);
    assert.deepEqual(codes(repeat({ fileCheck: { path: '.kiro/out/status.json', jsonPath: 'done' } })), ['workflow-stop']);
    assert.deepEqual(codes(repeat({ fileCheck: { path: '/etc/status.json', jsonPath: 'done', value: true } })), ['workflow-artifact-path']);
    assert.deepEqual(codes(repeat({ fileCheck: { path: '../status.json', jsonPath: 'done', value: true } })), ['workflow-artifact-path']);
    assert.deepEqual(codes(repeat({})), ['workflow-stop']);
    assert.deepEqual(codes(repeat({ other: 1 })), ['workflow-stop']);
    assert.deepEqual(codes(repeat({ containsText: 'DONE' })), []);
  });
  it('needs a join policy and branches on a parallel node', () => {
    const parallel = (extra) => ({ type: 'parallel', id: 'p', joinPolicy: 'allSettled', branches: [step('a'), step('b')], ...extra });
    assert.deepEqual(codes(recipe([parallel()])), []);
    assert.deepEqual(codes(recipe([parallel({ joinPolicy: 'first' })])), ['workflow-parallel']);
    assert.deepEqual(codes(recipe([parallel({ branches: [] })])), ['workflow-container']);
  });
  describe('templates', () => {
    it('lets a step read a declared input, an earlier step by id, an earlier artifact and the previous output', () => {
      const value = recipe([
        step('first', { prompt: 'Task: {{task}}', artifacts: { notes: '.kiro/out/notes.md' } }),
        step('second', { prompt: '{{first.output}} {{artifacts.notes}} {{previous.output}} {{ task }}' }),
      ]);
      assert.deepEqual(validateWorkflowRecipe(value), []);
    });
    it('refuses previous.output in the first node of a container and inside a parallel branch', () => {
      assert.deepEqual(codes(recipe([step('a', { prompt: '{{previous.output}}' })])), ['workflow-template-order']);
      assert.deepEqual(codes(recipe([{ type: 'sequence', id: 's', steps: [step('a', { prompt: '{{previous.output}}' })] }])), ['workflow-template-order']);
      assert.deepEqual(codes(recipe([step('x'), { type: 'parallel', id: 'p', joinPolicy: 'all', branches: [step('a', { prompt: '{{previous.output}}' })] }])), ['workflow-template-order']);
    });
    it('refuses a reference to a later step, to another parallel branch, and to an artifact nobody registered', () => {
      assert.deepEqual(codes(recipe([step('a', { prompt: '{{b.output}}' }), step('b')])), ['workflow-template-order']);
      assert.deepEqual(codes(recipe([{ type: 'parallel', id: 'p', joinPolicy: 'all', branches: [step('a'), step('b', { prompt: '{{a.output}}' })] }])), ['workflow-template-order']);
      assert.deepEqual(codes(recipe([step('a', { prompt: '{{artifacts.nope}}' })])), ['workflow-template-order']);
      assert.deepEqual(codes(recipe([{ type: 'parallel', id: 'p', joinPolicy: 'all', branches: [step('a', { artifacts: { x: 'x.md' } }), step('b', { prompt: '{{artifacts.x}}' })] }])), ['workflow-template-order']);
    });
    it('lets a step after a parallel node read the outputs and artifacts of its branches', () => {
      const value = recipe([
        { type: 'parallel', id: 'p', joinPolicy: 'allSettled', branches: [step('a', { artifacts: { x: 'x.md' } }), step('b')] },
        step('join', { prompt: '{{a.output}} {{b.output}} {{artifacts.x}}' }),
      ]);
      assert.deepEqual(validateWorkflowRecipe(value), []);
    });
    it('does not offer the output of a step that does not capture it', () => {
      assert.deepEqual(codes(recipe([step('a', { captureOutput: false }), step('b', { prompt: '{{a.output}}' })])), ['workflow-template-order']);
    });
    it('reports a bare variable that is not an input, because Kiro would leave it as literal text', () => {
      assert.deepEqual(codes(recipe([step('a', { prompt: 'For {{nobody}}' })])), ['workflow-template-input']);
    });
    it('checks the artifact paths too: templates in them, and no path outside the workspace', () => {
      assert.deepEqual(codes(recipe([step('a', { artifacts: { x: '{{nobody}}/x.md' } })])), ['workflow-template-input']);
      assert.deepEqual(codes(recipe([step('a', { artifacts: { x: '/tmp/x.md' } })])), ['workflow-artifact-path']);
      assert.deepEqual(codes(recipe([step('a', { artifacts: { x: 'a/../../x.md' } })])), ['workflow-artifact-path']);
      assert.deepEqual(codes(recipe([step('a', { artifacts: { x: '' } })])), ['workflow-step']);
    });
  });
  it('names a step whose agent is not known, only when it is given the list', () => {
    const value = recipe([step('a', { agent: 'code-reviewer' })]);
    assert.deepEqual(codes(value), []);
    assert.deepEqual(codes(value, { knownAgents: BUNDLED_WORKFLOW_AGENTS }), ['workflow-agent-unknown']);
    assert.deepEqual(codes(value, { knownAgents: [...BUNDLED_WORKFLOW_AGENTS, 'code-reviewer'] }), []);
    assert.match(messages(value, { knownAgents: [] })[0], /the agent "code-reviewer" is not an installed agent or a bundled workflow agent/);
  });
  it('knows the ten agents the authoring page lists', () => {
    assert.equal(BUNDLED_WORKFLOW_AGENTS.length, 10);
    assert.ok(BUNDLED_WORKFLOW_AGENTS.includes('wf-review-aggregator') && BUNDLED_WORKFLOW_AGENTS.includes('semantic_reviewer'));
  });
});
