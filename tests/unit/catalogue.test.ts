import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { getDb } from '@/lib/db'
import {
  classifyGammeDir,
  detectView,
  isIgnoredDir,
  normalizeDirName,
  parseColorisDir,
  parseColorisFromDirName,
  parseMesColoris,
  parseMesFileFormat,
  parseRenduFormat,
  parseSizeDir,
} from '@/lib/catalogue/parse'
import { sanitizeColorisSettings, getColorisSettings, saveColorisSettings } from '@/lib/catalogue/defaults'
import { CANONICAL_COLORIS, colorisDef, swatchFor } from '@/lib/catalogue/colorisPalette'
import { saveColorisOverride, listColorisOverrides } from '@/lib/catalogue/colorisOverride'
import sharp from 'sharp'
import {
  deriveStatus,
  listCatalogProducts,
  rescanCatalogProduct,
  resolveMesFormats,
  runCatalogScan,
  scanGamme,
} from '@/lib/catalogue/scan'
import { canonicalMesFormat } from '@/lib/catalogue/parse'
import { getCatalogThumb } from '@/lib/catalogue/thumbs'

/**
 * Le scan serveur est TOLÉRANT : les cas testés ici viennent tous de
 * l'arborescence réelle constatée le 12/07/2026 (gamme VOGEL) — espaces
 * doubles, points optionnels, trois générations de nommage de fichiers.
 * Les fixtures sont créées en LOCAL (jamais sur le serveur O:).
 */

