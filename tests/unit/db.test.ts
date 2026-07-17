import { describe, it, expect } from 'vitest'
import { getDb, listSizes, logApiCall, BATTANT_SIZES } from '@/lib/db'
import {
  sanitizeSizeParams,
  saveSizeParamsOverride,
  getSizeParamsOverride,
  listSizeParamsOverrides,
} from '@/lib/db/sizeParams'

describe('référentiel des tailles battants', () => {
  it('contient exactement 18 références (3 largeurs × 6 hauteurs)', () => {
    expect(BATTANT_SIZES).toHaveLength(18)
    const widths = new Set(BATTANT_SIZES.map((s) => s.w))
    const heights = new Set(BATTANT_SIZES.map((s) => s.h))
    expect([...widths].sort((a, b) => a - b)).toEqual([300, 350, 400])
    expect([...heights].sort((a, b) => a - b)).toEqual([100, 120, 140, 160, 180, 200])
  })

  it('seed la base au premier lancement, sans doublon au second', () => {
    const db = getDb(':memory:')
    const sizes = listSizes(db)
    expect(sizes).toHaveLength(18)
    expect(sizes[0]).toMatchObject({ width_cm: 300, height_cm: 100, label: '300x100' })
    expect(sizes[17]).toMatchObject({ width_cm: 400, height_cm: 200, label: '400x200' })
    // Re-migration (idempotence)
    const labels = new Set(sizes.map((s) => s.label))
    expect(labels.size).toBe(18)
  })
})

describe('réglages de gabarit par taille', () => {
  it('filtre les clés/valeurs invalides et refuse groundY', () => {
    expect(
      sanitizeSizeParams({ pillarWidth: 35, groundY: 50, capStyle: 'flat', pillarH: 999 })
    ).toEqual({ pillarWidth: 35, capStyle: 'flat' })
    // Anciennes clés (pilier lié au muret, avant le 11/07/2026) : ignorées silencieusement.
    expect(sanitizeSizeParams({ pillarOverhang: 22, muretRatio: 70 })).toBeNull()
    expect(sanitizeSizeParams({ nimporte: 1 })).toBeNull()
    expect(sanitizeSizeParams('texte')).toBeNull()
  })

  it('accepte les hauteurs découplées (globales et par taille)', () => {
    expect(
      sanitizeSizeParams({ pillarHMin: 150, pillarHMax: 210, muretHMin: 90, muretHMax: 110 })
    ).toEqual({ pillarHMin: 150, pillarHMax: 210, muretHMin: 90, muretHMax: 110 })
    expect(sanitizeSizeParams({ pillarH: 195, muretH: 80 })).toEqual({ pillarH: 195, muretH: 80 })
  })

  it('enregistre, relit, écrase et supprime un override', () => {
    const db = getDb(':memory:')
    saveSizeParamsOverride('300x140', { pillarWidth: 35, muretH: 95 }, 'battant', db)
    expect(getSizeParamsOverride('300x140', 'battant', db)).toEqual({ pillarWidth: 35, muretH: 95 })
    saveSizeParamsOverride('300x140', { pillarWidth: 40 }, 'battant', db)
    expect(getSizeParamsOverride('300x140', 'battant', db)).toEqual({ pillarWidth: 40 })
    expect(Object.keys(listSizeParamsOverrides('battant', db))).toEqual(['300x140'])
    saveSizeParamsOverride('300x140', null, 'battant', db)
    expect(getSizeParamsOverride('300x140', 'battant', db)).toBeNull()
  })

  it('sépare les dérogations par moteur (règle 13/07/2026 : jamais partagées)', () => {
    const db = getDb(':memory:')
    saveSizeParamsOverride('100x140', { pillarWidth: 35 }, 'battant', db)
    saveSizeParamsOverride('100x140', { pillarWidth: 25 }, 'portillon', db)
    expect(getSizeParamsOverride('100x140', 'battant', db)).toEqual({ pillarWidth: 35 })
    expect(getSizeParamsOverride('100x140', 'portillon', db)).toEqual({ pillarWidth: 25 })
    expect(Object.keys(listSizeParamsOverrides('portillon', db))).toEqual(['100x140'])
    // Supprimer côté portillon ne touche pas le battant.
    saveSizeParamsOverride('100x140', null, 'portillon', db)
    expect(getSizeParamsOverride('100x140', 'portillon', db)).toBeNull()
    expect(getSizeParamsOverride('100x140', 'battant', db)).toEqual({ pillarWidth: 35 })
  })
})

describe('journal des appels API', () => {
  it('enregistre un appel avec ses tokens et son artefact', () => {
    const db = getDb(':memory:')
    logApiCall(
      {
        provider: 'gemini',
        model: 'gemini-3-pro-image',
        kind: 'image.generate',
        durationMs: 1234,
        inputTokens: 100,
        outputTokens: 2000,
        totalTokens: 2100,
        ok: true,
        artifactPath: 'data/artifacts/test.png',
      },
      db
    )
    const row = db.prepare('SELECT * FROM api_calls').get() as Record<string, unknown>
    expect(row.provider).toBe('gemini')
    expect(row.ok).toBe(1)
    expect(row.total_tokens).toBe(2100)
  })
})
