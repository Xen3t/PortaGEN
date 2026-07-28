import path from 'node:path'
import fs from 'node:fs'
import sharp from 'sharp'
import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { config } from '@/lib/config'
import { getDecor } from '@/lib/db/decors'
import { createGenerationSession } from '@/lib/db/generationSessions'
import { parseProduitFromFileName } from '@/lib/productName'
import { detourProduct, hasRealTransparency } from '@/lib/images/detourage'
import { launchGammeJobs, type GammeLaunchItem } from '@/lib/server/launchGamme'
import { gabaritSetForSize } from '@/lib/gabaritSets'
import { getMoteurReglages, moteurDef, type MoteurKey } from '@/lib/moteurs'

/**
 * Génération DIRECTE, sans catalogue (page « Génération », lot 2 — 13/07/2026).
 *
 * L'utilisateur dépose une ou plusieurs images du MÊME produit (battant), avec
 * pour chacune une taille et un coloris (détectés côté client, corrigeables), et
 * un décor imposé — DEUX décors si le lot mélange tailles standards et tailles
 * XL (coulissants ≥ 450, 28/07/2026) : chaque image part avec le décor de son
 * échelle, dans le même groupe de jobs. Le serveur :
 *   1. détoure chaque image (BiRefNet) → PNG rangé dans data/generation/<batch>/,
 *   2. lance un job Piliers par image (l'Intégration s'enchaîne toute seule),
 *   via la MÊME fonction que le catalogue et /api/gamme (launchGammeJobs).
 *
 * Aucune écriture sur le serveur de fichiers (lecture seule) : tout reste en
 * local dans data/, et rien n'est rangé au catalogue — l'UI suit le batch puis
 * propose le téléchargement direct des MES Site (2000×1330).
 *
 * Lot 2 : format Site uniquement. Le Marketplace (MP) et le ↻ regénérer arrivent
 * au lot 3.
 */

interface ItemMeta {
  w: number
  h: number
  coloris: string
}

const IMAGE_RE = /\.(png|jpg|jpeg|webp)$/i

