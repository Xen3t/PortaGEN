import { describe, it, expect } from 'vitest'
import { getDb, createJob, updateJob, listJobsByBatch } from '@/lib/db'
import {
  registerDecor,
  getDecor,
  getDecorByPath,
  updateDecor,
  setDecorTags,
  addDecorTags,
  sanitizeTags,
  listAllTags,
  listGammes,
  toggleFavorite,
  getDecorLastUse,
  decorUsedByValidatedJob,
  deleteDecorRow,
  activateDecorByJob,
  listDecorLibrary,
  normalizeDecorPath,
  prettifySlug,
} from '@/lib/db/decors'
import {
  addDecorVersion,
  ensureInitialVersion,
  listDecorVersions,
  restoreDecorVersion,
} from '@/lib/db/decors'
import { parseTagsResponse } from '@/lib/pipeline/autoTags'

const FILE = 'data/artifacts/decor/background-1-veymont/decor-2K-2026-07-09T10-00-00-000Z.jpg'

function freshDecor(db: ReturnType<typeof getDb>, filePath = FILE): number {
  return registerDecor(
    { filePath, name: 'Veymont · Battant · Face', slug: 'background-1-veymont' },
    db
  )
}

describe('bibliothèque de décors — enregistrement', () => {
  it('crée un décor avec les défauts du circuit (À valider, battant, face)', () => {
    const db = getDb(':memory:')
    const id = freshDecor(db)
    const row = getDecor(id, db)!
    expect(row).toMatchObject({
      file_path: FILE,
      status: 'a_valider',
      type: 'battant',
      angle: 'face',
      gamme: null,
    })
  })

  it('est idempotent : le même fichier n’est jamais dupliqué', () => {
    const db = getDb(':memory:')
    const a = freshDecor(db)
    const b = freshDecor(db)
    expect(b).toBe(a)
    expect(db.prepare('SELECT COUNT(*) AS n FROM decors').get()).toMatchObject({ n: 1 })
  })

  it('normalise les chemins en « / » (Windows compris)', () => {
    expect(normalizeDecorPath('data\\artifacts\\decor\\x\\decor-2K-a.jpg')).toBe(
      'data/artifacts/decor/x/decor-2K-a.jpg'
    )
    const db = getDb(':memory:')
    registerDecor({ filePath: 'data\\artifacts\\decor\\x\\decor-2K-a.jpg', name: 'X', slug: 'x' }, db)
    expect(getDecorByPath('data/artifacts/decor/x/decor-2K-a.jpg', db)).toBeTruthy()
  })
})

describe('bibliothèque de décors — édition, tags, gammes', () => {
  it('met à jour les champs éditables et liste les gammes distinctes', () => {
    const db = getDb(':memory:')
    const id = freshDecor(db)
    updateDecor(id, { name: 'Nouveau nom', gamme: 'Background 1 – MES VOGEL', type: 'coulissant', angle: 'angle' }, db)
    expect(getDecor(id, db)).toMatchObject({
      name: 'Nouveau nom',
      gamme: 'Background 1 – MES VOGEL',
      type: 'coulissant',
      angle: 'angle',
    })
    expect(listGammes(db)).toEqual(['Background 1 – MES VOGEL'])
  })

  it('nettoie les tags : vides/doublons (insensibles à la casse) écartés, longueur bornée', () => {
    expect(sanitizeTags(['Maison blanche', ' maison BLANCHE ', '', 'Moderne', 42])).toEqual([
      'Maison blanche',
      'Moderne',
    ])
    expect(sanitizeTags('pas un tableau')).toEqual([])
  })

  it('remplace ou ajoute des tags, et alimente le vocabulaire global', () => {
    const db = getDb(':memory:')
    const id = freshDecor(db)
    setDecorTags(id, ['Moderne', 'Toit anthracite'], db)
    addDecorTags(id, ['Moderne', 'Végétation dense'], db)
    const lib = listDecorLibrary(1, db)
    expect(lib[0].tags.sort()).toEqual(['Moderne', 'Toit anthracite', 'Végétation dense'])
    expect(listAllTags(db)).toContain('Végétation dense')
    setDecorTags(id, ['Provençal'], db)
    expect(listDecorLibrary(1, db)[0].tags).toEqual(['Provençal'])
  })
})

