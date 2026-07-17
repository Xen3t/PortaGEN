import { describe, it, expect } from 'vitest'
import { getDb } from '@/lib/db'
import { buildCorridorAddendum, insertAddenda } from '@/lib/pipeline/decor'
import type { CorridorInfo } from '@/lib/images/canny'

/**
 * Assemblage du prompt décor (refonte 11/07/2026) : addendum couloir versionné
 * (« decor-couloir », placeholders remplis par le moteur) et insertion des
 * addenda AVANT le bloc LAYOUT (verrou CANNY en position finale).
 */

const db = getDb(':memory:')
const corridor: CorridorInfo = { widthCm: 400, x1Px: 213, x2Px: 2315, yTopPx: 1036, yBottomPx: 1308 }

describe('buildCorridorAddendum', () => {
  it('remplit la largeur en mètres et l’ancre visuelle en % de la largeur d’image', () => {
    const { text, version, degraded } = buildCorridorAddendum(400, corridor, 2528, db)
    expect(degraded).toBe(false)
    expect(version).toBe(1)
    expect(text).toContain('4.0 m')
    // (2315 − 213) / 2528 ≈ 83 % → arrondi au multiple de 5 : 85 %
    expect(text).toContain('85% of the image width')
    expect(text).not.toContain('{WIDTH')
  })

  it('couloir désactivé : la contrainte d’ouverture part quand même, sans largeur ni placeholder', () => {
    const { text, degraded } = buildCorridorAddendum(null, null, 2528, db)
    expect(degraded).toBe(true)
    expect(text).toContain('ENTRANCE FOREGROUND')
    expect(text).not.toContain('{WIDTH')
    expect(text).not.toContain('m wide')
  })
})

describe('insertAddenda', () => {
  it('insère les addenda AVANT le bloc LAYOUT : le verrou CANNY reste lu en dernier', () => {
    const prompt = 'Header\n\nDescription.\n\nLAYOUT GUIDE (attached image) — LOCKED:\nrules'
    const out = insertAddenda(prompt, '\n\nADDENDUM')
    expect(out.indexOf('ADDENDUM')).toBeGreaterThan(out.indexOf('Description.'))
    expect(out.indexOf('ADDENDUM')).toBeLessThan(out.indexOf('LAYOUT GUIDE'))
    expect(out.endsWith('rules')).toBe(true)
  })

  it('sans marqueur (prompts v3 et antérieurs) : addenda ajoutés à la fin, comme avant', () => {
    const out = insertAddenda('Description.', '\n\nADDENDUM')
    expect(out).toBe('Description.\n\nADDENDUM')
  })
})
