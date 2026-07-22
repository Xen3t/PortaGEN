import fs from 'node:fs'
import Database from 'better-sqlite3'
import { describe, it, expect } from 'vitest'
import { getDb, migrate } from '@/lib/db'
import { DECOR_TYPES, registerDecor } from '@/lib/db/decors'
import { sanitizeColorisSettings } from '@/lib/catalogue/defaults'
import { GABARIT_SET_DEFAULTS } from '@/lib/gabaritSets'
import { DEFAULT_CANNY_PATH, DEFAULT_CANNY_XL_PATH } from '@/lib/server/cannyRef'
import { buildCanny } from '@/lib/images/canny'

describe('décors coulissant XL (chantier 22/07/2026)', () => {
  it('le type « coulissant-xl » est accepté en base (contrainte CHECK élargie)', () => {
    const db = getDb(':memory:')
    const id = registerDecor(
      {
        filePath: 'data/artifacts/decor/test-xl/decor.png',
        name: 'Décor XL de test',
        slug: 'test-xl',
        type: 'coulissant-xl',
      },
      db
    )
    const row = db.prepare('SELECT type FROM decors WHERE id = ?').get(id) as { type: string }
    expect(row.type).toBe('coulissant-xl')
    expect(DECOR_TYPES).toContain('coulissant-xl')
  })

  it('migration : reprend après un échec partiel (decors_new orpheline) sans rien perdre', () => {
    // Scénario vécu le 22/07/2026 : un premier passage a planté entre la copie et
    // le renommage — la base garde l'ANCIEN schéma decors + une decors_new
    // orpheline, et tous les démarrages suivants replantaient (« already exists »).
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE decors (
        id INTEGER PRIMARY KEY,
        file_path TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        slug TEXT NOT NULL,
        gamme TEXT,
        type TEXT NOT NULL DEFAULT 'battant' CHECK (type IN ('battant', 'coulissant', 'portillon')),
        angle TEXT NOT NULL DEFAULT 'face' CHECK (angle IN ('face', 'angle')),
        status TEXT NOT NULL DEFAULT 'a_valider' CHECK (status IN ('a_valider', 'actif', 'archive')),
        image_size TEXT,
        width INTEGER,
        height INTEGER,
        moodboard_path TEXT,
        job_id INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE decor_tags (
        decor_id INTEGER NOT NULL REFERENCES decors(id),
        tag TEXT NOT NULL,
        UNIQUE (decor_id, tag)
      );
      INSERT INTO decors (file_path, name, slug, type, status) VALUES ('data/a.png', 'A', 'a', 'coulissant', 'actif');
      INSERT INTO decor_tags (decor_id, tag) VALUES (1, 'verdure');
      CREATE TABLE decors_new (id INTEGER PRIMARY KEY);
    `)
    migrate(db, { ephemeral: true })
    // L'orpheline est nettoyée, le schéma est élargi, rien n'est perdu.
    expect(
      db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='decors_new'`).get()
    ).toBeUndefined()
    const schema = db
      .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='decors'`)
      .get() as { sql: string }
    expect(schema.sql).toContain('coulissant-xl')
    const kept = db.prepare('SELECT name, type, status FROM decors WHERE id = 1').get() as {
      name: string
      type: string
      status: string
    }
    expect(kept).toMatchObject({ name: 'A', type: 'coulissant', status: 'actif' })
    // Les tables filles pointent toujours le bon décor.
    expect(
      db.prepare('SELECT tag FROM decor_tags WHERE decor_id = 1').get()
    ).toMatchObject({ tag: 'verdure' })
    // Et le nouveau type passe désormais la contrainte.
    db.prepare(`INSERT INTO decors (file_path, name, slug, type) VALUES ('data/b.png', 'B', 'b', 'coulissant-xl')`).run()
    // Une seconde migration ne retouche plus rien (idempotente).
    migrate(db, { ephemeral: true })
    expect((db.prepare('SELECT COUNT(*) n FROM decors').get() as { n: number }).n).toBe(2)
  })

  it('réglages coloris : decorXlId accepté, null par défaut, valeurs invalides rejetées', () => {
    expect(sanitizeColorisSettings(null).decorXlId).toBeNull()
    expect(sanitizeColorisSettings({ decorXlId: 12 }).decorXlId).toBe(12)
    expect(sanitizeColorisSettings({ decorXlId: -3 }).decorXlId).toBeNull()
    expect(sanitizeColorisSettings({ decorXlId: 'x' }).decorXlId).toBeNull()
    // Les réglages historiques (sans decorXlId) restent valides tels quels.
    expect(sanitizeColorisSettings({ decorId: 4 })).toMatchObject({ decorId: 4, decorXlId: null })
  })

  it('l’analyse moodboard XL est une VRAIE adaptation — gardes verbatim intactes', async () => {
    const { getActivePrompt } = await import('@/lib/db/prompts')
    const db = getDb(':memory:')
    const std = getActivePrompt('moodboard-llm', db).content
    const xl = getActivePrompt('coulissant-xl-moodboard-llm', db).content
    // Adaptation réelle, pas une copie (règle « moteur = contenu adapté »).
    expect(xl).not.toBe(std)
    // Les 4 gardes verbatim que le pipeline décor exige dans la SORTIE du LLM
    // doivent rester copiables telles quelles depuis le prompt système XL.
    for (const marker of ['Output format:', 'rontal symmetrical view', 'no pillars', 'no gate']) {
      expect(xl).toContain(marker)
    }
    // Le cœur de l'adaptation : caméra reculée de l'autre côté de la rue, 6 m.
    expect(xl).toContain('across the street')
    expect(xl.toUpperCase()).toContain('SIX METRES')
    // RÈGLE ABSOLUE coulissant : jamais « sliding » dans un prompt image.
    expect(xl.toUpperCase()).not.toContain('SLIDING')
    // Les jetons de format restent substituables par le format natif.
    expect(xl).toContain('2000×1330')
  })

  it('le jeu XL a son image CANNY d’origine dédiée, présente dans le dépôt', () => {
    expect(DEFAULT_CANNY_XL_PATH).not.toBe(DEFAULT_CANNY_PATH)
    expect(fs.existsSync(DEFAULT_CANNY_XL_PATH)).toBe(true)
    expect(fs.existsSync(DEFAULT_CANNY_PATH)).toBe(true)
  })

  it('corridor de 600 cm : contenu dans la scène XL, hors cadre dans la scène standard', async () => {
    const xl = await buildCanny({
      width: 1000,
      height: 665,
      corridorWidthCm: 600,
      params: GABARIT_SET_DEFAULTS['coulissant-xl'],
    })
    expect(xl.corridor).not.toBeNull()
    expect(xl.corridor!.x1Px).toBeGreaterThanOrEqual(0)
    expect(xl.corridor!.x2Px).toBeLessThanOrEqual(1000)
    // Le bug latent d'avant le chantier : 600 cm dans la scène standard (~481 cm
    // de large) déborde du cadre — raison d'être de la scène XL.
    const std = await buildCanny({ width: 1000, height: 665, corridorWidthCm: 600 })
    expect(std.corridor!.x1Px).toBeLessThan(0)
  })
})
