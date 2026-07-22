import { describe, it, expect } from 'vitest'
import { getDb, createJob, updateJob, logApiCall } from '@/lib/db'
import { listLabEssais, archiveLabEssais } from '@/lib/db/labEssais'

/**
 * Essais du LAB en base (refonte lab-v1, 22/07/2026) : regroupement par batch,
 * libellés, jeu XL, archivage de groupe — sans toucher aux jobs de production.
 */

function seed(db: ReturnType<typeof getDb>) {
  // Essai décor XL (job isolé, terminé)
  const decorId = createJob(
    'decor',
    { moodboardPath: 'Assets/Moodboards PDF/Background 1.jpg', lab: true, moteur: 'coulissant-xl' },
    db
  )
  updateJob(
    decorId,
    {
      status: 'done',
      result: JSON.stringify({
        kind: 'decor',
        imagePath: 'data/artifacts/lab/decor/bg1/decor-4K.jpg',
        imageSize: '4K',
        sidewalkOffsetPxDelivery: 16,
        corridorGreenFraction: 0.069,
      }),
    },
    db
  )
  logApiCall(
    { jobId: decorId, provider: 'gemini', model: 'nb', kind: 'image.generate', inputTokens: 1000, outputTokens: 2000, ok: true },
    db
  )

  // Essai piliers multi-tailles (2 jobs, même batch) — coulissant XL par la largeur
  const p1 = createJob(
    'pillars',
    { decorPath: 'data/artifacts/lab/decor/bg1/decor-4K.jpg', size: { w: 450, h: 140 }, lab: true, moteur: 'coulissant' },
    db,
    'batch-lab-1'
  )
  const p2 = createJob(
    'pillars',
    { decorPath: 'data/artifacts/lab/decor/bg1/decor-4K.jpg', size: { w: 450, h: 160 }, lab: true, moteur: 'coulissant' },
    db,
    'batch-lab-1'
  )
  updateJob(
    p1,
    {
      status: 'done',
      result: JSON.stringify({
        kind: 'pillars',
        compositePath: 'data/artifacts/pillars/x/450x140/4-finale.png',
        groundOffsetPxNative: 59,
        groundAlign: 'measured',
      }),
    },
    db
  )
  // p2 encore en cours

  // Job de PRODUCTION (pas lab) : ne doit jamais apparaître ni être archivé.
  const prod = createJob('pillars', { decorPath: 'x.jpg', size: { w: 300, h: 140 } }, db, 'batch-prod')

  return { decorId, p1, p2, prod }
}

describe('listLabEssais', () => {
  it('regroupe par batch, ignore la production, remonte libellés/XL/statuts/tokens', () => {
    const db = getDb(':memory:')
    const { decorId, p1, p2, prod } = seed(db)

    const { essais, archivedCount } = listLabEssais({}, db)
    expect(archivedCount).toBe(0)
    expect(essais.map((e) => e.id)).not.toContain(prod)
    expect(essais).toHaveLength(2)

    const piliers = essais.find((e) => e.step === 'pillars')!
    expect(piliers.ids).toEqual([p1, p2])
    expect(piliers.moteur).toBe('coulissant')
    expect(piliers.xl).toBe(true) // largeur 450 → jeu Gabarits XL
    expect(piliers.status).toBe('running') // p2 en file d'attente
    expect(piliers.titre).toBe('Piliers · 2 tailles')
    expect(piliers.detail).toContain('sol +59 px (mesuré)')
    expect(piliers.thumbPath).toBe('data/artifacts/pillars/x/450x140/4-finale.png')

    const decor = essais.find((e) => e.step === 'decor')!
    expect(decor.id).toBe(decorId)
    expect(decor.moteur).toBe('coulissant') // le jeu coulissant-xl reste TERMINUS
    expect(decor.xl).toBe(true)
    expect(decor.status).toBe('done')
    expect(decor.inputTokens).toBe(1000)
    expect(decor.outputTokens).toBe(2000)
    expect(decor.detail).toContain('trottoir +16 px')
  })
})

describe('archiveLabEssais', () => {
  it('archive un groupe entier depuis un seul id, sans toucher la production', () => {
    const db = getDb(':memory:')
    const { p1, p2, prod } = seed(db)

    expect(archiveLabEssais([p1], db)).toBe(2) // p1 + p2 (même batch)
    const apres = listLabEssais({}, db)
    expect(apres.essais.map((e) => e.step)).toEqual(['decor'])
    expect(apres.archivedCount).toBe(1)
    const archives = listLabEssais({ archived: true }, db)
    expect(archives.essais[0].ids).toEqual([p1, p2])

    // Le job de production n'a pas bougé.
    const row = db.prepare('SELECT lab_archived_at FROM jobs WHERE id = ?').get(prod) as {
      lab_archived_at: string | null
    }
    expect(row.lab_archived_at).toBeNull()
  })

  it("'all' archive tous les essais actifs et rien d'autre", () => {
    const db = getDb(':memory:')
    const { prod } = seed(db)
    expect(archiveLabEssais('all', db)).toBe(3) // décor + 2 piliers
    expect(listLabEssais({}, db).essais).toHaveLength(0)
    expect(listLabEssais({ archived: true }, db).essais).toHaveLength(2)
    const row = db.prepare('SELECT lab_archived_at FROM jobs WHERE id = ?').get(prod) as {
      lab_archived_at: string | null
    }
    expect(row.lab_archived_at).toBeNull()
  })

  it('liste vide → 0, ids inconnus → 0', () => {
    const db = getDb(':memory:')
    seed(db)
    expect(archiveLabEssais([], db)).toBe(0)
    expect(archiveLabEssais([99999], db)).toBe(0)
  })
})
