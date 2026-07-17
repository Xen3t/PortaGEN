import { describe, expect, it } from 'vitest'
import { getDb } from '@/lib/db'
import { DEFAULT_BRAND, getUserBrand, isBrandKey, setUserBrand } from '@/lib/brands'

describe('marque par utilisateur (navigation v2)', () => {
  it('valide les clés de marque', () => {
    expect(isBrandKey('casanoov')).toBe(true)
    expect(isBrandKey('cazeboo')).toBe(true)
    expect(isBrandKey('sicaan')).toBe(true)
    expect(isBrandKey('SICANN')).toBe(false) // orthographe serveur ≠ clé
    expect(isBrandKey(null)).toBe(false)
  })

  it('mémorise la marque par utilisateur, avec repli sur le défaut', () => {
    const db = getDb(':memory:') // l'admin id 1 est seedé
    expect(getUserBrand(1, db)).toBe(DEFAULT_BRAND)
    setUserBrand(1, 'cazeboo', db)
    expect(getUserBrand(1, db)).toBe('cazeboo')
    // Valeur corrompue en base → défaut, jamais d'erreur.
    db.prepare(`UPDATE users SET brand = 'nimporte' WHERE id = 1`).run()
    expect(getUserBrand(1, db)).toBe(DEFAULT_BRAND)
    // Utilisateur inconnu → défaut.
    expect(getUserBrand(999, db)).toBe(DEFAULT_BRAND)
  })
})
