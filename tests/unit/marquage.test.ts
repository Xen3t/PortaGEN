import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { exiftool, type WriteTags } from 'exiftool-vendored'
import { getDb } from '@/lib/db'
import { MARQUAGE_IA_KEY, isMarquageIaActif, setSetting } from '@/lib/db/settings'
import {
  DIGITAL_SOURCE_TYPE_IA,
  fermerMarquage,
  marquerFichierIa,
  marquerImageIa,
} from '@/lib/images/marquage'

/**
 * Marquage IA des images (brief Mathias 21/07/2026) : tests en conditions
 * réelles — de vrais fichiers, le vrai exiftool — car c'est le contenu du
 * fichier produit qui compte, pas notre logique interne.
 */

let dir: string

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portagen-marquage-'))
})

afterAll(async () => {
  await fermerMarquage()
  fs.rmSync(dir, { recursive: true, force: true })
})

async function creerImage(nom: string, format: 'png' | 'jpeg' = 'png'): Promise<string> {
  const p = path.join(dir, nom)
  await sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 90, g: 146, b: 40 } },
  })
    [format]()
    .toFile(p)
  return p
}

async function lireDigitalSourceType(p: string): Promise<string | undefined> {
  const tags = (await exiftool.read(p)) as Record<string, unknown>
  return tags.DigitalSourceType as string | undefined
}

describe('marquage IPTC des images générées', () => {
  it('écrit DigitalSourceType = trainedAlgorithmicMedia sur un PNG neuf', async () => {
    const p = await creerImage('neuf.png')
    await marquerFichierIa(p)
    expect(await lireDigitalSourceType(p)).toBe(DIGITAL_SOURCE_TYPE_IA)
    // Pas de copie « _original » laissée à côté de l'artefact.
    expect(fs.existsSync(`${p}_original`)).toBe(false)
  })

  it('marque aussi les JPEG de livraison', async () => {
    const p = await creerImage('livraison.jpg', 'jpeg')
    await marquerFichierIa(p)
    expect(await lireDigitalSourceType(p)).toBe(DIGITAL_SOURCE_TYPE_IA)
  })

  it('conserve un code déjà présent (ex. compositeSynthetic) sans l’écraser', async () => {
    const p = await creerImage('deja-marque.png')
    const compositeSynthetic = 'http://cv.iptc.org/newscodes/digitalsourcetype/compositeSynthetic'
    await exiftool.write(
      p,
      { 'XMP-iptcExt:DigitalSourceType': compositeSynthetic } as unknown as WriteTags,
      { writeArgs: ['-overwrite_original'] }
    )
    await marquerFichierIa(p)
    expect(await lireDigitalSourceType(p)).toBe(compositeSynthetic)
  })

  it('est activé par défaut, coupé par « 0 », réactivable par « 1 »', () => {
    const db = getDb(':memory:')
    expect(isMarquageIaActif(db)).toBe(true)
    setSetting(MARQUAGE_IA_KEY, '0', db)
    expect(isMarquageIaActif(db)).toBe(false)
    setSetting(MARQUAGE_IA_KEY, '1', db)
    expect(isMarquageIaActif(db)).toBe(true)
  })

  it('réglage coupé → l’image sort sans métadonnée', async () => {
    const db = getDb(':memory:')
    setSetting(MARQUAGE_IA_KEY, '0', db)
    const p = await creerImage('sans-marquage.png')
    await marquerImageIa(p, db)
    expect(await lireDigitalSourceType(p)).toBeUndefined()
  })

  it('réglage actif → marquerImageIa marque le fichier', async () => {
    const db = getDb(':memory:')
    const p = await creerImage('avec-marquage.png')
    await marquerImageIa(p, db)
    expect(await lireDigitalSourceType(p)).toBe(DIGITAL_SOURCE_TYPE_IA)
  })

  it('un raté (fichier absent) ne fait pas échouer la génération', async () => {
    const db = getDb(':memory:')
    await expect(marquerImageIa(path.join(dir, 'inexistant.png'), db)).resolves.toBeUndefined()
  })
})
