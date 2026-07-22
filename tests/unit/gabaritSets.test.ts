import { describe, it, expect } from 'vitest'
import { getDb, listSizes } from '@/lib/db'
import { sanitizeSizeParams } from '@/lib/db/sizeParams'
import {
  COULISSANT_XL_MIN_W,
  GABARIT_SET_DEFAULTS,
  gabaritSetForSize,
  isGabaritSetKey,
} from '@/lib/gabaritSets'
import { computeLayout } from '@/lib/geometry'

describe('jeu de gabarits coulissant XL (chantier 22/07/2026)', () => {
  it('seed 12 tailles XL (450-600 × 140/160/180) — le 400 reste dans le jeu standard', () => {
    const db = getDb(':memory:')
    const xl = listSizes(db, 'coulissant-xl')
    expect(xl.map((s) => s.label)).toEqual([
      '450x140',
      '450x160',
      '450x180',
      '500x140',
      '500x160',
      '500x180',
      '550x140',
      '550x160',
      '550x180',
      '600x140',
      '600x160',
      '600x180',
    ])
    // Décision Mathias 22/07/2026 : le 400 ne bouge pas (rendus validés inchangés).
    expect(listSizes(db, 'coulissant').some((s) => s.width_cm === 400)).toBe(true)
    expect(xl.some((s) => s.width_cm === 400)).toBe(false)
  })

  it('aiguille les coulissants ≥ 450 vers le jeu XL — jamais les autres moteurs', () => {
    expect(COULISSANT_XL_MIN_W).toBe(450)
    expect(gabaritSetForSize('coulissant', 400)).toBe('coulissant')
    expect(gabaritSetForSize('coulissant', 450)).toBe('coulissant-xl')
    expect(gabaritSetForSize('coulissant', 600)).toBe('coulissant-xl')
    expect(gabaritSetForSize('battant', 600)).toBe('battant')
    expect(gabaritSetForSize('portillon', 600)).toBe('portillon')
    expect(isGabaritSetKey('coulissant-xl')).toBe(true)
    expect(isGabaritSetKey('coulissant')).toBe(true)
    expect(isGabaritSetKey('nimporte')).toBe(false)
  })

  it('la scène XL par défaut contient une lame de 6 m et ses piliers — la standard la clampe', () => {
    const xl = computeLayout({ w: 600, h: 180 }, GABARIT_SET_DEFAULTS['coulissant-xl'])
    expect(xl.isClamped).toBe(false)
    expect(xl.pillarLeft.x).toBeGreaterThan(0)
    // La scène standard (~480 cm de large), elle, perd les piliers : c'est la
    // raison d'être du jeu XL.
    expect(computeLayout({ w: 600, h: 180 }).isClamped).toBe(true)
  })

  it('sceneH passe la sanitation des réglages de gabarit (bornes 250-800)', () => {
    expect(sanitizeSizeParams({ sceneH: 480 })).toEqual({ sceneH: 480 })
    expect(sanitizeSizeParams({ sceneH: 100 })).toBeNull()
    expect(sanitizeSizeParams({ sceneH: 900 })).toBeNull()
  })
})