describe('bibliothèque de décors — favoris par utilisateur', () => {
  it('bascule le favori pour UN utilisateur sans toucher les autres', () => {
    const db = getDb(':memory:')
    const id = freshDecor(db)
    db.prepare(`INSERT INTO users (username, password_hash, role) VALUES ('equipe', 'x', 'user')`).run()
    expect(toggleFavorite(1, id, db)).toBe(true)
    expect(listDecorLibrary(1, db)[0].favorite).toBe(true)
    expect(listDecorLibrary(2, db)[0].favorite).toBe(false)
    expect(toggleFavorite(1, id, db)).toBe(false)
    expect(listDecorLibrary(1, db)[0].favorite).toBe(false)
  })
})

describe('bibliothèque de décors — utilisation et garde de suppression', () => {
  it('retrouve la dernière utilisation via le payload des jobs (chemins « / » et Windows)', () => {
    const db = getDb(':memory:')
    freshDecor(db)
    expect(getDecorLastUse(FILE, db)).toBeNull()
    // Job historique : chemin Windows avec antislashs, échappé dans le JSON stocké
    const winPath = FILE.split('/').join('\\')
    const jobId = createJob('pillars', { decorPath: winPath, sizes: [{ w: 300, h: 140 }] }, db)
    const use = getDecorLastUse(FILE, db)
    expect(use).toMatchObject({ jobId, jobType: 'pillars' })
    // Job récent : chemin « / » de la bibliothèque
    const jobId2 = createJob('integration', { decorPath: FILE }, db)
    expect(getDecorLastUse(FILE, db)).toMatchObject({ jobId: jobId2 })
  })

  it('interdit la suppression uniquement si une génération VALIDÉE a utilisé le décor', () => {
    const db = getDb(':memory:')
    freshDecor(db)
    const jobId = createJob('pillars', { decorPath: FILE }, db)
    expect(decorUsedByValidatedJob(FILE, db)).toBe(false)
    updateJob(jobId, { review_status: 'approved' }, db)
    expect(decorUsedByValidatedJob(FILE, db)).toBe(true)
  })

  it('supprime l’entrée avec ses tags et favoris', () => {
    const db = getDb(':memory:')
    const id = freshDecor(db)
    setDecorTags(id, ['Moderne'], db)
    toggleFavorite(1, id, db)
    deleteDecorRow(id, db)
    expect(getDecor(id, db)).toBeUndefined()
    expect(db.prepare('SELECT COUNT(*) AS n FROM decor_tags').get()).toMatchObject({ n: 0 })
    expect(db.prepare('SELECT COUNT(*) AS n FROM decor_favorites').get()).toMatchObject({ n: 0 })
  })
})

describe('bibliothèque de décors — pont validation', () => {
  it('active le décor « À valider » quand son job est approuvé par un admin', () => {
    const db = getDb(':memory:')
    const jobId = createJob('decor', { moodboardPath: 'x' }, db)
    const id = registerDecor({ filePath: FILE, name: 'V', slug: 's', jobId }, db)
    activateDecorByJob(jobId, db)
    expect(getDecor(id, db)!.status).toBe('actif')
    // Un décor déjà archivé n'est pas réactivé par le pont
    updateDecor(id, { status: 'archive' }, db)
    activateDecorByJob(jobId, db)
    expect(getDecor(id, db)!.status).toBe('archive')
  })
})