export async function POST(req: NextRequest) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth

  const form = await req.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: 'Requête invalide' }, { status: 400 })

  // Typologie choisie à l'étape 2 → moteur (absent = battant, compat lot 2).
  // Seuls les moteurs ACTIFS génèrent.
  const moteurRaw = String(form.get('moteur') ?? 'battant')
  const moteur = moteurDef(moteurRaw)
  if (!moteur || moteur.status !== 'actif') {
    return NextResponse.json({ error: 'Ce moteur n’est pas encore disponible.' }, { status: 400 })
  }
  const moteurKey: MoteurKey = moteur.key

  // Fichiers + métadonnées (une entrée meta par fichier, même ordre).
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

  // Décors imposés (28/07/2026) : un lot peut mélanger des tailles standards et
  // des tailles XL (coulissants ≥ 450) — chaque échelle exige SON décor et
  // chaque image part avec le décor de son échelle. Même règle que le catalogue :
  // un décor XL n'est jamais servi aux tailles standards, et inversement.
  const isXlWidth = (w: number) => gabaritSetForSize(moteurKey, w) === 'coulissant-xl'
  const widths = meta.map((m) => Number(m?.w)).filter((w) => Number.isFinite(w) && w > 0)
  const wantsStd = widths.some((w) => !isXlWidth(w))
  const wantsXl = widths.some((w) => isXlWidth(w))

  const resolveDecor = (id: number) => {
    const d = getDecor(id)
    if (!d || d.status !== 'actif') return null
    const p = path.resolve(config.rootDir, d.file_path)
    if (!p.startsWith(path.resolve(config.dataDir)) || !fs.existsSync(p)) return null
    return { decor: d, path: p }
  }

  let std: ReturnType<typeof resolveDecor> = null
  if (wantsStd) {
    const decorId = Number(form.get('decorId'))
    if (!Number.isInteger(decorId) || decorId <= 0) {
      return NextResponse.json({ error: 'Choisis un décor.' }, { status: 400 })
    }
    std = resolveDecor(decorId)
    if (!std) {
      return NextResponse.json({ error: 'Décor indisponible — choisis-en un autre.' }, { status: 400 })
    }
    if (std.decor.type === 'coulissant-xl') {
      return NextResponse.json(
        { error: 'Ce décor est à l’échelle XL — choisis un décor standard pour les tailles normales.' },
        { status: 400 }
      )
    }
  }
  let xl: ReturnType<typeof resolveDecor> = null
  if (wantsXl) {
    const decorXlId = Number(form.get('decorXlId'))
    if (!Number.isInteger(decorXlId) || decorXlId <= 0) {
      return NextResponse.json(
        { error: 'Le lot contient des tailles XL (≥ 450 cm) — choisis aussi un décor XL.' },
        { status: 400 }
      )
    }
    xl = resolveDecor(decorXlId)
    if (!xl) {
      return NextResponse.json({ error: 'Décor XL indisponible — choisis-en un autre.' }, { status: 400 })
    }
    if (xl.decor.type !== 'coulissant-xl') {
      return NextResponse.json(
        { error: 'Le décor choisi pour les tailles XL n’est pas un décor XL.' },
        { status: 400 }
      )
    }
  }

  // Déclinaison MP : le RÉGLAGE DU MOTEUR décide (Admin → Réglages par moteur,
  // 13/07/2026). 'toujours' = forcée, 'jamais' = interdite, 'choix' = la case
  // cochée au lancement. Le runner enchaîne alors un job Marketplace par MES.
  const reglagesMoteur = getMoteurReglages(moteurKey)
  const mpMode = reglagesMoteur.marketplace
  const autoMp =
    mpMode === 'toujours' ? true : mpMode === 'jamais' ? false : String(form.get('autoMp') ?? '') === '1'

  const batchId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const outDir = path.join(config.dataDir, 'generation', batchId)
  fs.mkdirSync(outDir, { recursive: true })

  // Deux paniers : chaque image rejoint le lancement de SON échelle.
  const items: GammeLaunchItem[] = []
  const itemsXl: GammeLaunchItem[] = []
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

    // Détourage BiRefNet (le produit n'est jamais réinventé : seul l'alpha change) —
    // SAUF, quand le moteur est en POSE-FUSION, pour un PNG DÉJÀ détouré (vraie
    // transparence) : son alpha d'origine est la référence de la méthode validée
    // le 17/07 (pré-vol du 20/07 : re-détourer un rendu fournisseur rend ses
    // piliers blancs OPAQUES → résidus collés ; l'alpha d'origine les garde en
    // fantômes que la brique pose nettoie au seuil). Les moteurs restés en
    // méthode « simple » gardent leur détourage BiRefNet HISTORIQUE, à l'identique.
    const buf = Buffer.from(await file.arrayBuffer())
    let productPng: Buffer
    if (reglagesMoteur.integrationMethod === 'pose-fusion' && (await hasRealTransparency(buf))) {
      // Alpha d'origine conservé tel quel ; normalisé en PNG (l'entrée peut être un WebP).
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

    ;(isXlWidth(w) ? itemsXl : items).push({
      size: { w, h },
      productPath: pngPath,
      extra: { coloris, format: '2000x1330' },
    })
  }

  if (items.length === 0 && itemsXl.length === 0) {
    return NextResponse.json(
      { error: 'Aucune image exploitable.', errors },
      { status: 400 }
    )
  }

  const slugFor = (filePath: string) =>
    `gen-${path.basename(filePath).replace(/\.(jpg|jpeg|png)$/i, '')}`
      .replace(/[^a-z0-9-]+/gi, '-')
      .slice(0, 40)
      .toLowerCase()

  // Un lancement par échelle, dans le MÊME groupe (batchId partagé) : l'écran de
  // suivi voit un seul lot, mais chaque image a le décor et les réglages de son
  // jeu de gabarits (l'aiguillage par taille se fait dans launchGammeJobs).
  const jobIds: number[] = []
  if (items.length > 0 && std) {
    jobIds.push(
      ...launchGammeJobs({
        decorPath: std.path,
        items,
        // align absent : la génération directe suit le réglage du moteur
        // (décision Mathias 13/07/2026 : « la génération directe se branche sur le moteur »).
        moteur: moteurKey,
        slug: slugFor(std.decor.file_path),
        createdBy: auth.username,
        batchId,
        extra: autoMp ? { autoMp: true } : undefined,
      }).jobIds
    )
  }
  if (itemsXl.length > 0 && xl) {
    jobIds.push(
      ...launchGammeJobs({
        decorPath: xl.path,
        items: itemsXl,
        moteur: moteurKey,
        slug: slugFor(xl.decor.file_path),
        createdBy: auth.username,
        batchId,
        extra: autoMp ? { autoMp: true } : undefined,
      }).jobIds
    )
  }

  // Session rouvrable depuis l'accueil (validé 13/07/2026, maquette sessions-v1).
  // Le nom du produit est détecté côté client depuis le nom de fichier, corrigeable.
  // Filet : champ vide (ou client pas à jour) → même détection côté serveur.
  let produit = String(form.get('produit') ?? '').trim().slice(0, 60)
  if (!produit) {
    for (const f of files) {
      produit = parseProduitFromFileName(f.name)
      if (produit) break
    }
  }
  createGenerationSession({
    batchId,
    produit,
    moteur: moteurKey,
    // La session retient le décor principal (standard si le lot en a un, sinon le XL).
    decorId: std?.decor.id ?? xl!.decor.id,
    createdBy: auth.username,
  })

  return NextResponse.json({ batchId, jobIds, count: items.length + itemsXl.length, errors })
}
