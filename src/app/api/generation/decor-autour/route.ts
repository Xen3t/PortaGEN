import path from 'node:path'
import fs from 'node:fs'
import sharp from 'sharp'
import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { config } from '@/lib/config'
import { createGenerationSession } from '@/lib/db/generationSessions'
import { parseProduitFromFileName } from '@/lib/productName'
import { detourProduct, hasRealTransparency } from '@/lib/images/detourage'
import { launchDecorAutourJobs, type DecorAutourLaunchItem } from '@/lib/server/launchDecorAutour'
import { getMoteurDaReglages, moteurDaDef, type MoteurDaKey } from '@/lib/moteursDa'
import type { ImageSize } from '@/lib/genai/client'

/**
 * Génération « DÉCOR AUTOUR » (bascule du 05/08/2026) — COPIE COLLAPSÉE de
 * /api/generation (le legacy n'est jamais modifié) :
 *
 *  - AUCUN décor à choisir : Nano peint l'entrée autour du produit posé ;
 *  - pas d'aiguillage XL (pas de gabarits-scène) ;
 *  - qualité 2K/4K choisie au lancement (décision Mathias 05/08).
 *
 * Le serveur : 1. détoure chaque image (BiRefNet) SAUF PNG déjà détouré (règle
 * générale : un PNG à vraie transparence ne repasse JAMAIS par BiRefNet) ;
 * 2. lance un job « decor-autour » par image (launchDecorAutourJobs) ;
 * 3. crée la session (« Mes sessions », rouverte par /generation/decor-autour?session=…).
 */

interface ItemMeta {
  w: number
  h: number
  coloris: string
}

const IMAGE_RE = /\.(png|jpg|jpeg|webp)$/i
const SIZES: ImageSize[] = ['1K', '2K', '4K']

export async function POST(req: NextRequest) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth

  const form = await req.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: 'Requête invalide' }, { status: 400 })

  // Moteurs DÉCOR AUTOUR (séparation totale 05/08) : janus / terminus / forculus.
  const moteurRaw = String(form.get('moteur') ?? 'janus')
  const moteur = moteurDaDef(moteurRaw)
  if (!moteur) {
    return NextResponse.json({ error: 'Ce moteur n’est pas encore disponible.' }, { status: 400 })
  }
  const moteurKey: MoteurDaKey = moteur.key

  const imageSizeRaw = String(form.get('imageSize') ?? '2K')
  const imageSize: ImageSize = SIZES.includes(imageSizeRaw as ImageSize)
    ? (imageSizeRaw as ImageSize)
    : '2K'

  const files = form.getAll('files').filter((f): f is File => f instanceof File)
  if (files.length === 0) {
    return NextResponse.json({ error: 'Aucune image.' }, { status: 400 })
  }
  let meta: ItemMeta[]
  try {
    meta = JSON.parse(String(form.get('meta') ?? '[]'))
  } catch {
    return NextResponse.json({ error: 'Métadonnées illisibles.' }, { status: 400 })
  }
  if (!Array.isArray(meta) || meta.length !== files.length) {
    return NextResponse.json({ error: 'Métadonnées incohérentes avec les images.' }, { status: 400 })
  }

  // Déclinaison MP : même règle que le legacy — le réglage du moteur décide.
  const reglagesMoteur = getMoteurDaReglages(moteurKey)
  const mpMode = reglagesMoteur.marketplace
  const autoMp =
    mpMode === 'toujours' ? true : mpMode === 'jamais' ? false : String(form.get('autoMp') ?? '') === '1'

  const batchId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const outDir = path.join(config.dataDir, 'generation', batchId)
  fs.mkdirSync(outDir, { recursive: true })

  const items: DecorAutourLaunchItem[] = []
  const errors: { name: string; error: string }[] = []

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    const m = meta[i] ?? {}
    const w = Number(m.w)
    const h = Number(m.h)
    const coloris = typeof m.coloris === 'string' ? m.coloris : ''
    if (!IMAGE_RE.test(file.name)) {
      errors.push({ name: file.name, error: 'format non supporté (PNG, JPG, WEBP)' })
      continue
    }
    if (file.size > 40 * 1024 * 1024) {
      errors.push({ name: file.name, error: 'fichier trop lourd (40 Mo max)' })
      continue
    }
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
      errors.push({ name: file.name, error: 'taille manquante ou invalide' })
      continue
    }

    // RÈGLE générale (pré-vol 20/07) : un PNG déjà détouré (vraie transparence)
    // ne repasse JAMAIS par BiRefNet — son alpha d'origine est la référence de
    // la pose. Les autres formats sont détourés.
    const buf = Buffer.from(await file.arrayBuffer())
    let productPng: Buffer
    if (await hasRealTransparency(buf)) {
      productPng = await sharp(buf).png().toBuffer()
    } else {
      const det = await detourProduct(buf)
      if (!det.ok) {
        errors.push({ name: file.name, error: det.reason ?? 'échec du détourage' })
        continue
      }
      productPng = det.png
    }

    const safe = path
      .basename(file.name)
      .replace(IMAGE_RE, '')
      .replace(/[^a-zA-Z0-9._ -]/g, '')
      .replace(/\s+/g, '-')
      .slice(0, 60)
    const pngPath = path.join(outDir, `${i}-${safe || 'produit'}.png`)
    fs.writeFileSync(pngPath, productPng)

    items.push({
      size: { w, h },
      productPath: pngPath,
      extra: { coloris, format: '2000x1330' },
    })
  }

  if (items.length === 0) {
    return NextResponse.json({ error: 'Aucune image exploitable.', errors }, { status: 400 })
  }

  let produit = String(form.get('produit') ?? '').trim().slice(0, 60)
  if (!produit) {
    for (const f of files) {
      produit = parseProduitFromFileName(f.name)
      if (produit) break
    }
  }

  const slug = `da-${(produit || 'produit').toLowerCase()}`.replace(/[^a-z0-9-]+/gi, '-').slice(0, 40)
  const { jobIds } = launchDecorAutourJobs({
    items,
    moteur: moteurKey,
    imageSize,
    slug,
    createdBy: auth.username,
    batchId,
    extra: {
      ...(autoMp ? { autoMp: true } : {}),
      ...(produit ? { productName: produit } : {}),
    },
  })

  // Session rouvrable depuis l'accueil — pas de décor en « décor autour » (null).
  createGenerationSession({
    batchId,
    produit,
    moteur: moteurKey,
    decorId: null,
    createdBy: auth.username,
  })

  return NextResponse.json({ batchId, jobIds, count: items.length, errors })
}
