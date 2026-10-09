// Shared constants for ecc-kiro-setup. Keep this file free of logic.

export const SKILL_NAME = 'ecc-kiro-setup';
export const SKILL_VERSION = '0.1.0';

// The one ECC release this build knows how to install.
export const ECC_REPO_URL = 'https://github.com/affaan-m/ECC.git';
export const ECC_VERSION = '2.2.3';
export const ECC_TAG = 'v2.2.3';
export const ECC_COMMIT = 'c05b2d6614f62f6db0047669aa4eefb223d478f9';

export const PROFILE_ID = 'kimi-parity';
export const PROFILE_SCHEMA = 'ecc-kiro.profile.v1';
export const STATE_SCHEMA = 'ecc-kiro.install.v1';
export const DOCTOR_SCHEMA = 'ecc-kiro.doctor.v1';

// Paths are relative to the project root and use forward slashes.
export const KIRO_DIR = '.kiro';
export const STATE_RELATIVE_PATH = '.kiro/ecc/install-state.json';
export const KIROIGNORE_FILE = '.kiroignore';
export const KIROIGNORE_BLOCK_BEGIN = '# >>> ecc-kiro-setup (managed block, do not edit) >>>';
export const KIROIGNORE_BLOCK_END = '# <<< ecc-kiro-setup <<<';
// The install state records the managed block of .kiroignore as one owned "file" of this category.
export const KIROIGNORE_CATEGORY = 'kiroignore';

// Harness folders that may hold instructions Kiro would otherwise pick up.
export const HARNESS_DIRS = Object.freeze([
  '.claude',
  '.kimi-code',
  '.codex',
  '.cursor',
  '.gemini',
  '.opencode',
  '.qwen',
  '.zed',
  '.codebuddy',
  '.joycode',
  '.hermes',
  '.openclaw',
  '.adal',
]);

// Subfolders of .kiro that an ECC install or a user may have created.
export const KIRO_SUBDIRS = Object.freeze([
  'agents',
  'docs',
  'ecc',
  'hooks',
  'settings',
  'skills',
  'specs',
  'steering',
  'workflows',
]);

// Steering that is always on is sent with every request, so the installer keeps it small.
export const ALWAYS_ON_LIMIT_BYTES = 25_000;

export const MIN_NODE = '18.0.0';
export const MIN_GIT_PARTIAL = '2.25.0';
export const KIRO_CLI_NATIVE_V3 = '3.0.0';

/** Directory name used for the pinned checkout inside the source cache. */
export function cacheCheckoutName() {
  return `ECC-${ECC_TAG}-${ECC_COMMIT.slice(0, 7)}`;
}