describe('parseurs du catalogue', () => {
  it('reconnaît les dossiers standards malgré les variantes', () => {
    expect(normalizeDirName('M.E.S. IA')).toBe('MESIA')
    expect(classifyGammeDir('IMAGE  PRODUIT')).toBe('image-produit') // double espace réel
    expect(classifyGammeDir('IMAGE PRODUIT')).toBe('image-produit')
    expect(classifyGammeDir('PHOTO PRODUIT')).toBe('image-produit') // template récent (portillons)
    expect(classifyGammeDir('IMAGE FOURNISSEUR')).toBe('image-fournisseur')
    expect(classifyGammeDir('IMAGES FOURNISSEURS')).toBe('image-fournisseur')
    // Les 5 orthographes MES relevées sur les 94 gammes le 12/07/2026.
    expect(classifyGammeDir('M.E.S IA')).toBe('mes-ia')
    expect(classifyGammeDir('M.E.S. IA')).toBe('mes-ia')
    expect(classifyGammeDir('MES IA')).toBe('mes-ia')
    expect(classifyGammeDir('M.E.S  IA')).toBe('mes-ia')
    expect(classifyGammeDir('M.E.S')).toBe('mes-ia')
    expect(classifyGammeDir('MOODBOARD')).toBe('moodboard')
    expect(classifyGammeDir('PHOTO STUDIO')).toBe('autre')
  })

  it('ignore les dossiers d’archives et de travail', () => {
    expect(isIgnoredDir('_OLD')).toBe(true)
    expect(isIgnoredDir('_old')).toBe(true) // coulissants
    expect(isIgnoredDir('Recolorisation Ralify')).toBe(true)
    expect(isIgnoredDir('project-retouche-couleur')).toBe(true) // coulissants
    expect(isIgnoredDir('Project')).toBe(true) // portillons
    expect(isIgnoredDir('.claude')).toBe(true)
    expect(isIgnoredDir('Png')).toBe(false)
    expect(isIgnoredDir('png')).toBe(false) // portillons : sous-dossier png minuscule
  })

  it('parse les dossiers coloris dans leurs trois formes réelles', () => {
    expect(parseColorisDir('BLANC _ KIT-000110')).toEqual({
      coloris: 'BLANC',
      kitRef: 'KIT-000110',
      colorCode: null,
    })
    expect(parseColorisDir('BLANC_KIT-000545')).toEqual({
      coloris: 'BLANC',
      kitRef: 'KIT-000545',
      colorCode: null,
    })
    expect(parseColorisDir('GRIS _ 7016')).toEqual({
      coloris: 'GRIS',
      kitRef: null,
      colorCode: '7016',
    })
    // Réfs STW des portillons.
    expect(parseColorisDir('BLANC _ STW-000037')).toEqual({
      coloris: 'BLANC',
      kitRef: 'STW-000037',
      colorCode: null,
    })
    expect(parseColorisDir('SANS SEPARATEUR')).toBeNull()
  })

  it('lit le coloris dans le nom du dossier taille (convention ATHOS), jamais une réf SKU', () => {
    expect(parseColorisFromDirName('ATHOS 300B140 - Gris')).toBe('Gris')
    expect(parseColorisFromDirName('ATHOS 300B160 - Teck')).toBe('Teck')
    expect(parseColorisFromDirName('MACHIN 300B120 Blanc')).toBe('Blanc')
    expect(parseColorisFromDirName('TRUC 350B140 Noir mat')).toBe('Noir')
    // Une réf SKU seule n'est pas un coloris.
    expect(parseColorisFromDirName('ANTELAO 300B110 _ STW-000054')).toBeNull()
    expect(parseColorisFromDirName('VOGEL 300B120')).toBeNull()
  })

  it('détecte la vue de face fermée, la seule utile aux MES Contraintes', () => {
    expect(detectView('2_VOGEL300B120_FRONT-BG.jpg')).toEqual({ view: 'front', isFaceView: true })
    expect(detectView('1_KIT-000545_VOGEL-350B120-FRONT.jpg').isFaceView).toBe(true)
    expect(detectView('5_VOGEL300B120_FRONT-OPEN.jpg')).toEqual({
      view: 'front-open',
      isFaceView: false,
    })
    expect(detectView('7_VOGEL300B120_BACK.jpg').isFaceView).toBe(false)
    expect(detectView('1-VOGEL350B120.jpg')).toEqual({ view: 'inconnue', isFaceView: false })
  })

  it('parse tailles et formats de rendu', () => {
    expect(parseSizeDir('VOGEL 300B120')).toMatchObject({ w: 300, h: 120 })
    expect(parseSizeDir('Traitement image.psd')).toBeNull()
    expect(parseRenduFormat('2000x1330')).toBe('2000x1330')
    expect(parseRenduFormat('2000×2000')).toBe('2000x2000')
    // Convention VALIER : WEB = site, MP = marketplace — y compris comme mot
    // d'un nom de dossier (« Export WEB » chez VOGEL).
    expect(parseRenduFormat('WEB')).toBe('2000x1330')
    expect(parseRenduFormat('Export WEB')).toBe('2000x1330')
    expect(parseRenduFormat('MP')).toBe('2000x2000')
    expect(parseRenduFormat('RENDU MP')).toBe('2000x2000')
    expect(parseRenduFormat('RENDU')).toBeNull()
    expect(parseRenduFormat('Export RUNWAY')).toBeNull()
    expect(parseRenduFormat('Export')).toBeNull()
  })

  it('déduit le format d’une MES depuis son nom de fichier', () => {
    expect(parseMesFileFormat('VALIER-300B140_MES-01_WEB_KIT-000814.jpg')).toBe('2000x1330')
    expect(parseMesFileFormat('VALIER-300B140_MES-02_MP_KIT-000814.jpg')).toBe('2000x2000')
    expect(parseMesFileFormat('VOGEL_300B120_MES Main image_2000x1330.jpg')).toBe('2000x1330')
    expect(parseMesFileFormat('image-quelconque.jpg')).toBeNull()
  })

  it('classe une MES par ses DIMENSIONS : 1:1 = marketplace, ratio 2000/1330 = site', () => {
    expect(canonicalMesFormat(2000, 2000)).toBe('2000x2000')
    expect(canonicalMesFormat(2048, 2048)).toBe('2000x2000') // carré = marketplace
    expect(canonicalMesFormat(2000, 1330)).toBe('2000x1330')
    expect(canonicalMesFormat(1200, 800)).toBe('2000x1330') // même ratio = site
    expect(canonicalMesFormat(1000, 400)).toBe('1000x400') // ratio inconnu : dimensions brutes
    expect(canonicalMesFormat(0, 0)).toBe('autre')
  })

  it('déduit le coloris d’une MES depuis les coloris connus de la gamme (synonymes FR/EN)', () => {
    const known = ['GRIS', 'BLANC']
    expect(parseMesColoris('VOGEL_White_300B120_MES Main image_2000x1330.jpg', known)).toBe('BLANC')
    expect(parseMesColoris('VOGEL-300B120-GRIS-MES.jpg', known)).toBe('GRIS')
    expect(parseMesColoris('VOGEL_300B120_MES Main image_2000x1330.jpg', known)).toBeNull()
    expect(parseMesColoris('n-importe-quoi.jpg', [])).toBeNull()
  })
})

