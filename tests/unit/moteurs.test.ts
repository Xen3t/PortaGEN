import { describe, it, expect } from 'vitest'
import { getDb } from '@/lib/db'
import { setSetting } from '@/lib/db/settings'
import {
  MOTEURS,
  MOTEUR_REGLAGES_DEFAUTS,
  getMoteurReglages,
  moteurDef,
  moteurForFamily,
  moteurPromptName,
  patchMoteurReglages,
  sanitizeMoteurReglages,
} from '@/lib/moteurs'
import {
  MOTEURS_DA,
  getMoteurDaReglages,
  isMoteurDaKey,
  moteurDaDef,
  moteurDaForLettre,
  moteurDaPromptName,
} from '@/lib/moteursDa'

describe('registre des moteurs', () => {
  it('déclare les trois moteurs legacy actifs, étiquetés (legacy) depuis la bascule du 05/08', () => {
    expect(MOTEURS.map((m) => m.key)).toEqual(['battant', 'coulissant', 'portillon'])
    expect(moteurDef('battant')?.status).toBe('actif')
    expect(moteurDef('battant')?.codeName).toBe('JANUS (legacy)')
    expect(moteurDef('coulissant')?.status).toBe('actif')
    expect(moteurDef('coulissant')?.codeName).toBe('TERMINUS (legacy)')
    expect(moteurDef('portillon')?.status).toBe('actif')
    expect(moteurDef('portillon')?.codeName).toBe('FORCULUS (legacy)')
    expect(moteurDef('inconnu')).toBeUndefined()
  })

  it('déclare les trois moteurs décor autour (séparation totale 05/08) — noms nus, clés propres', () => {
    expect(MOTEURS_DA.map((m) => m.key)).toEqual(['janus', 'terminus', 'forculus'])
    expect(moteurDaDef('janus')?.codeName).toBe('JANUS')
    expect(moteurDaDef('terminus')?.codeName).toBe('TERMINUS')
    expect(moteurDaDef('forculus')?.codeName).toBe('FORCULUS')
    // Jamais de collision avec les clés legacy.
    expect(isMoteurDaKey('battant')).toBe(false)
    expect(moteurDaDef('battant')).toBeUndefined()
    // Détection par lettre de nomenclature (300B140 → janus…).
    expect(moteurDaForLettre('B')).toBe('janus')
    expect(moteurDaForLettre('C')).toBe('terminus')
    expect(moteurDaForLettre('P')).toBe('forculus')
    // Prompts TOUJOURS préfixés par la clé (pas d'exception « battant »).
    expect(moteurDaPromptName('janus', 'decor-autour')).toBe('janus-decor-autour')
    // Réglages : défaut integrationMethod = decor-autour (la méthode du moteur).
    expect(getMoteurDaReglages('janus').integrationMethod).toBe('decor-autour')
  })

  it('aiguille automatiquement famille catalogue → moteur', () => {
    expect(moteurForFamily('PORTAIL BATTANT')).toBe('battant')
    expect(moteurForFamily('PORTAIL COULISSANT')).toBe('coulissant')
    expect(moteurForFamily('PORTILLON')).toBe('portillon')
    expect(moteurForFamily('portillon')).toBe('portillon')
    expect(moteurForFamily('CLOTURE')).toBeNull()
  })

  it('nomme les prompts par moteur — battant garde les noms historiques', () => {
    expect(moteurPromptName('battant', 'piliers-murets')).toBe('piliers-murets')
    expect(moteurPromptName('battant', 'integration-simple')).toBe('integration-simple')
    expect(moteurPromptName('portillon', 'piliers-murets')).toBe('portillon-piliers-murets')
    expect(moteurPromptName('portillon', 'integration-simple')).toBe(
      'portillon-integration-simple'
    )
    expect(moteurPromptName('coulissant', 'integration-simple')).toBe(
      'coulissant-integration-simple'
    )
  })
})

