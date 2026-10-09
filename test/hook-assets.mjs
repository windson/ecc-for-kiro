// Test support for the hooks part: the guard script that ships in the skill, as the plan loads it,
// and a way to write a legacy (.kiro.hook) hook as the text of a synthetic ECC source file.

import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { OWNED_SCRIPTS } from '../skills/ecc-kiro-setup/scripts/lib/owned.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** The folder of the scripts that ship in the skill and are installed as they are. */
export const SHIPPED_RUNTIME_DIR = path.resolve(HERE, '..', 'skills', 'ecc-kiro-setup', 'scripts', 'runtime');

/** The path of the guard script. */
export const SHIPPED_GUARD_PATH = path.join(SHIPPED_RUNTIME_DIR, 'git-push-guard.mjs');

/** The hook data that ships in the skill, the way the plan loads it. */
export const shippedHookAssets = () => ({ guard: readFileSync(SHIPPED_GUARD_PATH, 'utf8') });

/** The scripts of the owned part, as the plan loads them. */
export const shippedOwnedAssets = () => ({ scripts: Object.fromEntries(OWNED_SCRIPTS.map((file) => [file, readFileSync(path.join(SHIPPED_RUNTIME_DIR, file), 'utf8')])) });

/**
 * Write the guard into `<skillDir>/scripts/runtime`, the way the skill ships it, and the scripts of the owned part
 * next to it. Pass `owned: false` to leave the owned scripts out.
 */
export async function writeHookAssets(skillDir, assets = shippedHookAssets()) {
  const dir = path.join(skillDir, 'scripts', 'runtime');
  await mkdir(dir, { recursive: true });
  if (assets.guard !== undefined) await writeFile(path.join(dir, 'git-push-guard.mjs'), assets.guard);
  if (assets.owned !== false) {
    for (const [file, text] of Object.entries(shippedOwnedAssets().scripts)) await writeFile(path.join(dir, file), text);
  }
}

/**
 * The text of a legacy hook file, with the shape of the 13 in ECC's Kiro adapter. Pass `when` and
 * `then` as they appear in the file; `extra` adds or replaces top-level keys.
 */
export function legacyHookText({ name, description = `The ${name} hook.`, when, then, ...extra }) {
  return `${JSON.stringify({ name, version: '1.0.0', enabled: true, description, when, then, ...extra }, null, 2)}\n`;
}

/** The ECC path of a legacy hook. */
export const legacyHookPath = (name) => `.kiro/hooks/${name}.kiro.hook`;
