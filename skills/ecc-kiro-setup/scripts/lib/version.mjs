// Tiny version helpers. Versions are compared as numeric major.minor.patch.

const VERSION_RE = /(\d+)\.(\d+)(?:\.(\d+))?/;

/**
 * Extract a normalized "major.minor.patch" string from arbitrary text.
 * @param {unknown} text
 * @returns {string | null}
 */
export function parseVersion(text) {
  const match = VERSION_RE.exec(String(text ?? ''));
  if (!match) return null;
  return `${match[1]}.${match[2]}.${match[3] ?? '0'}`;
}

/**
 * @param {string} a normalized version
 * @param {string} b normalized version
 * @returns {-1 | 0 | 1}
 */
export function compareVersions(a, b) {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * @param {string | null | undefined} version
 * @param {string} minimum
 */
export function atLeast(version, minimum) {
  const parsed = parseVersion(version);
  return parsed !== null && compareVersions(parsed, minimum) >= 0;
}