describe('référentiels de tailles par moteur (jamais partagés)', () => {
  it('seed 18 tailles battant et 6 tailles portillon (largeur unique 100 cm)', async () => {
    const { listSizes } = await import('@/lib/db')
    const db = getDb(':memory:')
    const battant = listSizes(db, 'battant')
    expect(battant).toHaveLength(18)
    expect(battant.every((s) => [300, 350, 400].includes(s.width_cm))).toBe(true)
    const portillon = listSizes(db, 'portillon')
    expect(portillon.map((s) => s.label)).toEqual([
      '100x100',
      '100x120',
      '100x140',
      '100x160',
      '100x180',
      '100x200',
    ])
    expect(portillon.every((s) => s.width_cm === 100)).toBe(true)
  })

  it('seed 9 tailles coulissant — relevé serveur 13/07/2026, labels partagés avec le battant', async () => {
    const { listSizes } = await import('@/lib/db')
    const db = getDb(':memory:')
    const coulissant = listSizes(db, 'coulissant')
    // 3 largeurs × 3 hauteurs (jamais de 100/120/200 en coulissant sur le serveur).
    expect(coulissant.map((s) => s.label)).toEqual([
      '300x140',
      '300x160',
      '300x180',
      '350x140',
      '350x160',
      '350x180',
      '400x140',
      '400x160',
      '400x180',
    ])
    // « 300x140 » existe AUSSI côté battant : l'unicité du label est par moteur.
    const battant = listSizes(db, 'battant')
    expect(battant.some((s) => s.label === '300x140')).toBe(true)
  })
})

describe('prompts du moteur Portillon (adaptés, jamais partagés)', () => {
  it('seed des prompts portillon ADAPTÉS : vantail unique, entrée piétonne — pas des copies', async () => {
    const { getActivePrompt } = await import('@/lib/db/prompts')
    const db = getDb(':memory:')
    for (const base of ['piliers-murets', 'integration', 'integration-simple']) {
      const battant = getActivePrompt(base, db)
      const portillon = getActivePrompt(`portillon-${base}`, db)
      // Adaptation réelle exigée (retour Mathias 13/07/2026) : un prompt portillon
      // n'est PAS le prompt battant renommé.
      expect(portillon.content).not.toBe(battant.content)
      expect(portillon.content).toContain('PEDESTRIAN')
    }
    // Les intégrations parlent d'un VANTAIL UNIQUE (jamais deux battants).
    for (const name of ['portillon-integration', 'portillon-integration-simple']) {
      expect(getActivePrompt(name, db).content.toUpperCase()).toContain('SINGLE-LEAF')
    }
  })
})

describe('prompts du moteur Coulissant « TERMINUS » (recherche 13/07/2026)', () => {
  it('intégration = prompt v8 « directeur photo » : lame derrière le pilier, jamais « sliding »', async () => {
    const { getActivePrompt } = await import('@/lib/db/prompts')
    const db = getDb(':memory:')
    const p = getActivePrompt('coulissant-integration-simple', db).content
    const up = p.toUpperCase()
    // Adaptation réelle, pas une copie du battant.
    expect(p).not.toBe(getActivePrompt('integration-simple', db).content)
    // Le cœur de la méthode : le pilier droit est un occulteur d'AVANT-PLAN,
    // la lame d'un seul tenant passe DERRIÈRE lui.
    expect(up).toContain('BEHIND')
    expect(up).toContain('FOREGROUND')
    expect(up).toContain('ONE-PIECE')
    // RÈGLE ABSOLUE de la recherche : décrire une scène FERMÉE — écrire
    // « sliding » ferait OUVRIR le portail par Nano.
    expect(up).not.toContain('SLIDING')
    expect(up).toContain('FULLY CLOSED')
  })

  it('les piliers coulissant exigent des arêtes nettes (la lame doit s’y cacher proprement)', async () => {
    const { getActivePrompt } = await import('@/lib/db/prompts')
    const db = getDb(':memory:')
    const p = getActivePrompt('coulissant-piliers-murets', db)
    expect(p.content).not.toBe(getActivePrompt('piliers-murets', db).content)
    expect(p.content.toUpperCase()).toContain('CLEAN, SHARP PILLAR EDGES')
  })
})

