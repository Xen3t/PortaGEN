import path from 'node:path'
import fs from 'node:fs'
import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { launchGammeJobs } from '@/lib/server/launchGamme'
import { config } from '@/lib/config'
import { parseSizeFromProductName } from '@/lib/productName'
import { moteurDef, type MoteurKey } from '@/lib/moteurs'

interface GammeItem {
  size: { w: number; h: number }
  /** Image produit à intégrer automatiquement après les piliers (chemin relatif) */
  productPath?: string
}

/**
 * Lance une gamme sur un décor : un job Piliers par taille. Si un produit est
 * fourni pour la taille, l'Intégration s'enchaîne AUTOMATIQUEMENT à la fin des
 * piliers (le runner la met en file) — l'utilisateur ne valide que l'image finale.
 * Corps : { decorPath, items: [{ size, productPath? }] } (l'ancien `sizes` reste accepté).
 */
export async function POST(req: NextRequest) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth
  const body = await req.json().catch(() => null)

  const decorRel = typeof body?.decorPath === 'string' ? body.decorPath : ''
  const decorPath = path.resolve(config.rootDir, decorRel)
  if (!decorPath.startsWith(path.resolve(config.dataDir)) || !fs.existsSync(decorPath)) {
    return NextResponse.json({ error: 'Décor introuvable' }, { status: 400 })
  }

  const isSize = (s: unknown): s is { w: number; h: number } =>
    typeof s === 'object' &&
    s !== null &&
    Number.isFinite((s as { w: unknown }).w) &&
    Number.isFinite((s as { h: unknown }).h)

  const items: GammeItem[] = Array.isArray(body?.items)
    ? body.items
        .filter((it: unknown): it is GammeItem => isSize((it as GammeItem)?.size))
        .map((it: GammeItem) => ({
          size: { w: Number(it.size.w), h: Number(it.size.h) },
          productPath: typeof it.productPath === 'string' ? it.productPath : undefined,
        }))
    : Array.isArray(body?.sizes)
      ? body.sizes.filter(isSize).map((size: { w: number; h: number }) => ({ size }))
      : []
  if (items.length === 0) {
    return NextResponse.json({ error: 'Aucune taille sélectionnée' }, { status: 400 })
  }

  // Validation des produits AVANT tout lancement : chemin autorisé + nomenclature
  // cohérente avec la taille (déformation interdite).
  for (const item of items) {
    if (!item.productPath) continue
    const abs = path.resolve(config.rootDir, item.productPath)
    if (!abs.startsWith(path.resolve(config.dataDir)) || !fs.existsSync(abs)) {
      return NextResponse.json(
        { error: `Image produit introuvable pour la taille ${item.size.w}x${item.size.h}` },
        { status: 400 }
      )
    }
    const nameSize = parseSizeFromProductName(path.basename(abs))
    if (nameSize && (nameSize.w !== item.size.w || nameSize.h !== item.size.h)) {
      return NextResponse.json(
        {
          error: `Produit incompatible : « ${path.basename(abs)} » est un ${nameSize.w}×${nameSize.h} cm, associé à la taille ${item.size.w}×${item.size.h}.`,
        },
        { status: 400 }
      )
    }
    item.productPath = abs
  }

  // Absent = le réglage du moteur décide (Admin → Réglages par moteur, 13/07/2026) ;
  // 'auto'/'off'/nombre explicites (essais Lab) gardent la priorité.
  const align: 'auto' | 'off' | number | undefined =
    body?.align === 'auto'
      ? 'auto'
      : body?.align === 'off'
        ? 'off'
        : Number.isFinite(body?.align)
          ? Number(body.align)
          : undefined
  const params = typeof body?.params === 'object' && body?.params !== null ? body.params : undefined
  // Moteur à utiliser (sélecteur du LAB, 13/07/2026). Absent ou inconnu = battant.
  const moteur: MoteurKey | undefined =
    typeof body?.moteur === 'string' && moteurDef(body.moteur)
      ? (body.moteur as MoteurKey)
      : undefined
  // Essai Lab moteur : jobs marqués (masqués de Production) + artefacts sous un slug lab-.
  const lab = body?.lab === true
  const slug = `${lab ? 'lab' : 'ui'}-${path
    .basename(decorPath)
    .replace(/\.(jpg|jpeg|png)$/i, '')
    .slice(0, 40)}`

  const { jobIds, batchId } = launchGammeJobs({
    decorPath,
    items,
    align,
    params,
    moteur,
    lab,
    slug,
    createdBy: auth.username,
  })
  return NextResponse.json({ jobIds, batchId })
}
