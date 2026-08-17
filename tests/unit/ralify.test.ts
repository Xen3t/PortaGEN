import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import {
  RALIFY_APPLICATION_DEFAUT,
  RALIFY_DEFAUTS,
  colorisKeyRalify,
  ralCibleLabel,
  resolveRalifyCible,
  resolveRalifyDecision,
  sanitizeRalify,
  type RalifyReglages,
} from '@/lib/ralify'
import { appliquerRalify, labToRgb, rgbToLab } from '@/lib/images/ralify'
import { sanitizeMoteurReglages } from '@/lib/moteurs'

const actives = (over: Partial<RalifyReglages> = {}): RalifyReglages => ({
  ...RALIFY_DEFAUTS,
  actif: true,
  ...over,
})

describe('RALify — clé de coloris', () => {
  it('tolère clés, libellés et fragments de noms de fichiers', () => {
    expect(colorisKeyRalify('gris')).toBe('gris')
    expect(colorisKeyRalify('Gris anthracite RAL 7016')).toBe('gris')
    expect(colorisKeyRalify('ANTHRACITE')).toBe('gris')
    expect(colorisKeyRalify('Noir 9005')).toBe('noir')
    expect(colorisKeyRalify('BLANC')).toBe('blanc')
    expect(colorisKeyRalify('Teck')).toBe('teck')
    expect(colorisKeyRalify('effet bois')).toBe('teck')
    expect(colorisKeyRalify('Beige')).toBe('beige')
    expect(colorisKeyRalify('')).toBeNull()
    expect(colorisKeyRalify(undefined)).toBeNull()
  })
})

describe('RALify — résolution de la cible', () => {
  it('désactivé → jamais de traitement (et les défauts sont ACTIVÉS, décision 28/07)', () => {
    expect(RALIFY_DEFAUTS.actif).toBe(true)
    expect(
      resolveRalifyCible({ ...RALIFY_DEFAUTS, actif: false }, 'VOGEL 300B140.png', 'gris')
    ).toBeNull()
  })

  it('règle générale par coloris (défauts : gris 7016, noir 9005, blanc 9016, teck intact)', () => {
    const r = actives()
    expect(resolveRalifyCible(r, 'VOGEL 300B140.png', 'gris')).toBe('#434a50')
    expect(resolveRalifyCible(r, 'VOGEL 300B140.png', 'noir')).toBe('#0e0e10')
    expect(resolveRalifyCible(r, 'VOGEL 300B140.png', 'blanc')).toBe('#f1f0ea')
    expect(resolveRalifyCible(r, 'ATHOS 300B140.png', 'teck')).toBeNull()
    expect(resolveRalifyCible(r, 'VOGEL 300B140.png', 'beige')).toBeNull()
    expect(resolveRalifyCible(r, 'VOGEL 300B140.png', undefined)).toBeNull()
  })

  it("l'exception prime : autre RAL pour un produit, ou désactivation", () => {
    const r = actives({
      exceptions: [
        { contient: 'vogel', coloris: 'gris', traiter: true, cible: '#2e3238', application: { ...RALIFY_APPLICATION_DEFAUT } },
        { contient: 'ATHOS', coloris: null, traiter: false, cible: null, application: { ...RALIFY_APPLICATION_DEFAUT } },
      ],
    })
    // VOGEL gris → RAL 7021 (exception), VOGEL noir → règle générale.
    expect(resolveRalifyCible(r, 'VOGEL 300B140.png', 'gris')).toBe('#2e3238')
    expect(resolveRalifyCible(r, 'VOGEL 300B140.png', 'noir')).toBe('#0e0e10')
    // ATHOS : jamais traité, quel que soit le coloris.
    expect(resolveRalifyCible(r, 'ATHOS 300B140.png', 'gris')).toBeNull()
    // Nom passé « nom produit + fichier » (pipeline) : le fragment matche aussi.
    expect(resolveRalifyCible(r, 'VOGEL gris_300x140.png', 'gris')).toBe('#2e3238')
  })
})