describe('réglages moteur — invariance des défauts', () => {
  it('sans réglage en base, les défauts = comportements historiques du pipeline', () => {
    const db = getDb(':memory:')
    const r = getMoteurReglages('battant', db)
    // Ces valeurs DOIVENT rester les défauts historiques du code : tant que rien
    // n'est enregistré dans l'admin, les générations sont identiques à avant.
    expect(r).toEqual({
      detectionType: 'auto',
      cannyPlacement: 'auto', // align 'auto' (pillars)
      cannyOffsetPx: 0,
      corridor: 'auto', // widestActiveSize (decor)
      corridorWidthCm: 400,
      masking: 'off', // rendu brut (décision 11/07/2026)
      integrationMethod: 'pose-fusion', // défaut tous moteurs (demande Mathias 29/07/2026)
      poseDebordPct: 2, // débord piliers validé par Mathias le 17/07/2026
      poseSeuilAlpha: 200, // nettoyage des pixels fantômes (méthode 1 validée)
      poseFusionComposite: 'on', // masquage/composite actif = comportement actuel (05/08/2026)
      shadows: 'auto',
      ombrePilierPct: 25, // ombre pilier→lame coulissant : dégradé 0→25 % sur 1,5× la largeur du pilier (profil Mathias 28/07)
      marketplace: 'choix', // case au lancement + bouton 1:1 (décision 13/07/2026)
      generationsParTaille: 3, // 3 générations par taille (demande Mathias 29/07/2026)
      livraisonName: '{MARQUE}-{TAILLE}_{COLORIS}_{FORMAT}',
      // RALify (28/07/2026) : ACTIVÉ par défaut — validation Mathias du 28/07
      // (démos ARLBERG/EIGER), survit à une remise à zéro.
      ralify: {
        actif: true,
        intensite: 100,
        regles: {
          gris: { traiter: true, cible: '#434a50' }, // RAL 7016
          noir: { traiter: true, cible: '#0e0e10' }, // RAL 9005
          blanc: { traiter: true, cible: '#f1f0ea' }, // RAL 9016 (décision 28/07)
          teck: { traiter: false, cible: null }, // bois : pas de RAL
        },
        exceptions: [],
      },
    })
    expect(r).toEqual(MOTEUR_REGLAGES_DEFAUTS)
  })

  it('JSON corrompu en base → retombe sur les défauts', () => {
    const db = getDb(':memory:')
    setSetting('moteur.battant.reglages', '{pas du json', db)
    expect(getMoteurReglages('battant', db)).toEqual(MOTEUR_REGLAGES_DEFAUTS)
  })

  it('réglage du lot 1 (sans les champs numériques) → complété par les défauts', () => {
    const db = getDb(':memory:')
    setSetting(
      'moteur.battant.reglages',
      JSON.stringify({ masking: 'pixel-lock', integrationMethod: 'rectangle' }),
      db
    )
    const r = getMoteurReglages('battant', db)
    expect(r.masking).toBe('pixel-lock')
    expect(r.integrationMethod).toBe('rectangle')
    expect(r.cannyOffsetPx).toBe(0)
    expect(r.corridorWidthCm).toBe(400)
  })
})