/** Fixture locale reproduisant l'arborescence réelle du serveur. */
function buildFixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'portagen-catalogue-'))
  const gamme = path.join(root, 'CASANOOV', 'PRODUITS', 'PORTAIL BATTANT', 'VOGEL')
  const mk = (...p: string[]) => fs.mkdirSync(path.join(gamme, ...p), { recursive: true })
  const touch = (...p: string[]) => fs.writeFileSync(path.join(gamme, ...p), 'x')

  mk('IMAGE  PRODUIT', 'VOGEL 300B120', 'BLANC _ KIT-000110', 'Png')
  touch('IMAGE  PRODUIT', 'VOGEL 300B120', 'BLANC _ KIT-000110', '2_VOGEL300B120_FRONT-BG.jpg')
  touch('IMAGE  PRODUIT', 'VOGEL 300B120', 'BLANC _ KIT-000110', '5_VOGEL300B120_FRONT-OPEN.jpg')
  touch('IMAGE  PRODUIT', 'VOGEL 300B120', 'BLANC _ KIT-000110', '7_VOGEL300B120_BACK.jpg')
  touch('IMAGE  PRODUIT', 'VOGEL 300B120', 'BLANC _ KIT-000110', 'Png', 'Vent-B-J-1055-white-2-300B120.png')
  mk('IMAGE  PRODUIT', 'VOGEL 300B120', 'GRIS _ KIT-000108')
  touch('IMAGE  PRODUIT', 'VOGEL 300B120', 'GRIS _ KIT-000108', '2_VOGEL300B120_FRONT-BG.jpg')
  mk('IMAGE  PRODUIT', 'VOGEL 300B120', '_OLD')
  touch('IMAGE  PRODUIT', 'VOGEL 300B120', '_OLD', 'VOGEL 300B120 FRONT LEFT.jpg')
  touch('IMAGE  PRODUIT', 'Traitement image.psd')
  // Variante « à plat » des coulissants : fichiers directement dans le dossier
  // taille (qui porte la réf), + un dossier de retouche à ignorer.
  mk('IMAGE  PRODUIT', 'VOGEL 300C160 _ KIT-000013', 'project-retouche-couleur')
  touch('IMAGE  PRODUIT', 'VOGEL 300C160 _ KIT-000013', 'VOGEL-300C160-FRONT(0).jpg')
  touch('IMAGE  PRODUIT', 'VOGEL 300C160 _ KIT-000013', 'VOGEL-300C160-FRONT(1).jpg')
  // Variante VALIER : visuels dans RENDU\WEB|MP|PNG, réf SKU dans les noms
  // de fichiers, sources dans LINK (à exclure).
  mk('IMAGE  PRODUIT', 'VOGEL 350B140', 'LINK')
  touch('IMAGE  PRODUIT', 'VOGEL 350B140', 'LINK', 'source-magnific.png')
  mk('IMAGE  PRODUIT', 'VOGEL 350B140', 'RENDU', 'WEB')
  touch('IMAGE  PRODUIT', 'VOGEL 350B140', 'RENDU', 'WEB', '2_-_VOGEL-350B140_FRONT_WEB_KIT-000814.jpg')
  mk('IMAGE  PRODUIT', 'VOGEL 350B140', 'RENDU', 'MP')
  touch('IMAGE  PRODUIT', 'VOGEL 350B140', 'RENDU', 'MP', '2_-_VOGEL-350B140_FRONT_MP_KIT-000814.jpg')
  mk('IMAGE  PRODUIT', 'VOGEL 350B140', 'RENDU', 'PNG')
  touch('IMAGE  PRODUIT', 'VOGEL 350B140', 'RENDU', 'PNG', 'VOGEL-350B140_FRONT_KIT-000814.png')
  mk('IMAGE FOURNISSEUR', 'VOGEL 300B120', 'BLANC _ 1055')
  mk('M.E.S IA', 'PB VOGEL MAIN IMAGE', 'RENDU', '2000x1330')
  touch('M.E.S IA', 'PB VOGEL MAIN IMAGE', 'RENDU', '2000x1330', 'VOGEL_300B120_MES Main image_2000x1330.jpg')
  mk('M.E.S IA', 'PB VOGEL MAIN IMAGE', 'RENDU', '2000x2000')
  touch('M.E.S IA', 'PB VOGEL MAIN IMAGE', 'RENDU', '2000x2000', 'VOGEL_300B120_MES Main image_2000x2000.jpg')
  // Rangement VALIER : RENDU\WEB / RENDU\MP. Règle : les dossiers de SORTIE
  // comptent (RENDU actuel + Export ancien, sauf Export RUNWAY) — LINK et
  // fichiers à plat sont des sources/travail.
  mk('M.E.S IA', 'VOGEL 300B120', 'LINK')
  touch('M.E.S IA', 'VOGEL 300B120', 'LINK', 'magnific_source.png')
  mk('M.E.S IA', 'VOGEL 300B120', 'RENDU', 'WEB')
  touch('M.E.S IA', 'VOGEL 300B120', 'RENDU', 'WEB', 'VOGEL-300B120_MES-01_WEB_KIT-000110.jpg')
  mk('M.E.S IA', 'VOGEL 300B120', 'RENDU', 'MP')
  touch('M.E.S IA', 'VOGEL 300B120', 'RENDU', 'MP', 'VOGEL-300B120_MES-01_MP_KIT-000110.jpg')
  mk('M.E.S IA', 'VOGEL 300B120', 'Export')
  touch('M.E.S IA', 'VOGEL 300B120', 'Export', 'VOGEL 300B120 Face.jpg')
  mk('M.E.S IA', 'VOGEL 300B120', 'Export WEB')
  touch('M.E.S IA', 'VOGEL 300B120', 'Export WEB', 'VOGEL 300B120 Face WEB.jpg')
  mk('M.E.S IA', 'VOGEL 300B120', 'Export RUNWAY')
  touch('M.E.S IA', 'VOGEL 300B120', 'Export RUNWAY', 'Ouvert.jpg')
  touch('M.E.S IA', 'VOGEL-300B140_MES-02_MP_KIT-000153.jpg')
  mk('MOODBOARD')
  touch('MOODBOARD', 'Background 1 - VOGEL.pdf')
  return root
}

