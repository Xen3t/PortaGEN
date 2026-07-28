import { describe, expect, it } from 'vitest'
import {
  buildFileName,
  canonicalKeyword,
  destFromDims,
  parseVisualBlock,
  parseVisualFromFileName,
  sizeToken,
} from '@/lib/detection/nomenclature'
import { classifyColoris } from '@/lib/detection/classify'
import {
  saveExample,
  labelQueue,
  detectionStats,
  listBulkVues,
  bulkQueue,
  recentAtelierExamples,
  deleteAtelierExamples,
  rejectFromBulk,
} from '@/lib/detection/store'
import { getDb } from '@/lib/db'

describe('nomenclature — lecture des blocs conformes', () => {
  it('lit les mots-clés simples du listing', () => {
    expect(parseVisualBlock('FRONT')).toMatchObject({ base: 'FRONT', open: false, q3: null })
    expect(parseVisualBlock('ST')).toMatchObject({ base: 'ST' })
    expect(parseVisualBlock('NOTICE')).toMatchObject({ base: 'NOTICE' })
  })

  it('lit les combinaisons du document', () => {
    expect(parseVisualBlock('FRONT-OPEN')).toMatchObject({ base: 'FRONT', open: true })
    expect(parseVisualBlock('FRONT-3Q-RIGHT')).toMatchObject({ base: 'FRONT', q3: 'RIGHT' })
    expect(parseVisualBlock('FRONT-BELOW-3Q-RIGHT')).toMatchObject({
      base: 'FRONT',
      tilt: 'BELOW',
      q3: 'RIGHT',
    })
    expect(parseVisualBlock('FRONT-ABOVE-OPEN-3Q-RIGHT')).toMatchObject({
      base: 'FRONT',
      tilt: 'ABOVE',
      open: true,
      q3: 'RIGHT',
    })
    expect(parseVisualBlock('BACK-OPEN')).toMatchObject({ base: 'BACK', open: true })
    expect(parseVisualBlock('BELOW-OPEN')).toMatchObject({ base: 'BELOW', open: true })
  })

  it('lit les numéros sans les garder dans le mot-clé', () => {
    const mes = parseVisualBlock('MES-02')
    expect(mes).toMatchObject({ base: 'MES', num: 2 })
    expect(canonicalKeyword(mes!)).toBe('MES')
    expect(parseVisualBlock('ZOOM-01')).toMatchObject({ base: 'ZOOM', num: 1 })
    expect(parseVisualBlock('IT-03')).toMatchObject({ base: 'IT', num: 3 })
  })

  it('refuse les blocs qui ne sont pas des vues', () => {
    expect(parseVisualBlock('ARLBERG-100P120')).toBeNull()
    expect(parseVisualBlock('KIT-000145')).toBeNull()
    expect(parseVisualBlock('WEB-FR')).toBeNull()
    expect(parseVisualBlock('FRONT-3Q')).toBeNull() // 3/4 sans direction
    expect(parseVisualBlock('ST-OPEN')).toBeNull() // OPEN interdit sur ST
  })
})

describe('nomenclature — lecture des noms de fichiers', () => {
  it('lit un nom conforme (exemple du document)', () => {
    const r = parseVisualFromFileName('ARLBERG-100P120_FRONT-OPEN_MP_KIT-000145.jpeg')
    expect(r?.conforming).toBe(true)
    expect(canonicalKeyword(r!.ident)).toBe('FRONT-OPEN')
  })

  it('lit un ancien nommage (FRONT/BACK dans le nom)', () => {
    const r1 = parseVisualFromFileName('VOGEL-300-FRONT.jpg')
    expect(r1?.conforming).toBe(false)
    expect(canonicalKeyword(r1!.ident)).toBe('FRONT')

    const r2 = parseVisualFromFileName('NALI 350 BACK OPEN.png')
    expect(canonicalKeyword(r2!.ident)).toBe('BACK-OPEN')

    const r3 = parseVisualFromFileName('VALIER-400-FRONT-3-4-LEFT.jpg')
    expect(canonicalKeyword(r3!.ident)).toBe('FRONT-3Q-LEFT')
  })

  it('ne devine rien sur un nom muet', () => {
    expect(parseVisualFromFileName('IMG_2041.png')).toBeNull()
    expect(parseVisualFromFileName('DSC00123.jpg')).toBeNull()
    // « ST » et « IT » jamais déduits d'un ancien nommage (trop de faux positifs).
    expect(parseVisualFromFileName('STOCK-PHOTO.jpg')).toBeNull()
  })
})

