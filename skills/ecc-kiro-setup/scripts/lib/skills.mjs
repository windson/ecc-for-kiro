// Validator for SKILL.md files, following https://agentskills.io/specification
// and the limits Kiro documents at https://kiro.dev/docs/skills.md.

import { FrontmatterError, parseFrontmatter, quoteString } from './frontmatter.mjs';

export const NAME_MAX = 64;
export const DESCRIPTION_MAX = 1024;
export const COMPATIBILITY_MAX = 500;
export const BODY_LINES_RECOMMENDED = 500;

/** Frontmatter fields defined by the specification. */
export const SPEC_FIELDS = Object.freeze(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools']);

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function checkName(name, dirName, errors) {
  const add = (code, message) => errors.push({ code, message });
  if (name === undefined || name === null) {
    add('name-missing', 'frontmatter needs a "name"');
    return;
  }
  if (typeof name !== 'string') {
    add('name-type', `"name" must be a string, found ${Array.isArray(name) ? 'list' : typeof name}`);
    return;
  }
  if (name.length < 1 || name.length > NAME_MAX) {
    add('name-length', `"name" must be 1-${NAME_MAX} characters, found ${name.length}`);
  }
  if (!/^[a-z0-9-]*$/.test(name)) {
    add('name-charset', '"name" may only use lowercase letters a-z, digits 0-9 and hyphens');
  }
  if (name.startsWith('-') || name.endsWith('-')) {
    add('name-hyphen-edge', '"name" must not start or end with a hyphen');
  }
  if (name.includes('--')) {
    add('name-double-hyphen', '"name" must not contain consecutive hyphens');
  }
  if (dirName !== undefined && name !== dirName) {
    add('name-dir-mismatch', `"name" (${name}) must match the directory name (${dirName})`);
  }
}

function checkDescription(description, errors) {
  const add = (code, message) => errors.push({ code, message });
  if (description === undefined || description === null) {
    add('description-missing', 'frontmatter needs a "description"');
    return;
  }
  if (typeof description !== 'string') {
    add('description-type', `"description" must be a string, found ${Array.isArray(description) ? 'list' : typeof description}`);
    return;
  }
  if (description.trim() === '') {
    add('description-empty', '"description" must not be empty');
    return;
  }
  if (description.length > DESCRIPTION_MAX) {
    add('description-length', `"description" must be at most ${DESCRIPTION_MAX} characters, found ${description.length}`);
  }
}

/**
 * Validate one SKILL.md.
 * Errors are rule violations that make a skill invalid; warnings are advisory.
 * @param {string} text file contents
 * @param {{ dirName?: string }} [options] parent directory name, which `name` must equal
 */
export function validateSkillMarkdown(text, { dirName } = {}) {
  const errors = [];
  const warnings = [];
  const info = { extraFields: [], bodyLines: 0 };
  const result = (name = null, description = null) => ({
    ok: errors.length === 0,
    name,
    description,
    errors,
    warnings,
    info,
  });

  let parsed;
  try {
    parsed = parseFrontmatter(text);
  } catch (error) {
    if (error instanceof FrontmatterError) {
      errors.push({ code: 'frontmatter-unparseable', message: error.message });
      return result();
    }
    throw error;
  }
  if (!parsed.hasFrontmatter) {
    errors.push({ code: 'frontmatter-missing', message: 'SKILL.md must start with YAML frontmatter ("---")' });
    return result();
  }

  const { data } = parsed;
  checkName(data.name, dirName, errors);
  checkDescription(data.description, errors);

  if (data.compatibility !== undefined && data.compatibility !== null) {
    if (typeof data.compatibility !== 'string') {
      errors.push({ code: 'compatibility-type', message: '"compatibility" must be a string' });
    } else if (data.compatibility.length < 1 || data.compatibility.length > COMPATIBILITY_MAX) {
      errors.push({
        code: 'compatibility-length',
        message: `"compatibility" must be 1-${COMPATIBILITY_MAX} characters, found ${data.compatibility.length}`,
      });
    }
  }

  if (data.metadata !== undefined && data.metadata !== null) {
    if (!isPlainObject(data.metadata)) {
      errors.push({ code: 'metadata-type', message: '"metadata" must be a map of string keys to string values' });
    } else {
      const nonString = Object.keys(data.metadata).filter((key) => typeof data.metadata[key] !== 'string');
      if (nonString.length > 0) {
        warnings.push({
          code: 'metadata-value-type',
          message: `"metadata" values should be strings; not strings: ${nonString.join(', ')}`,
        });
      }
    }
  }

  if (data.license !== undefined && data.license !== null && typeof data.license !== 'string') {
    warnings.push({ code: 'license-type', message: '"license" should be a string' });
  }
  if (data['allowed-tools'] !== undefined && data['allowed-tools'] !== null && typeof data['allowed-tools'] !== 'string') {
    warnings.push({ code: 'allowed-tools-type', message: '"allowed-tools" should be a space-separated string' });
  }

  info.extraFields = Object.keys(data).filter((key) => !SPEC_FIELDS.includes(key)).sort();
  info.bodyLines = parsed.body === '' ? 0 : parsed.body.replace(/\r?\n$/, '').split(/\r?\n/).length;
  if (info.bodyLines > BODY_LINES_RECOMMENDED) {
    warnings.push({
      code: 'body-long',
      message: `body has ${info.bodyLines} lines; the specification recommends staying under ${BODY_LINES_RECOMMENDED}`,
    });
  }

  return result(
    typeof data.name === 'string' ? data.name : null,
    typeof data.description === 'string' ? data.description : null,
  );
}

// ---- repairing the one rule that can be repaired safely ----------------------------

/** A sentence that ends before this many characters is not worth keeping on its own. */
const MIN_SENTENCE_CHARS = 200;

/**
 * Shorten a description to `max` characters: at the last sentence end that leaves a useful amount of
 * text, otherwise at the last word boundary.
 */
export function trimDescription(description, max = DESCRIPTION_MAX) {
  const text = description.trim();
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const sentenceEnd = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '));
  if (sentenceEnd + 1 >= MIN_SENTENCE_CHARS) return head.slice(0, sentenceEnd + 1);
  const space = head.lastIndexOf(' ');
  return (space > 0 ? head.slice(0, space) : head).trimEnd();
}

/**
 * Repair a SKILL.md whose only hard-rule problem is an overlong description, by rewriting the
 * description line(s) and nothing else: the rest of the frontmatter and the whole body stay as they were.
 * @param {string} text
 * @returns {{ text: string, patches: { field: string, code: string, before: string, after: string }[] } | null}
 *   null when there is nothing to repair, or when something other than the description length is wrong
 */
export function patchSkillMarkdown(text, { dirName } = {}) {
  const verdict = validateSkillMarkdown(text, { dirName });
  if (verdict.ok || verdict.errors.some((error) => error.code !== 'description-length')) return null;

  const parsed = parseFrontmatter(text);
  const entry = parsed.entries.find((item) => item.key === 'description');
  const before = parsed.data.description;
  const after = trimDescription(before);
  const lines = text.split(/(?<=\n)/);
  const lastLine = lines[entry.endLine - 1];
  const eol = /\r?\n$/.exec(lastLine)?.[0] ?? '\n';
  lines.splice(entry.startLine - 1, entry.endLine - entry.startLine + 1, `description: ${quoteString(after)}${eol}`);
  return { text: lines.join(''), patches: [{ field: 'description', code: 'description-length', before, after }] };
}