const fixtureRoots: string[] = []
afterAll(() => {
  for (const r of fixtureRoots) fs.rmSync(r, { recursive: true, force: true })
})

describe('scan d’une gamme (fixture reproduisant VOGEL)', () => {
  it('trouve tailles, coloris, face, PNG, MES et moodboards — en ignorant _OLD', () => {
    const root = buildFixture()
    fixtureRoots.push(root)
    const summary = scanGamme(path.join(root, 'CASANOOV', 'PRODUITS', 'PORTAIL BATTANT', 'VOGEL'))

    expect(summary.sizes).toHaveLength(3)
    const size = summary.sizes.find((s) => s.h === 120)!
    expect(size).toMatchObject({ w: 300, h: 120 })
    expect(size.coloris).toHaveLength(2)

    const blanc = size.coloris.find((c) => c.coloris === 'BLANC')!
    expect(blanc.kitRef).toBe('KIT-000110')
    expect(blanc.faceJpg).toMatch(/FRONT-BG\.jpg$/)
    // Le _OLD n'a pas fui dans le comptage, le PNG unique du sous-dossier Png est retenu.
    expect(blanc.jpgCount).toBe(3)
    expect(blanc.facePng).toMatch(/Vent-B-J-1055.*\.png$/)

    const gris = size.coloris.find((c) => c.coloris === 'GRIS')!
    expect(gris.facePng).toBeNull() // à détourer

    // Variante « à plat » : la réf vient du dossier taille, le projet de retouche est ignoré.
    const flat = summary.sizes.find((s) => s.h === 160)!
    expect(flat.coloris).toHaveLength(1)
    expect(flat.coloris[0]).toMatchObject({
      coloris: 'non précisé',
      kitRef: 'KIT-000013',
      jpgCount: 2,
    })
    expect(flat.coloris[0].faceJpg).toMatch(/FRONT\(0\)\.jpg$/)

    // Variante VALIER : RENDU\WEB|MP|PNG, réf lue dans les noms de fichiers,
    // face WEB préférée au doublon MP, LINK exclu.
    const valier = summary.sizes.find((s) => s.w === 350)!
    expect(valier.coloris).toHaveLength(1)
    expect(valier.coloris[0]).toMatchObject({
      coloris: 'non précisé',
      kitRef: 'KIT-000814',
      jpgCount: 2,
      pngCount: 1,
    })
    expect(valier.coloris[0].faceJpg).toMatch(/WEB/)
    expect(valier.coloris[0].facePng).toMatch(/\.png$/)

    // Règle : dossiers de SORTIE seulement — RENDU (actuel) + Export (ancien),
    // « Export WEB » porte son format ; LINK, Export RUNWAY et fichiers à plat exclus.
    expect(summary.mes).toHaveLength(6)
    expect(summary.mes.filter((m) => m.format === '2000x1330')).toHaveLength(3) // RENDU\2000x1330, RENDU\WEB, Export WEB
    expect(summary.mes.filter((m) => m.format === '2000x2000')).toHaveLength(2)
    expect(summary.mes.filter((m) => m.format === 'autre')).toHaveLength(1) // Export\…Face.jpg sans token
    expect(summary.mes.some((m) => m.file.includes('LINK'))).toBe(false)
    expect(summary.mes.some((m) => m.file.includes('RUNWAY'))).toBe(false)
    expect(summary.mes.some((m) => m.file.includes('300B140'))).toBe(false) // fichier à plat exclu
    expect(summary.mes.some((m) => m.file.includes('Export WEB'))).toBe(true)
    // Chaque MES porte sa taille (lue dans le nom du fichier ou d'un dossier parent).
    expect(summary.mes.filter((m) => m.size === '300x120')).toHaveLength(6)
    expect(summary.moodboards).toHaveLength(1)
    expect(deriveStatus(summary)).toBe('detecte')
  })

  it('signale ce qu’il ne reconnaît pas au lieu d’échouer', () => {
    const root = buildFixture()
    fixtureRoots.push(root)
    const gamme = path.join(root, 'CASANOOV', 'PRODUITS', 'PORTAIL BATTANT', 'VOGEL')
    fs.mkdirSync(path.join(gamme, 'IMAGE  PRODUIT', 'DOSSIER BIZARRE'))
    const summary = scanGamme(gamme)
    expect(summary.warnings.some((w) => w.includes('DOSSIER BIZARRE'))).toBe(true)
    expect(deriveStatus(summary)).toBe('a_completer')
    // Le reste est quand même scanné.
    expect(summary.sizes).toHaveLength(3)
  })
})

