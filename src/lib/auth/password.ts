import crypto from 'node:crypto'

/**
 * Hachage de mot de passe avec scrypt (intégré à Node — pas de dépendance native
 * à compiler sur Windows). Format stocké : scrypt$<sel hex>$<hash hex>.
 */

const KEYLEN = 64

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(password, salt, KEYLEN).toString('hex')
  return `scrypt$${salt}$${hash}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split('$')
  if (scheme !== 'scrypt' || !salt || !hash) return false
  const candidate = crypto.scryptSync(password, salt, KEYLEN)
  const reference = Buffer.from(hash, 'hex')
  return candidate.length === reference.length && crypto.timingSafeEqual(candidate, reference)
}

export function generatePassword(length = 12): string {
  // Alphabet sans caractères ambigus (0/O, 1/l/I).
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789'
  const bytes = crypto.randomBytes(length)
  let out = ''
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length]
  return out
}