describe('nomenclature — construction des noms', () => {
  it('reconstruit l’exemple du document', () => {
    expect(
      buildFileName({
        gamme: 'ARLBERG',
        sizeToken: '100P120',
        keyword: 'FRONT-OPEN',
        dest: 'MP',
        ref: 'KIT-000145',
      })
    ).toBe('ARLBERG-100P120_FRONT-OPEN_MP_KIT-000145.jpeg')
  })

  it('numérote les bases numérotées et marque les réfs inconnues', () => {
    expect(
      buildFileName({ gamme: 'NALI', sizeToken: '350C160', keyword: 'MES', num: 1, dest: 'WEB' })
    ).toBe('NALI-350C160_MES-01_WEB_KIT-??????.jpeg')
  })

  it('jeton taille par famille et destination par dimensions', () => {
    expect(sizeToken(300, 140, 'PORTAIL BATTANT')).toBe('300B140')
    expect(sizeToken(350, 160, 'PORTAIL COULISSANT')).toBe('350C160')
    expect(sizeToken(100, 120, 'PORTILLON')).toBe('100P120')
    expect(destFromDims(2000, 1330)).toBe('WEB')
    expect(destFromDims(2000, 2000)).toBe('MP')
    expect(destFromDims(1024, 768)).toBeNull()
  })
})

describe('classement coloris par exemples (base en mémoire)', () => {
  it('départage gris/noir PAR GAMME et sait dire « je ne sais pas »', () => {
    const db = getDb(':memory:')
    db.prepare(
      `INSERT INTO catalog_products (brand, family, name, server_path, status, summary)
       VALUES ('CASANOOV', 'PORTAIL BATTANT', 'VOGEL', 'X:\\VOGEL', 'detecte', '{}'),
              ('CASANOOV', 'PORTAIL BATTANT', 'NALI', 'X:\\NALI', 'detecte', '{}')`
    ).run()

    // Leçon de juillet : gris VOGEL L81 plus CLAIR que noir NALI L62.
    saveExample(
      { productId: 1, relPath: 'a.jpg', axis: 'coloris', label: 'Gris', source: 'dossier', features: { L: 81, tint: 12, matFrac: 0.6 }, gamme: 'VOGEL' },
      db
    )
    saveExample(
      { productId: 1, relPath: 'b.jpg', axis: 'coloris', label: 'Gris', source: 'dossier', features: { L: 78, tint: 10, matFrac: 0.62 }, gamme: 'VOGEL' },
      db
    )
    saveExample(
      { productId: 2, relPath: 'c.jpg', axis: 'coloris', label: 'Noir', source: 'dossier', features: { L: 62, tint: 2, matFrac: 0.58 }, gamme: 'NALI' },
      db
    )
    saveExample(
      { productId: 2, relPath: 'd.jpg', axis: 'coloris', label: 'Noir', source: 'dossier', features: { L: 60, tint: 1, matFrac: 0.6 }, gamme: 'NALI' },
      db
    )

    const vogel = classifyColoris({ L: 80, tint: 11, matFrac: 0.61 }, 'VOGEL', db)
    expect(vogel.coloris).toBe('Gris')
    const nali = classifyColoris({ L: 61, tint: 2, matFrac: 0.59 }, 'NALI', db)
    expect(nali.coloris).toBe('Noir')
    // Matière chaude type teck, loin de tout exemple : pas d'invention.
    const inconnu = classifyColoris({ L: 120, tint: -60, matFrac: 0.7 }, 'VOGEL', db)
    expect(inconnu.coloris).toBeNull()
  })
})

describe('exemples — préséance des sources et file d’atelier', () => {
  it('un clic atelier n’est jamais écrasé par une récolte automatique', () => {
    const db = getDb(':memory:')
    db.prepare(
      `INSERT INTO catalog_products (brand, family, name, server_path, status, summary)
       VALUES ('CASANOOV', 'PORTAIL BATTANT', 'VOGEL', 'X:\\VOGEL', 'detecte', '{}')`
    ).run()
    const ex = { productId: 1, relPath: 'x.jpg', axis: 'vue' as const, gamme: 'VOGEL' }

    expect(saveExample({ ...ex, label: 'MES', source: 'dossier' }, db)).toBe(true)
    expect(saveExample({ ...ex, label: 'FRONT', source: 'atelier' }, db)).toBe(true)
    // La récolte suivante repasse : le clic reste.
    expect(saveExample({ ...ex, label: 'MES', source: 'dossier' }, db)).toBe(false)
    const row = db
      .prepare(`SELECT label, source FROM detection_examples WHERE rel_path = 'x.jpg'`)
      .get() as { label: string; source: string }
    expect(row).toMatchObject({ label: 'FRONT', source: 'atelier' })
  })

  it('la file de l’atelier montre les moins sûres d’abord, sans les déjà classées', () => {
    const db = getDb(':memory:')
    db.prepare(
      `INSERT INTO catalog_products (brand, family, name, server_path, status, summary)
       VALUES ('CASANOOV', 'PORTAIL BATTANT', 'VOGEL', 'X:\\VOGEL', 'detecte', '{}')`
    ).run()
    const blob = Buffer.alloc(384 * 4)
    const ins = db.prepare(
      `INSERT INTO detection_images (product_id, rel_path, embedding, pred_vue, pred_vue_conf)
       VALUES (1, ?, ?, ?, ?)`
    )
    ins.run('sure.jpg', blob, 'MES', 0.9)
    ins.run('doute.jpg', blob, 'FRONT', 0.2)
    ins.run('classee.jpg', blob, 'FRONT', 0.1)
    saveExample(
      { productId: 1, relPath: 'classee.jpg', axis: 'vue', label: 'FRONT', source: 'atelier' },
      db
    )

    const queue = labelQueue(10, db)
    expect(queue.map((q) => q.rel_path)).toEqual(['doute.jpg', 'sure.jpg'])
    expect(detectionStats(db).aClasser).toBe(2)
  })
})

