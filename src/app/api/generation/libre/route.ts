import path from 'node:path'
import fs from 'node:fs'
import sharp from 'sharp'
import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { config } from '@/lib/config'
import { listJobsByBatch } from '@/lib/db'
import { enqueueNewJob } from '@/lib/server/runner'
import type { AspectRatio, ImageSize } from '@/lib/genai/client'

/**
 * Lancement MES Libre (chantier 28/07/2026, maquette mes-libre-v11 validée) :
 * l'utilisateur dépose 1..N images du produit (envoyées TELLES QUELLES en
 * références — pas de détourage auto, le PNG propre fait main reste la règle),
 * décrit la scène via le formulaire de l'écran, et choisit variantes / ratio /
 * modèle / qualité. Un job « libre » par variante, batch partagé (suivi via
 * /api/gamme/<batch>).
 *
 * Sessions (28/07/2026) : les chemins produit sont stockés RELATIFS au projet
 * (affichables via /api/artifacts, et le lot survit à un déplacement du dossier),
 * `ui` embarque l'état complet du formulaire pour la reprise à l'écran, et
 * `reuseBatch` relance SANS re-déposer les fichiers — les images produit du lot
 * précédent sont réutilisées telles quelles.
 */

const IMAGE_RE = /\.(png|jpg|jpeg|webp)$/i

/** Ratio écran → ratio API : « site » (2000×1330) est généré en 3:2. */
const RATIOS: Record<string, AspectRatio> = {
  site: '3:2',
  '1:1': '1:1',
  '4:5': '4:5',
  '16:9': '16:9',
}

/** Nano Banana rapide imposé — 'pro' (défaut) suit le réglage Admin → Réglages. */
const FLASH_MODEL = 'gemini-3.1-flash-image'

export async function POST(req: NextRequest) {
  const auth = requireApiUser(req, 'admin')
  if (auth instanceof NextResponse) return auth

  const form = await req.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: 'Requête invalide' }, { status: 400 })

  const files = form.getAll('files').filter((f): f is File => f instanceof File)
  const reuseBatch = String(form.get('reuseBatch') ?? '').trim()
  if (files.length === 0 && !reuseBatch) {
    return NextResponse.json({ error: 'Dépose au moins une image du produit.' }, { status: 400 })
  }
  if (files.length > 6) {
    return NextResponse.json({ error: '6 images produit maximum.' }, { status: 400 })
  }

  const productLabel = String(form.get('label') ?? '').trim().slice(0, 160)
  const sceneText = String(form.get('scene') ?? '').trim().slice(0, 4000)
  const conditionsText = String(form.get('conditions') ?? '').trim().slice(0, 400)
  const cameraText = String(form.get('camera') ?? '').trim().slice(0, 400)
  const detailsText = String(form.get('details') ?? '').trim().slice(0, 600)
  if (!sceneText) {
    return NextResponse.json({ error: 'Décris la scène (le décor).' }, { status: 400 })
  }

  // État du formulaire tel qu'à l'écran — stocké tel quel pour la reprise de
  // session (l'écran le relit, le pipeline l'ignore).
  let ui: unknown
  try {
    const raw = String(form.get('ui') ?? '')
    if (raw && raw.length <= 20000) ui = JSON.parse(raw)
  } catch {
    // état illisible : la génération part quand même, la reprise sera partielle
  }

  const ratioKey = String(form.get('ratio') ?? 'site')
  const aspectRatio = RATIOS[ratioKey]
  if (!aspectRatio) return NextResponse.json({ error: 'Ratio inconnu.' }, { status: 400 })

  const modelKey = String(form.get('model') ?? 'pro')
  const model = modelKey === 'flash' ? FLASH_MODEL : undefined
  // Nano Banana rapide ne sort qu'en 1K — la qualité ne s'applique qu'au Pro.
  const qualityRaw = String(form.get('quality') ?? '2K')
  const imageSize: ImageSize =
    modelKey === 'flash' ? '1K' : ['1K', '2K', '4K'].includes(qualityRaw) ? (qualityRaw as ImageSize) : '2K'

  const count = Math.min(8, Math.max(1, Number.parseInt(String(form.get('count') ?? '3'), 10) || 3))

  const batchId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const productPaths: string[] = []

  if (files.length > 0) {
    // Images produit rangées avec le lot, normalisées en PNG (WebP accepté),
    // chemins RELATIFS au projet.
    const outDir = path.join(config.dataDir, 'generation-libre', batchId)
    fs.mkdirSync(outDir, { recursive: true })
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      if (!IMAGE_RE.test(file.name)) {
        return NextResponse.json(
          { error: `${file.name} : format non supporté (PNG, JPG, WEBP).` },
          { status: 400 }
        )
      }
      if (file.size > 40 * 1024 * 1024) {
        return NextResponse.json({ error: `${file.name} : fichier trop lourd (40 Mo max).` }, { status: 400 })
      }
      const buf = Buffer.from(await file.arrayBuffer())
      const png = await sharp(buf).png().toBuffer()
      const safe = path
        .basename(file.name)
        .replace(IMAGE_RE, '')
        .replace(/[^a-zA-Z0-9._ -]/g, '')
        .replace(/\s+/g, '-')
        .slice(0, 60)
      const p = path.join(outDir, `${i}-${safe || 'produit'}.png`)
      fs.writeFileSync(p, png)
      productPaths.push(path.relative(config.rootDir, p))
    }
  } else {
    // Reprise de session : mêmes images produit que le lot précédent.
    const previous = listJobsByBatch(reuseBatch).find(
      (j) => j.type === 'libre' && j.created_by === auth.username
    )
    if (!previous?.payload) {
      return NextResponse.json({ error: 'Lot précédent introuvable — re-dépose les images.' }, { status: 400 })
    }
    try {
      const prev = JSON.parse(previous.payload) as { productPaths?: string[] }
      for (const p of prev.productPaths ?? []) {
        const abs = path.isAbsolute(p) ? p : path.resolve(config.rootDir, p)
        if (abs.startsWith(path.resolve(config.dataDir)) && fs.existsSync(abs)) {
          productPaths.push(path.relative(config.rootDir, abs))
        }
      }
    } catch {
      // payload illisible → traité comme introuvable ci-dessous
    }
    if (productPaths.length === 0) {
      return NextResponse.json(
        { error: 'Les images du lot précédent ont disparu — re-dépose les images.' },
        { status: 400 }
      )
    }
  }

  const slug = `libre-${(productLabel || path.basename(productPaths[0]))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)}`

  const jobIds = Array.from({ length: count }, (_, i) =>
    enqueueNewJob(
      'libre',
      {
        productPaths,
        productLabel,
        sceneText,
        conditionsText,
        cameraText,
        detailsText: detailsText || undefined,
        aspectRatio,
        imageSize,
        model,
        slug,
        variante: i + 1,
        ui,
      },
      batchId,
      auth.username
    )
  )

  return NextResponse.json({ batchId, jobIds })
}