describe('miniatures cachées', () => {
  it('génère une miniature WebP puis ressert le même fichier depuis le cache', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portagen-thumbs-'))
    fixtureRoots.push(dir)
    const src = path.join(dir, 'grande-image.png')
    await sharp({
      create: { width: 800, height: 500, channels: 3, background: { r: 120, g: 140, b: 120 } },
    })
      .png()
      .toFile(src)

    const thumb1 = await getCatalogThumb(src, 240)
    expect(fs.existsSync(thumb1)).toBe(true)
    const meta = await sharp(thumb1).metadata()
    expect(meta.width).toBe(240)
    expect(meta.format).toBe('webp')

    // Deuxième appel : même chemin (cache), aucun retravail.
    const thumb2 = await getCatalogThumb(src, 240)
    expect(thumb2).toBe(thumb1)

    // Le fichier source modifié → nouvelle empreinte, nouvelle miniature.
    await sharp({
      create: { width: 900, height: 500, channels: 3, background: { r: 10, g: 20, b: 30 } },
    })
      .png()
      .toFile(src)
    const thumb3 = await getCatalogThumb(src, 240)
    expect(thumb3).not.toBe(thumb1)
  })
})

describe('réglages par défaut par coloris', () => {
  it('assainit les valeurs et fait l’aller-retour en base', async () => {
    const db = getDb(':memory:')
    // Valeurs farfelues → défauts sains ('moteur' = suivre le réglage du moteur, 13/07/2026).
    expect(sanitizeColorisSettings({ decorId: -3, align: 'nimporte', alignPx: 9999 })).toEqual({
      decorId: null,
      decorXlId: null, // décor XL des coulissants ≥ 450 (22/07/2026)
      align: 'moteur',
      alignPx: 0,
      formats: { site: true, marketplace: true },
    })
    // Ancien 'auto' (posé machinalement par l'UI d'avant le moteur) → relu comme 'moteur'.
    expect(sanitizeColorisSettings({ align: 'auto' }).align).toBe('moteur')
    // alignPx borné, formats désactivables.
    expect(
      sanitizeColorisSettings({ decorId: 7, align: 'manual', alignPx: -1200, formats: { site: false } })
    ).toEqual({ decorId: 7, decorXlId: null, align: 'manual', alignPx: -500, formats: { site: false, marketplace: true } })

    // Aller-retour en base, rattaché à un produit réel (clé étrangère).
    const root = buildFixture()
    fixtureRoots.push(root)
    await runCatalogScan(db, root)
    const productId = listCatalogProducts(db)[0].id
    const saved = saveColorisSettings(productId, 'GRIS', { decorId: 7, align: 'off' }, db)
    expect(saved.align).toBe('off')
    expect(getColorisSettings(productId, 'GRIS', db)).toEqual(saved)
    // Coloris jamais réglé → défauts (le moteur décide).
    expect(getColorisSettings(productId, 'BLANC', db).align).toBe('moteur')
  })
})

