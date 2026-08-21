import crypto from 'node:crypto'
import type Database from 'better-sqlite3'
import { getDb } from '@/lib/db'
import { hashPassword, verifyPassword } from '@/lib/auth/password'

export const SESSION_COOKIE = 'portagen_session'
// Expiration glissante : chaque visite repousse l'échéance en base de SESSION_DAYS.
// Le cookie doit durer plus longtemps que la base (sinon il expire avant elle) :
// on ne le repose qu'au login, donc on lui donne un an.
const SESSION_DAYS = 30
const COOKIE_DAYS = 365

export interface UserRow {
  id: number
  username: string
  role: 'admin' | 'user'
  created_at: string
}

export function authenticate(
  username: string,
  password: string,
  db: Database.Database = getDb()
): UserRow | null {
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as
    | (UserRow & { password_hash: string })
    | undefined
  if (!row) return null
  if (!verifyPassword(password, row.password_hash)) return null
  return { id: row.id, username: row.username, role: row.role, created_at: row.created_at }
}

export function createSession(userId: number, db: Database.Database = getDb()): { token: string; maxAge: number } {
  const token = crypto.randomBytes(32).toString('hex')
  const maxAge = COOKIE_DAYS * 24 * 3600
  db.prepare(
    `INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+${SESSION_DAYS} days'))`
  ).run(token, userId)
  return { token, maxAge }
}

export function getUserBySession(token: string | undefined, db: Database.Database = getDb()): UserRow | null {
  if (!token) return null
  db.prepare(`DELETE FROM sessions WHERE expires_at < datetime('now')`).run()
  const row = db
    .prepare(
      `SELECT u.id, u.username, u.role, u.created_at FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at >= datetime('now')`
    )
    .get(token) as UserRow | undefined
  if (row) {
    db.prepare(
      `UPDATE sessions SET expires_at = datetime('now', '+${SESSION_DAYS} days') WHERE token = ?`
    ).run(token)
  }
  return row ?? null
}

export function deleteSession(token: string | undefined, db: Database.Database = getDb()): void {
  if (!token) return
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
}

export function listUsers(db: Database.Database = getDb()): UserRow[] {
  return db
    .prepare('SELECT id, username, role, created_at FROM users ORDER BY username')
    .all() as UserRow[]
}

export function createUser(
  username: string,
  password: string,
  role: 'admin' | 'user',
  db: Database.Database = getDb()
): UserRow {
  const clean = username.trim().toLowerCase()
  if (!/^[a-z0-9._-]{2,32}$/.test(clean)) {
    throw new Error('Nom d’utilisateur invalide (2-32 caractères : lettres, chiffres, . _ -)')
  }
  if (password.length < 8) throw new Error('Mot de passe trop court (8 caractères minimum)')
  db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(
    clean,
    hashPassword(password),
    role
  )
  return db
    .prepare('SELECT id, username, role, created_at FROM users WHERE username = ?')
    .get(clean) as UserRow
}

export function resetPassword(userId: number, password: string, db: Database.Database = getDb()): void {
  if (password.length < 8) throw new Error('Mot de passe trop court (8 caractères minimum)')
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), userId)
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId) // déconnecte partout
}

/**
 * Suppression d'un compte (21/08/2026, demande Mathias) : refuse le DERNIER
 * admin — l'application deviendrait inadministrable. Le refus de supprimer SON
 * PROPRE compte est vérifié par la route (elle seule connaît l'appelant). Les
 * sessions du compte sont fermées ; ses générations et sessions de travail
 * sont conservées (created_by ne porte que le nom, pas de lien cassé).
 */
export function deleteUser(userId: number, db: Database.Database = getDb()): void {
  const row = db.prepare('SELECT id, role FROM users WHERE id = ?').get(userId) as
    | { id: number; role: 'admin' | 'user' }
    | undefined
  if (!row) throw new Error('Compte introuvable')
  if (row.role === 'admin') {
    const admins = (
      db.prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin'`).get() as { n: number }
    ).n
    if (admins <= 1) throw new Error('Impossible de supprimer le dernier compte admin')
  }
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId)
  db.prepare('DELETE FROM users WHERE id = ?').run(userId)
}
