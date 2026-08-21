import { describe, it, expect } from 'vitest'
import { cadrageDaEffectif, sanitizeCadrageDa, CADRAGE_DA_DEFAUTS } from '@/lib/cadrageDa'
import { bancCadrage, controleCadrageRatio } from '@/lib/decorAutour'
import { computeLayout, DEFAULT_PARAMS } from '@/lib/geometry'

/**
 * Règle RATIO (20/08/2026, tableau croisé du directeur) : vraie largeur +
 * fenêtre de scène proportionnelle à la largeur, UNE référence par famille.
 * Validée sur 26 générations EIGER (planches gabarit-ratio-*).
 */

/** Fraction d'image occupée par le portail pour une taille, selon bancCadrage. */
function fractionPortail(moteur: 'janus' | 'terminus', w: number, h: number): number {
  const bc = bancCadrage(moteur, w)
  const layout = computeLayout({ w, h }, { ...(bc.gabarit ?? {}), ...(bc.refWidth ? { refWidth: bc.refWidth } : {}) })
  return layout.gateW / layout.sceneW
}

describe('règle ratio — bancCadrage (20/08/2026)', () => {
  it('activée par défaut pour battant et coulissant, pas pour le portillon', () => {
    expect(CADRAGE_DA_DEFAUTS.janus.ratioActif).toBe(true)
    expect(CADRAGE_DA_DEFAUTS.terminus.ratioActif).toBe(true)
    expect(CADRAGE_DA_DEFAUTS.forculus.ratioActif).toBe(false)
  })

  it('le portail occupe la MÊME fraction d’image quelle que soit sa largeur — celle du réglage %', () => {
    // Tolérance 0,005 : computeLayout arrondit sceneW au cm entier, d'où un
    // écart résiduel < 0,05 % entre tailles — invisible à l'image.
    const f300 = fractionPortail('janus', 300, 140)
    const f350 = fractionPortail('janus', 350, 140)
    const f400 = fractionPortail('janus', 400, 140)
    expect(f300).toBeCloseTo(f400, 2)
    expect(f350).toBeCloseTo(f400, 2)
    // Le réglage « Portail dans l'image (%) » est la valeur RÉELLE à l'image :
    // 74 % → fraction mesurée 0,74. Le zoom ne s'applique JAMAIS en règle
    // ratio (doublon supprimé, remarque Mathias 20/08) — la recette dézoom du
    // coulissant est re-exprimée dans son propre % (68).
    expect(f400).toBeCloseTo(CADRAGE_DA_DEFAUTS.janus.ratioPortailPct / 100, 2)
    expect(fractionPortail('terminus', 600, 140)).toBeCloseTo(
      CADRAGE_DA_DEFAUTS.terminus.ratioPortailPct / 100,
      2
    )
    expect(bancCadrage('terminus', 400).gabarit?.zoom).toBeUndefined()
    // Coulissant : de 300 à 600 avec la même référence.
    expect(fractionPortail('terminus', 300, 140)).toBeCloseTo(fractionPortail('terminus', 600, 140), 2)
  })

  it('vraie largeur : jamais de refWidth (fin de l’étirement)', () => {
    expect(bancCadrage('janus', 300).refWidth).toBeUndefined()
    expect(bancCadrage('terminus', 600).refWidth).toBeUndefined()
  })

  it('la hauteur d’image suit le vrai ratio H/L : un 300B140 sort plus haut qu’un 400B140', () => {
    const bc300 = bancCadrage('janus', 300)
    const bc400 = bancCadrage('janus', 400)
    const l300 = computeLayout({ w: 300, h: 140 }, bc300.gabarit ?? {})
    const l400 = computeLayout({ w: 400, h: 140 }, bc400.gabarit ?? {})
    expect(l300.gateH / l300.sceneH).toBeGreaterThan(l400.gateH / l400.sceneH)
    // Piliers : 30 cm réels partout → part d’image plus grande sur le 300.
    expect(l300.pillarLeft.w / l300.sceneW).toBeGreaterThan(l400.pillarLeft.w / l400.sceneW)
  })

  it('coulissant : la bascule XL ne joue plus quand le ratio est actif (600 = même règle)', () => {
    const bc = bancCadrage('terminus', 600)
    const c = cadrageDaEffectif('terminus')
    expect(bc.refWidth).toBeUndefined()
    const sceneHRef = ((c.refWidthCm as number) * 100) / c.ratioPortailPct / DEFAULT_PARAMS.mesAspect
    expect(bc.gabarit?.sceneH).toBeCloseTo(sceneHRef * (600 / 400), 5)
    expect(bc.pilierDroitDevant).toBe(true)
  })

  it('rollback : ratio désactivé = ancienne règle telle quelle (étalon + bascule XL)', () => {
    const c = cadrageDaEffectif('terminus', { ratioActif: false })
    expect(bancCadrage('terminus', 350, c).refWidth).toBe(400)
    const xl = bancCadrage('terminus', 600, c)
    expect(xl.refWidth).toBe(c.xlRefWidthCm)
    expect(xl.gabarit?.sceneH).toBe(c.xlSceneH)
  })

  it('portillon : recette du jour inchangée (vraie largeur + zoom)', () => {
    const bc = bancCadrage('forculus', 100)
    expect(bc.refWidth).toBeUndefined()
    expect(bc.gabarit?.zoom).toBe(CADRAGE_DA_DEFAUTS.forculus.zoom)
  })
})