describe('bibliothèque de décors — versions et retour arrière', () => {
  const FIX1 = 'data/artifacts/decor/background-1-veymont/retouche-2K-A.jpg'
  const FIX2 = 'data/artifacts/decor/background-1-veymont/retouche-2K-B.jpg'

  it('crée la version 1 à l’enregistrement, y compris pour les décors historiques', () => {
    const db = getDb(':memory:')
    const id = freshDecor(db)
    const versions = listDecorVersions(id, db)
    expect(versions).toHaveLength(1)
    expect(versions[0]).toMatchObject({ version: 1, kind: 'initial', file_path: FILE })
    // ensureInitialVersion est idempotent
    ensureInitialVersion(id, db)
    expect(listDecorVersions(id, db)).toHaveLength(1)
  })

  it('une correction devient la version courante et repasse le décor « À valider »', () => {
    const db = getDb(':memory:')
    const id = freshDecor(db)
    updateDecor(id, { status: 'actif' }, db)
    const v = addDecorVersion(
      id,
      { filePath: FIX1, kind: 'correction', instruction: 'Enlève l’arbre', width: 2528, height: 1696 },
      db
    )
    expect(v).toMatchObject({ version: 2, kind: 'correction' })
    const decor = getDecor(id, db)!
    expect(decor.file_path).toBe(FIX1)
    expect(decor.status).toBe('a_valider')
    expect(decor.width).toBe(2528)
  })

  it('restaure une ancienne version via une nouvelle entrée d’historique (statut conservé)', () => {
    const db = getDb(':memory:')
    const id = freshDecor(db)
    addDecorVersion(id, { filePath: FIX1, kind: 'correction', instruction: 'x' }, db)
    addDecorVersion(id, { filePath: FIX2, kind: 'correction', instruction: 'y' }, db)
    updateDecor(id, { status: 'actif' }, db)
    const v1 = listDecorVersions(id, db).find((v) => v.version === 1)!
    const restored = restoreDecorVersion(id, v1.id, db)!
    expect(restored).toMatchObject({ version: 4, kind: 'restauration', file_path: FILE })
    const decor = getDecor(id, db)!
    expect(decor.file_path).toBe(FILE)
    expect(decor.status).toBe('actif')
    // Restaurer la version déjà courante ne crée rien
    const again = restoreDecorVersion(id, restored.id, db)!
    expect(listDecorVersions(id, db)).toHaveLength(4)
    expect(again.file_path).toBe(FILE)
  })

  it('la garde de suppression couvre TOUTES les versions, pas seulement la courante', () => {
    const db = getDb(':memory:')
    const id = freshDecor(db)
    addDecorVersion(id, { filePath: FIX1, kind: 'correction', instruction: 'x' }, db)
    // Un job validé a utilisé la V1 (qui n'est plus courante)
    const jobId = createJob('pillars', { decorPath: FILE }, db)
    updateJob(jobId, { review_status: 'approved' }, db)
    expect(decorUsedByValidatedJob(FIX1, db)).toBe(true)
  })

  it('supprimer le décor supprime aussi son historique', () => {
    const db = getDb(':memory:')
    const id = freshDecor(db)
    addDecorVersion(id, { filePath: FIX1, kind: 'correction', instruction: 'x' }, db)
    deleteDecorRow(id, db)
    expect(db.prepare('SELECT COUNT(*) AS n FROM decor_versions').get()).toMatchObject({ n: 0 })
  })
})

describe('réglages d’application', () => {
  it('générations simultanées : défaut 10, lecture/écriture, bornes respectées', async () => {
    const { getSetting, setSetting, getConcurrencyPerUser, CONCURRENCY_KEY } = await import(
      '@/lib/db/settings'
    )
    const db = getDb(':memory:')
    expect(getConcurrencyPerUser(db)).toBe(10)
    setSetting(CONCURRENCY_KEY, '3', db)
    expect(getSetting(CONCURRENCY_KEY, db)).toBe('3')
    expect(getConcurrencyPerUser(db)).toBe(3)
    setSetting(CONCURRENCY_KEY, '999', db)
    expect(getConcurrencyPerUser(db)).toBe(20) // plafonné
    setSetting(CONCURRENCY_KEY, 'n’importe quoi', db)
    expect(getConcurrencyPerUser(db)).toBe(10) // retombe sur le défaut
  })
})

describe('groupes de génération (batch)', () => {
  it('relie les jobs d’un même lancement et les relit dans l’ordre', () => {
    const db = getDb(':memory:')
    const batch = 'abc123-test'
    const a = createJob('pillars', { size: { w: 300, h: 140 } }, db, batch, 'mathias')
    const b = createJob('pillars', { size: { w: 350, h: 140 } }, db, batch, 'mathias')
    createJob('pillars', { size: { w: 400, h: 140 } }, db) // hors batch
    const c = createJob('integration', { pillarsJobId: a, size: { w: 300, h: 140 } }, db, batch)
    const jobs = listJobsByBatch(batch, db)
    expect(jobs.map((j) => j.id)).toEqual([a, b, c])
    expect(jobs.every((j) => j.batch_id === batch)).toBe(true)
    expect(jobs[0].created_by).toBe('mathias')
    expect(jobs[2].created_by).toBeNull()
    expect(listJobsByBatch('inconnu', db)).toHaveLength(0)
  })
})

describe('tags automatiques — analyse de la réponse LLM', () => {
  it('extrait le tableau JSON même entouré de texte', () => {
    expect(parseTagsResponse('Voici :\n["Maison blanche", "Moderne"]\nVoilà.')).toEqual([
      'Maison blanche',
      'Moderne',
    ])
  })
  it('retourne vide si la réponse est inexploitable', () => {
    expect(parseTagsResponse('aucun tableau ici')).toEqual([])
    expect(parseTagsResponse('[pas du json')).toEqual([])
  })
})

describe('noms lisibles', () => {
  it('dérive un nom depuis un slug de dossier', () => {
    expect(prettifySlug('background-1-portail-battant-veymont')).toBe(
      'Background 1 Portail Battant Veymont'
    )
  })
})
