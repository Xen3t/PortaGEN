import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword, generatePassword } from '@/lib/auth/password'
import { getDb } from '@/lib/db'
import {
  authenticate,
  createSession,
  getUserBySession,
  deleteSession,
  createUser,
  resetPassword,
  deleteUser,
  listUsers,
} from '@/lib/auth/store'
import { getActivePrompt, savePromptVersion, listPromptVersions, listPromptNames } from '@/lib/db/prompts'

describe('mots de passe', () => {
  it('hache et vérifie un mot de passe', () => {
    const stored = hashPassword('mon-secret-42')
    expect(stored.startsWith('scrypt$')).toBe(true)
    expect(verifyPassword('mon-secret-42', stored)).toBe(true)
    expect(verifyPassword('mauvais', stored)).toBe(false)
  })

  it('génère des mots de passe distincts et lisibles', () => {
    const a = generatePassword()
    const b = generatePassword()
    expect(a).toHaveLength(12)
    expect(a).not.toBe(b)
    expect(/^[a-zA-Z0-9]+$/.test(a)).toBe(true)
  })
})

describe('comptes et sessions', () => {
  it('seed un admin utilisable en base de test', () => {
    const db = getDb(':memory:')
    expect(authenticate('admin', 'test-password', db)).toMatchObject({ role: 'admin' })
    expect(authenticate('admin', 'faux', db)).toBeNull()
  })

  it('crée un utilisateur, ouvre et ferme une session', () => {
    const db = getDb(':memory:')
    const user = createUser('mathias', 'motdepasse!', 'user', db)
    expect(user.role).toBe('user')

    const { token } = createSession(user.id, db)
    expect(getUserBySession(token, db)).toMatchObject({ username: 'mathias' })

    deleteSession(token, db)
    expect(getUserBySession(token, db)).toBeNull()
  })

  it('refuse les mots de passe trop courts et invalide les sessions au reset', () => {
    const db = getDb(':memory:')
    expect(() => createUser('theo', 'court', 'user', db)).toThrow(/trop court/)
    const user = createUser('theo', 'assez-long-1', 'user', db)
    const { token } = createSession(user.id, db)
    resetPassword(user.id, 'nouveau-mdp-1', db)
    expect(getUserBySession(token, db)).toBeNull() // déconnecté partout
    expect(authenticate('theo', 'nouveau-mdp-1', db)).not.toBeNull()
  })

  it('supprime un compte (sessions fermées), jamais le dernier admin (21/08)', () => {
    const db = getDb(':memory:')
    const user = createUser('paul', 'motdepasse-1', 'user', db)
    const { token } = createSession(user.id, db)
    deleteUser(user.id, db)
    expect(listUsers(db).some((u) => u.username === 'paul')).toBe(false)
    expect(getUserBySession(token, db)).toBeNull() // sessions fermées avec le compte
    // Le seed ne contient qu'UN admin : sa suppression est refusée.
    const admin = listUsers(db).find((u) => u.role === 'admin')!
    expect(() => deleteUser(admin.id, db)).toThrow(/dernier compte admin/)
    // Un second admin lève le verrou : le premier devient supprimable.
    const admin2 = createUser('admin2', 'motdepasse-2', 'admin', db)
    deleteUser(admin.id, db)
    expect(listUsers(db).filter((u) => u.role === 'admin')).toHaveLength(1)
    expect(() => deleteUser(admin2.id, db)).toThrow(/dernier compte admin/)
    // Compte inexistant : erreur claire, jamais silencieux.
    expect(() => deleteUser(9999, db)).toThrow(/introuvable/)
  })
})

describe('prompts versionnés', () => {
  it('seed les 3 prompts système depuis Prompt System/', () => {
    const db = getDb(':memory:')
    const names = listPromptNames(db).map((p) => p.name)
    expect(names).toContain('moodboard-llm')
    expect(names).toContain('piliers-murets')
    expect(names).toContain('integration')
    expect(getActivePrompt('piliers-murets', db).version).toBe(1)
  })

  it('une nouvelle version devient active sans écraser l’historique', () => {
    const db = getDb(':memory:')
    const v2 = savePromptVersion('piliers-murets', 'x'.repeat(50), 'admin', 'test', db)
    expect(v2.version).toBe(2)
    expect(getActivePrompt('piliers-murets', db).version).toBe(2)
    const versions = listPromptVersions('piliers-murets', db)
    expect(versions).toHaveLength(2)
    expect(versions[1].version).toBe(1) // l'historique reste lisible
  })
})