describe('règle ratio — garde-fou du lancement (20/08/2026)', () => {
  it('toutes les tailles du catalogue 2027 passent avec la référence par défaut', () => {
    const battants: [number, number][] = [
      [300, 120], [300, 140], [300, 160], [300, 180],
      [350, 140], [350, 160], [350, 180], [350, 190], [350, 195],
      [400, 120], [400, 140], [400, 160], [400, 180], [400, 195],
    ]
    for (const [w, h] of battants) {
      expect(controleCadrageRatio('janus', { w, h }), `janus ${w}x${h}`).toBeNull()
    }
    const coulissants: [number, number][] = [
      [300, 120], [300, 180], [350, 195], [400, 195], [450, 195], [500, 195], [600, 180], [600, 195],
    ]
    for (const [w, h] of coulissants) {
      expect(controleCadrageRatio('terminus', { w, h }), `terminus ${w}x${h}`).toBeNull()
    }
  })

  it('une taille hors gabarit est REFUSÉE avec un message clair (jamais tronquée en silence)', () => {
    // 300×195 : n'existe pas au catalogue — pilier 217 + chapeau dans une
    // fenêtre réduite à 75 % → déborde avec le portail à 74 % de l'image.
    const msg = controleCadrageRatio('janus', { w: 300, h: 195 })
    expect(msg).toMatch(/déborde/)
    expect(msg).toMatch(/300×195/)
    expect(msg).toMatch(/Portail dans l'image/)
  })

  it('ne s’applique JAMAIS aux recettes historiques (non-régression portillon/XL)', () => {
    // Portillon : recette zoomée, débordements assumés — jamais bloqué.
    expect(controleCadrageRatio('forculus', { w: 100, h: 180 })).toBeNull()
    // Ancienne règle réactivée : jamais bloqué non plus, même sur un extrême.
    const c = cadrageDaEffectif('janus', { ratioActif: false })
    expect(controleCadrageRatio('janus', { w: 300, h: 195 }, c)).toBeNull()
  })
})

describe('règle ratio — validation des réglages', () => {
  it('sanitizeCadrageDa accepte ratioActif/ratioPortailPct/ratioSolPct et borne les valeurs', () => {
    expect(sanitizeCadrageDa({ ratioActif: false })).toEqual({ ratioActif: false })
    expect(sanitizeCadrageDa({ ratioPortailPct: 70, ratioSolPct: 25 })).toEqual({
      ratioPortailPct: 70,
      ratioSolPct: 25,
    })
    // Hors bornes : ignoré, jamais d'erreur.
    expect(sanitizeCadrageDa({ ratioPortailPct: 20 })).toBeUndefined()
  })
})