describe('coloris : palette et correction manuelle', () => {
  it('reconnaît les coloris par clé ou libellé et donne une pastille', () => {
    expect(CANONICAL_COLORIS.map((c) => c.key)).toEqual(['gris', 'blanc', 'noir', 'teck'])
    expect(colorisDef('gris')?.ral).toBe('RAL 7016')
    expect(colorisDef('Noir')?.ral).toBe('RAL 9005') // insensible à la casse
    expect(colorisDef('Teck')?.label).toBe('Teck')
    expect(colorisDef('mauve')).toBeUndefined()
    expect(swatchFor('non précisé')).toBe('#9ca3af') // inconnu → gris neutre
    expect(swatchFor('GRIS ANTHRACITE')).toBe('#4a4d52')
  })

  it('enregistre une correction canonique et refuse un coloris inconnu', async () => {
    const db = getDb(':memory:')
    const root = buildFixture()
    fixtureRoots.push(root)
    await runCatalogScan(db, root)
    const productId = listCatalogProducts(db)[0].id

    // Le libellé retenu est canonique (« Noir »), quelle que soit la casse d'entrée.
    expect(saveColorisOverride(productId, 'non précisé', 'NOIR', db)).toBe('Noir')
    expect(listColorisOverrides(productId, db)).toEqual({ 'non précisé': 'Noir' })
    // Réécriture de la même clé.
    saveColorisOverride(productId, 'non précisé', 'teck', db)
    expect(listColorisOverrides(productId, db)).toEqual({ 'non précisé': 'Teck' })
    // Coloris hors palette → rejet.
    expect(() => saveColorisOverride(productId, 'non précisé', 'mauve', db)).toThrow()
  })
})

