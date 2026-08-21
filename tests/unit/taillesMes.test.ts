import { describe, it, expect } from 'vitest'
import {
  TAILLES_MES_DEFAUTS,
  estTailleOfferte,
  sanitizeTaillesMes,
  taillesMesEffectives,
} from '@/lib/taillesMes'
import { sanitizeMoteurReglages } from '@/lib/moteurs'

/** Tableau des tailles MES (20/08/2026) — rubrique « Tailles » de la fiche moteur. */
describe('tableau des tailles MES (20/08/2026)', () => {
  it('défauts = catalogue 2027 (extraction PDF) — bornes de chaque famille', () => {
    expect(estTailleOfferte(TAILLES_MES_DEFAUTS.janus, 300, 120)).toBe(true)
    expect(estTailleOfferte(TAILLES_MES_DEFAUTS.janus, 400, 195)).toBe(true)
    // Les combos INEXISTANTS au catalogue ne sont pas offerts par défaut.
    expect(estTailleOfferte(TAILLES_MES_DEFAUTS.janus, 300, 195)).toBe(false)
    expect(estTailleOfferte(TAILLES_MES_DEFAUTS.terminus, 600, 195)).toBe(true)
    expect(estTailleOfferte(TAILLES_MES_DEFAUTS.terminus, 600, 120)).toBe(false)
    expect(estTailleOfferte(TAILLES_MES_DEFAUTS.forculus, 100, 195)).toBe(true)
  })

  it('sanitize : dédoublonne, trie, borne — liste vide acceptée (tout refusé)', () => {
    expect(sanitizeTaillesMes([{ w: 400, h: 140 }, { w: 300, h: 140 }, { w: 300, h: 140 }])).toEqual([
      { w: 300, h: 140 },
      { w: 400, h: 140 },
    ])
    expect(sanitizeTaillesMes([])).toEqual([])
    expect(sanitizeTaillesMes([{ w: 20, h: 140 }])).toBeUndefined()
    expect(sanitizeTaillesMes('rien')).toBeUndefined()
  })

  it('delta MoteurReglages : accepté, null = retour catalogue', () => {
    const out = sanitizeMoteurReglages({ taillesMes: [{ w: 300, h: 140 }] })
    expect(out.taillesMes).toEqual([{ w: 300, h: 140 }])
    expect(sanitizeMoteurReglages({ taillesMes: null }).taillesMes).toBeUndefined()
    // Effectives : delta prioritaire, sinon défauts.
    expect(taillesMesEffectives('janus', [{ w: 300, h: 140 }])).toEqual([{ w: 300, h: 140 }])
    expect(taillesMesEffectives('janus')).toEqual(
      [...TAILLES_MES_DEFAUTS.janus].sort((a, b) => a.w - b.w || a.h - b.h)
    )
  })
})