describe('RALify — validation de la config', () => {
  it('rejette ce qui n’est pas un objet, borne et nettoie le reste', () => {
    expect(sanitizeRalify('non')).toBeUndefined()
    expect(sanitizeRalify(null)).toBeUndefined()
    const r = sanitizeRalify({
      actif: true,
      intensite: 250,
      regles: {
        GRIS: { traiter: true, cible: '#434A50' },
        mauvais: { traiter: true, cible: 'pas-un-hex' },
      },
      exceptions: [
        { contient: '  VOGEL ', coloris: 'Gris', traiter: true, cible: '#2E3238' },
        { contient: '', traiter: true, cible: '#2e3238' },
        'pas-un-objet',
      ],
    })!
    expect(r.actif).toBe(true)
    expect(r.intensite).toBe(100)
    expect(r.regles.gris).toEqual({
      traiter: true,
      cible: '#434a50',
      application: { avant: true, apres: false },
    })
    // Cible invalide → la règle ne peut pas traiter.
    expect(r.regles.mauvais).toEqual({
      traiter: false,
      cible: null,
      application: { avant: true, apres: false },
    })
    expect(r.exceptions).toEqual([
      {
        contient: 'VOGEL',
        coloris: 'gris',
        traiter: true,
        cible: '#2e3238',
        application: { avant: true, apres: false },
      },
    ])
  })

  it("application avant/après PAR RÈGLE (17/08) : absent = avant seul, l'après doit être explicite", () => {
    const regle = (application?: unknown) =>
      sanitizeRalify({
        actif: true,
        regles: { gris: { traiter: true, cible: '#434a50', application } },
      })!.regles.gris.application
    // Config d'avant le 17/08 (sans le champ) → comportement historique.
    expect(regle()).toEqual({ avant: true, apres: false })
    expect(regle({ apres: true })).toEqual({ avant: true, apres: true })
    expect(regle({ avant: false, apres: true })).toEqual({ avant: false, apres: true })
    // Valeurs non booléennes → défauts sûrs.
    expect(regle({ avant: 'oui', apres: 'oui' })).toEqual({ avant: true, apres: false })
    // La décision porte l'application de la règle qui a tranché.
    const cfg = sanitizeRalify({
      actif: true,
      regles: { gris: { traiter: true, cible: '#434a50', application: { avant: false, apres: true } } },
      exceptions: [
        { contient: 'VALIER', traiter: true, cible: '#2e3238', application: { avant: true, apres: true } },
      ],
    })!
    expect(resolveRalifyDecision(cfg, 'EIGER', 'gris').application).toEqual({
      avant: false,
      apres: true,
    })
    expect(resolveRalifyDecision(cfg, 'VALIER 300B140', 'gris').application).toEqual({
      avant: true,
      apres: true,
    })
  })

  it('fait partie des réglages moteur (sanitize + défauts)', () => {
    const out = sanitizeMoteurReglages({ ralify: { actif: true, intensite: 60 } })
    expect(out.ralify?.actif).toBe(true)
    expect(out.ralify?.intensite).toBe(60)
    expect(sanitizeMoteurReglages({ ralify: 'invalide' }).ralify).toBeUndefined()
  })

  it('affiche les cibles par leur RAL', () => {
    expect(ralCibleLabel('#434a50')).toBe('RAL 7016 · gris anthracite')
    expect(ralCibleLabel('#123456')).toBe('#123456')
    expect(ralCibleLabel(null)).toBe('Ne pas toucher')
  })
})