describe('sanitizeMoteurReglages', () => {
  it('ne garde que les valeurs autorisées des listes', () => {
    expect(
      sanitizeMoteurReglages({
        masking: 'pixel-lock',
        integrationMethod: 'nimporte',
        cannyPlacement: 'off',
        shadows: 42,
        inconnu: 'x',
      })
    ).toEqual({ masking: 'pixel-lock', cannyPlacement: 'off' })
    expect(sanitizeMoteurReglages(null)).toEqual({})
    expect(sanitizeMoteurReglages('texte')).toEqual({})
  })

  it('accepte la méthode « pose-fusion » et ses réglages (chantier 17/07/2026)', () => {
    expect(sanitizeMoteurReglages({ integrationMethod: 'pose-fusion' })).toEqual({
      integrationMethod: 'pose-fusion',
    })
    // Le débord garde sa décimale (3,5 % mesuré → 2 % retenu) ; hors bornes = ignoré.
    expect(sanitizeMoteurReglages({ poseDebordPct: 3.5 })).toEqual({ poseDebordPct: 3.5 })
    expect(sanitizeMoteurReglages({ poseDebordPct: 2.04 })).toEqual({ poseDebordPct: 2 })
    expect(sanitizeMoteurReglages({ poseDebordPct: -1 })).toEqual({})
    expect(sanitizeMoteurReglages({ poseDebordPct: 11 })).toEqual({})
    expect(sanitizeMoteurReglages({ poseSeuilAlpha: 200 })).toEqual({ poseSeuilAlpha: 200 })
    expect(sanitizeMoteurReglages({ poseSeuilAlpha: 0 })).toEqual({})
    expect(sanitizeMoteurReglages({ poseSeuilAlpha: 256 })).toEqual({})
    // Ombre pilier→lame (coulissant, 28/07/2026) : 0-100 %, 0 = désactivée.
    expect(sanitizeMoteurReglages({ ombrePilierPct: 40 })).toEqual({ ombrePilierPct: 40 })
    expect(sanitizeMoteurReglages({ ombrePilierPct: 0 })).toEqual({ ombrePilierPct: 0 })
    expect(sanitizeMoteurReglages({ ombrePilierPct: 101 })).toEqual({})
    expect(sanitizeMoteurReglages({ ombrePilierPct: -5 })).toEqual({})
    // Masquage / composite (05/08/2026) : 'on' (défaut) / 'off', rien d'autre.
    expect(sanitizeMoteurReglages({ poseFusionComposite: 'off' })).toEqual({ poseFusionComposite: 'off' })
    expect(sanitizeMoteurReglages({ poseFusionComposite: 'on' })).toEqual({ poseFusionComposite: 'on' })
    expect(sanitizeMoteurReglages({ poseFusionComposite: 'nimporte' })).toEqual({})
  })

  it('borne et arrondit les champs numériques', () => {
    expect(sanitizeMoteurReglages({ cannyOffsetPx: 12.6 })).toEqual({ cannyOffsetPx: 13 })
    expect(sanitizeMoteurReglages({ cannyOffsetPx: -300 })).toEqual({ cannyOffsetPx: -300 })
    expect(sanitizeMoteurReglages({ cannyOffsetPx: 301 })).toEqual({})
    expect(sanitizeMoteurReglages({ cannyOffsetPx: Number.NaN })).toEqual({})
    expect(sanitizeMoteurReglages({ cannyOffsetPx: '10' })).toEqual({})
    expect(sanitizeMoteurReglages({ corridorWidthCm: 400 })).toEqual({ corridorWidthCm: 400 })
    expect(sanitizeMoteurReglages({ corridorWidthCm: 99 })).toEqual({})
    expect(sanitizeMoteurReglages({ corridorWidthCm: 801 })).toEqual({})
    expect(sanitizeMoteurReglages({ corridorWidthCm: Infinity })).toEqual({})
  })

  it('refuse un nom de livrable dangereux pour un nom de fichier', () => {
    expect(sanitizeMoteurReglages({ livraisonName: 'MES-{TAILLE}' })).toEqual({
      livraisonName: 'MES-{TAILLE}',
    })
    for (const bad of ['a/b', 'a\\b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b', '..\\x', 'a..b', '', '   ']) {
      expect(sanitizeMoteurReglages({ livraisonName: bad })).toEqual({})
    }
    expect(sanitizeMoteurReglages({ livraisonName: 'x'.repeat(201) })).toEqual({})
  })
})

describe('patchMoteurReglages', () => {
  it('fusionne partiellement et persiste', () => {
    const db = getDb(':memory:')
    const first = patchMoteurReglages('battant', { masking: 'pixel-lock' }, db)
    expect(first.masking).toBe('pixel-lock')
    expect(first.integrationMethod).toBe('pose-fusion') // défaut conservé (29/07/2026)
    const second = patchMoteurReglages('battant', { cannyPlacement: 'manuel', cannyOffsetPx: -12 }, db)
    expect(second.masking).toBe('pixel-lock') // conservé
    expect(second.cannyPlacement).toBe('manuel')
    expect(second.cannyOffsetPx).toBe(-12)
    expect(getMoteurReglages('battant', db)).toEqual(second)
  })
})
