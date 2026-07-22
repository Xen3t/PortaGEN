import path from 'node:path'
import fs from 'node:fs'
import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { getCatalogProduct, resolveCatalogFile } from '@/lib/catalogue/scan'
import { enqueueNewJob } from '@/lib/server/runner'
import {
  moodboardsDir,
  sanitizeMoodboardName,
  saveMoodboard,
  MOODBOARD_EXTENSIONS,
} from '@/lib/server/moodboards'
import { pdfFirstPageToJpeg } from '@/lib/server/pdfToImage'
import { config } from '@/lib/config'
import { moteurForFamily } from '@/lib/moteurs'

/**
 * Génération d'un décor DEPUIS la page produit (bloc 3.5 — reco enquête décors,
 * 13/07/2026). On part d'un moodboard de la GAMME (sur le serveur, lecture seule).
 *
 * Comme le serveur est en lecture seule et que le pipeline range le décor + son
 * moodboard en local, on COPIE d'abord le moodboard serveur dans la bibliothèque
 * de moodboards locale (idempotent : réutilisé s'il y est déjà), puis on enfile N
 * jobs `decor` identiques à ceux de /api/decor — rattachés à la gamme pour les
 * retrouver. Le studio de décor (existant) suit ensuite les tirages côté client.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth

  const { id } = await ctx.params
  const product = getCatalogProduct(Number(id))
  if (!product) return NextResponse.json({ error: 'Produit introuvable' }, { status: 404 })

  const body = await req.json().catch(() => null)
  const moodboardRel = typeof body?.moodboard === 'string' ? body.moodboard : ''
  const count = Math.min(4, Math.max(1, Number.isFinite(Number(body?.count)) ? Number(body.count) : 3))
  if (!moodboardRel) {
    return NextResponse.json({ error: 'Moodboard requis.' }, { status: 400 })
  }
  // Décor XL (22/07/2026) : réservé aux gammes coulissantes — le décor sera typé
  // « coulissant-xl » (échelle XL : corridor 600, CANNY XL, scène élargie).
  const xl = body?.xl === true
  if (xl && moteurForFamily(product.family) !== 'coulissant') {
    return NextResponse.json(
      { error: 'Le décor XL est réservé aux gammes coulissantes.' },
      { status: 400 }
    )
  }

  // Moodboard de la gamme (serveur, lecture seule) : une IMAGE est copiée telle
  // quelle ; un PDF est CONVERTI en JPG (décision Mathias 13/07 — les moodboards
  // des gammes sont des PDF). Tout le reste est refusé.
  const ext = path.extname(moodboardRel).toLowerCase()
  const isPdf = ext === '.pdf'
  const isImage = (MOODBOARD_EXTENSIONS as readonly string[]).includes(ext)
  if (!isPdf && !isImage) {
    return NextResponse.json(
      { error: 'Moodboard non géré — attendu une image (JPG/PNG) ou un PDF.', code: 'moodboard_format' },
      { status: 400 }
    )
  }
  const serverFile = resolveCatalogFile(product, moodboardRel)
  if (!serverFile) {
    return NextResponse.json({ error: 'Moodboard introuvable dans la gamme.' }, { status: 400 })
  }

  // Copie/conversion serveur → bibliothèque de moodboards locale (idempotent).
  // Nom préfixé par la gamme pour éviter les collisions entre gammes.
  const baseName = sanitizeMoodboardName(
    `${product.name} - ${path.basename(moodboardRel, path.extname(moodboardRel))}`
  )
  const localExt = isPdf ? '.jpg' : ext
  const localTarget = path.join(moodboardsDir(), baseName + localExt)
  let moodboardLocalRel: string
  if (fs.existsSync(localTarget)) {
    moodboardLocalRel = path.relative(config.rootDir, localTarget)
  } else {
    let buffer: Buffer
    try {
      const raw = fs.readFileSync(serverFile)
      buffer = isPdf ? await pdfFirstPageToJpeg(raw, { scale: 2 }) : raw
    } catch {
      return NextResponse.json(
        { error: 'Lecture ou conversion du moodboard impossible.' },
        { status: 400 }
      )
    }
    const saved = saveMoodboard(buffer, baseName + localExt, baseName)
    if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: 400 })
    moodboardLocalRel = saved.path
  }

  const moodboardAbs = path.resolve(config.rootDir, moodboardLocalRel)
  const slug = baseName.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)
  const name =
    typeof body?.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 120) : baseName

  const jobIds = Array.from({ length: count }, (_, i) =>
    enqueueNewJob(
      'decor',
      {
        moodboardPath: moodboardAbs,
        // Décors UNIQUEMENT en 4K (décision Mathias 22/07/2026 — était 2K ici).
        imageSize: '4K',
        slug,
        gamme: product.name,
        name: xl ? `${name} · XL` : name,
        nameSuffix: count > 1 ? ` · tirage ${i + 1}` : undefined,
        moteur: xl ? 'coulissant-xl' : undefined,
      },
      undefined,
      auth.username
    )
  )
  return NextResponse.json({ jobIds })
}