describe('RALify — traitement LAB', () => {
  it('les conversions sRGB ↔ LAB font l’aller-retour', () => {
    for (const [r, g, b] of [
      [67, 74, 80],
      [14, 14, 16],
      [241, 240, 234],
      [0, 0, 0],
      [255, 255, 255],
    ]) {
      const [L, a, bb] = rgbToLab(r, g, b)
      const [r2, g2, b2] = labToRgb(L, a, bb)
      expect(Math.abs(r2 - r)).toBeLessThanOrEqual(1)
      expect(Math.abs(g2 - g)).toBeLessThanOrEqual(1)
      expect(Math.abs(b2 - b)).toBeLessThanOrEqual(1)
    }
  })

  it('ramène la teinte au RAL cible en gardant le relief et l’alpha', async () => {
    // Produit synthétique : deux bandes d'un gris BLEUTÉ (clair/foncé = relief),
    // fond transparent — le cas réel « PNG fournisseur mal calibré ».
    const clair = { r: 110, g: 122, b: 140, alpha: 1 }
    const png = await sharp({
      create: { width: 40, height: 40, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([
        {
          input: await sharp({ create: { width: 40, height: 10, channels: 4, background: clair } })
            .png()
            .toBuffer(),
          top: 8,
          left: 0,
        },
        {
          input: await sharp({
            create: { width: 40, height: 10, channels: 4, background: { r: 70, g: 80, b: 96, alpha: 1 } },
          })
            .png()
            .toBuffer(),
          top: 22,
          left: 0,
        },
      ])
      .png()
      .toBuffer()

    const res = await appliquerRalify(png, '#434a50', 100)
    expect(res.pixelsTraites).toBe(40 * 20)

    const { data, info } = await sharp(res.image).raw().toBuffer({ resolveWithObject: true })
    const px = (x: number, y: number) => {
      const o = (y * info.width + x) * 4
      return { r: data[o], g: data[o + 1], b: data[o + 2], a: data[o + 3] }
    }
    // Fond toujours transparent, matière toujours opaque.
    expect(px(0, 0).a).toBe(0)
    expect(px(20, 12).a).toBe(255)
    const haut = px(20, 12)
    const bas = px(20, 26)
    // La dominante bleutée est corrigée : teinte quasi neutre, proche du 7016
    // (b−r ≈ +13 pour RGB 67,74,80).
    for (const p of [haut, bas]) {
      expect(p.b - p.r).toBeGreaterThan(5)
      expect(p.b - p.r).toBeLessThan(20)
    }
    // Le relief clair/foncé est conservé.
    expect(haut.r + haut.g + haut.b).toBeGreaterThan(bas.r + bas.g + bas.b + 30)
    // La moyenne de la matière a rejoint la clarté de la cible (L*≈31 pour le
    // 7016) : la moyenne rapportée est plus sombre que l'original.
    expect(res.apresHex).not.toBe(res.avantHex)
  })

  it('protège la quincaillerie : poignée gris NEUTRE sur matière bleutée (cas ARLBERG)', async () => {
    // Matière anthracite BLEUTÉE (64,72,80) + « poignée » gris NEUTRE (78,78,78) :
    // même clarté, seule la teinte diffère — le cas réel qui avait échappé à la
    // première version (retour Mathias 28/07).
    const png = await sharp({
      create: { width: 80, height: 60, channels: 4, background: { r: 64, g: 72, b: 80, alpha: 1 } },
    })
      .composite([
        {
          input: await sharp({
            create: { width: 20, height: 20, channels: 4, background: { r: 78, g: 78, b: 78, alpha: 1 } },
          })
            .png()
            .toBuffer(),
          top: 20,
          left: 30,
        },
      ])
      .png()
      .toBuffer()

    const res = await appliquerRalify(png, '#c5c7c4', 100) // cible claire : écart max
    // Le lissage anti-moucheté fond les 2-3 px de bord : le cœur reste protégé.
    expect(res.pixelsProteges).toBeGreaterThanOrEqual(200)

    const { data, info } = await sharp(res.image).raw().toBuffer({ resolveWithObject: true })
    const px = (x: number, y: number) => {
      const o = (y * info.width + x) * 4
      return [data[o], data[o + 1], data[o + 2]]
    }
    // Le cœur de la poignée n'a pas bougé, la matière est devenue claire.
    expect(px(40, 30)).toEqual([78, 78, 78])
    expect(px(5, 5)[0]).toBeGreaterThan(150)
  })

  it('intensité 0 → image inchangée', async () => {
    const png = await sharp({
      create: { width: 8, height: 8, channels: 4, background: { r: 110, g: 122, b: 140, alpha: 1 } },
    })
      .png()
      .toBuffer()
    const res = await appliquerRalify(png, '#434a50', 0)
    const avant = await sharp(png).raw().toBuffer()
    const apres = await sharp(res.image).raw().toBuffer()
    // Tolérance 1 (aller-retour LAB), sur tous les canaux.
    for (let i = 0; i < avant.length; i++) {
      expect(Math.abs(apres[i] - avant[i])).toBeLessThanOrEqual(1)
    }
  })
})
