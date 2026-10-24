'use strict';

const crypto = require('node:crypto');

const KEYLEN = 64;
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(String(password), salt, KEYLEN, SCRYPT_OPTS).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, expected] = parts;
  let derived;
  try {
    derived = crypto.scryptSync(String(password), salt, KEYLEN, SCRYPT_OPTS).toString('hex');
  } catch {
    return false;
  }
  const a = Buffer.from(derived, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

function randomPassword() {
  // Readable, high-entropy, no ambiguous characters.
  const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const pick = () => alphabet[crypto.randomInt(0, alphabet.length)];
  const groups = [4, 4, 4, 4].map(() => Array.from({ length: 4 }, pick).join(''));
  return groups.join('-');
}

module.exports = { hashPassword, verifyPassword, randomToken, randomPassword };