describe('scan complet → base locale', () => {
  it('upsert les pages produit, idempotent au second passage', async () => {
    const root = buildFixture()
    fixtureRoots.push(root)
    const db = getDb(':memory:')

    const report = await runCatalogScan(db, root)
    expect(report.scanned).toBe(1)
    // Les familles absentes de la fixture sont signalées, pas fatales.
    expect(report.errors.length).toBe(2)

    let products = listCatalogProducts(db)
    expect(products).toHaveLength(1)
    expect(products[0]).toMatchObject({ brand: 'CASANOOV', family: 'PORTAIL BATTANT', name: 'VOGEL' })

    await runCatalogScan(db, root)
    products = listCatalogProducts(db)
    expect(products).toHaveLength(1) // pas de doublon
  })

  it('résout le format d’une MES en LISANT ses dimensions quand le nom ne dit rien', async () => {
    const root = buildFixture()
    fixtureRoots.push(root)
    const gamme = path.join(root, 'CASANOOV', 'PRODUITS', 'PORTAIL BATTANT', 'VOGEL')
    // Une vraie image CARRÉE sans aucun token dans le nom, DANS un RENDU
    // (règle stricte) → marketplace par le ratio.
    await sharp({ create: { width: 512, height: 512, channels: 3, background: { r: 9, g: 9, b: 9 } } })
      .png()
      .toFile(path.join(gamme, 'M.E.S IA', 'VOGEL 300B120', 'RENDU', 'VOGEL 300B120 sans token.png'))
    const summary = scanGamme(gamme)
    await resolveMesFormats(gamme, summary)
    const resolved = summary.mes.find((m) => m.file.includes('sans token'))!
    expect(resolved.format).toBe('2000x2000')
    // Les fixtures texte (illisibles par sharp) restent classées par leur nom.
    expect(summary.mes.filter((m) => m.format === '2000x1330').length).toBeGreaterThan(0)
  })

  it('rescanne UN produit sans toucher au reste (bouton ↻ de la page produit)', async () => {
    const root = buildFixture()
    fixtureRoots.push(root)
    const db = getDb(':memory:')
    await runCatalogScan(db, root)
    const before = listCatalogProducts(db)[0]
    expect(JSON.parse(before.summary).sizes).toHaveLength(3)

    // Une nouvelle taille apparaît sur le serveur…
    const gamme = path.join(root, 'CASANOOV', 'PRODUITS', 'PORTAIL BATTANT', 'VOGEL')
    fs.mkdirSync(path.join(gamme, 'IMAGE  PRODUIT', 'VOGEL 400B180', 'GRIS _ KIT-000999'), {
      recursive: true,
    })
    fs.writeFileSync(
      path.join(gamme, 'IMAGE  PRODUIT', 'VOGEL 400B180', 'GRIS _ KIT-000999', '2_VOGEL400B180_FRONT-BG.jpg'),
      'x'
    )

    const after = (await rescanCatalogProduct(before.id, db))!
    expect(JSON.parse(after.summary).sizes).toHaveLength(4)
    expect(await rescanCatalogProduct(99999, db)).toBeUndefined()
  })
})