describe('mode par lots + annulation (base en mémoire)', () => {
  function seed() {
    const db = getDb(':memory:')
    db.prepare(
      `INSERT INTO catalog_products (brand, family, name, server_path, status, summary)
       VALUES ('CASANOOV', 'PORTAIL BATTANT', 'VOGEL', 'X:\\VOGEL', 'detecte', '{}')`
    ).run()
    const blob = Buffer.alloc(384 * 4)
    const ins = db.prepare(
      `INSERT INTO detection_images (product_id, rel_path, embedding, pred_vue, pred_vue_conf)
       VALUES (1, ?, ?, ?, ?)`
    )
    ins.run('f1.jpg', blob, 'FRONT', 0.9)
    ins.run('f2.jpg', blob, 'FRONT', 0.95)
    ins.run('f3.jpg', blob, 'FRONT', 0.6)
    ins.run('b1.jpg', blob, 'BACK', 0.8)
    return db
  }

  it('propose les vues par volume et sert les lots les plus sûrs d’abord', () => {
    const db = seed()
    expect(listBulkVues(db)).toEqual([
      { vue: 'FRONT', n: 3 },
      { vue: 'BACK', n: 1 },
    ])
    // Ordre : confiance décroissante ; offset = « passer ce lot ».
    expect(bulkQueue('FRONT', 2, 0, db).map((r) => r.rel_path)).toEqual(['f2.jpg', 'f1.jpg'])
    expect(bulkQueue('FRONT', 2, 2, db).map((r) => r.rel_path)).toEqual(['f3.jpg'])
    // Une image classée sort des lots et des comptes.
    saveExample(
      { productId: 1, relPath: 'f2.jpg', axis: 'vue', label: 'FRONT', source: 'atelier' },
      db
    )
    expect(listBulkVues(db)[0]).toEqual({ vue: 'FRONT', n: 2 })
    expect(bulkQueue('FRONT', 5, 0, db).map((r) => r.rel_path)).toEqual(['f1.jpg', 'f3.jpg'])
  })

  it('une image décochée ne revient plus dans les lots de cette vue (retour Mathias 27/07)', () => {
    const db = seed()
    const f2 = db
      .prepare(`SELECT id FROM detection_images WHERE rel_path = 'f2.jpg'`)
      .get() as { id: number }
    rejectFromBulk([f2.id], 'FRONT', db)
    // Plus dans les lots FRONT ni dans leur compte…
    expect(bulkQueue('FRONT', 5, 0, db).map((r) => r.rel_path)).toEqual(['f1.jpg', 'f3.jpg'])
    expect(listBulkVues(db)[0]).toEqual({ vue: 'FRONT', n: 2 })
    // …mais EN TÊTE de la file un par un (le refus a de la valeur).
    expect(labelQueue(10, db)[0].rel_path).toBe('f2.jpg')
    // Si une nouvelle analyse la prédit AUTREMENT, le lot de l'autre vue peut la proposer.
    db.prepare(`UPDATE detection_images SET pred_vue = 'BACK', pred_vue_conf = 0.7 WHERE id = ?`).run(f2.id)
    expect(bulkQueue('BACK', 5, 0, db).map((r) => r.rel_path)).toEqual(['b1.jpg', 'f2.jpg'])
  })

  it('historique des clics + annulation = retour dans la file', () => {
    const db = seed()
    saveExample(
      { productId: 1, relPath: 'f1.jpg', axis: 'vue', label: 'FRONT', source: 'atelier' },
      db
    )
    saveExample(
      { productId: 1, relPath: 'f1.jpg', axis: 'coloris', label: 'Gris', source: 'atelier', features: { L: 80, tint: 10, matFrac: 0.6 } },
      db
    )
    // Les exemples automatiques n'apparaissent PAS dans l'historique des clics.
    saveExample(
      { productId: 1, relPath: 'b1.jpg', axis: 'vue', label: 'BACK', source: 'nom' },
      db
    )
    const recents = recentAtelierExamples(10, db)
    expect(recents).toHaveLength(1)
    expect(recents[0]).toMatchObject({ relPath: 'f1.jpg', vue: 'FRONT', coloris: 'Gris' })

    const before = detectionStats(db).aClasser
    expect(deleteAtelierExamples(1, 'f1.jpg', db)).toBe(2) // vue + coloris
    expect(recentAtelierExamples(10, db)).toHaveLength(0)
    expect(detectionStats(db).aClasser).toBe(before + 1) // l'image est revenue dans la file
  })
})
