import { createHash } from 'node:crypto';

/**
 * @param {string | Uint8Array} data strings are hashed as UTF-8
 * @returns {string} lowercase hex SHA-256
 */
export function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex');
}

export const SHA256_PATTERN = /^[0-9a-f]{64}$/;
