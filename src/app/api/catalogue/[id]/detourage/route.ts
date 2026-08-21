import path from 'node:path'
import fs from 'node:fs'
import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { getCatalogProduct, resolveCatalogFile } from '@/lib/catalogue/scan'
import { classifyView, isUsableFace } from '@/lib/catalogue/parse'
import { detourProduct } from '@/lib/images/detourage'
import {
  detourageDir,
  detouragePngRel,
  setDetourageStatus,
  upsertDetourage,
} from '@/lib/catalogue/detourageStore'
import { buildDetourageQueue } from '@/lib/catalogue/detourageQueue'
import { config } from '@/lib/config'

/**
 * Détourage d'une page produit (chantier 2). Le serveur résout tout depuis le
 * résumé du scan (jamais de chemin envoyé par le client). PNG stockés en LOCAL.
 *  GET  → la file (références à détourer + état).
 *  POST → { action: 'run' | 'valider' | 'ignorer', coloris, size } (JSON)
 *         ou import d'un PNG (multipart : png, coloris, size).
 */

interface ColorisNode {
  coloris: string
  faceJpg: string | null
}
interface SizeNode {
  w: number
  h: number
  coloris: ColorisNode[]
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = requireApiUser(req, 'admin')
  if (auth instanceof NextResponse) return auth
  const { id } = await ctx.params
  const product = getCatalogProduct(Number(id))
  if (!product) return NextResponse.json({ error: 'Produit introuvable' }, { status: 404 })
  return NextResponse.json({ queue: buildDetourageQueue(product) })
}

function findSource(product: ReturnType<typeof getCatalogProduct>, coloris: string, size: string) {
  const summary = JSON.parse(product!.summary) as { sizes: SizeNode[] }
  const sizeNode = summary.sizes.find((s) => `${s.w}x${s.h}` === size)
  const col = sizeNode?.coloris.find((c) => c.coloris === coloris)
  return col?.faceJpg ?? null
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = requireApiUser(req, 'admin')
  if (auth instanceof NextResponse) return auth
  const { id } = await ctx.params
  const productId = Number(id)
  const product = getCatalogProduct(productId)
  if (!product) return NextResponse.json({ error: 'Produit introuvable' }, { status: 404 })

  const ctype = req.headers.get('content-type') ?? ''

  // ---- Import d'un PNG fourni par l'utilisateur (multipart) ----
  if (ctype.includes('multipart/form-data')) {
    const form = await req.formData()
    const coloris = String(form.get('coloris') ?? '')
    const size = String(form.get('size') ?? '')
    const file = form.get('png')
    if (!coloris || !size || !(file instanceof File)) {
      return NextResponse.json({ error: 'Import incomplet' }, { status: 400 })
    }
    if (!/\.png$/i.test(file.name) && file.type !== 'image/png') {
      return NextResponse.json({ error: 'Le fichier doit être un PNG (fond transparent).' }, { status: 400 })
    }
    const buf = Buffer.from(await file.arrayBuffer())
    const rel = detouragePngRel(productId, coloris, size)
    fs.mkdirSync(detourageDir(productId), { recursive: true })
    fs.writeFileSync(path.resolve(config.rootDir, rel), buf)
    const row = upsertDetourage({
      productId,
      coloris,
      sizeLabel: size,
      sourceRel: null,
      pngPath: rel,
      status: 'importe',
    })
    return NextResponse.json({ ok: true, row })
  }

  // ---- Actions JSON ----
  const body = await req.json().catch(() => null)
  const action = body?.action
  const coloris = typeof body?.coloris === 'string' ? body.coloris : ''
  const size = typeof body?.size === 'string' ? body.size : ''
  if (!coloris || !size) return NextResponse.json({ error: 'Requête incomplète' }, { status: 400 })

  if (action === 'valider') {
    const row = setDetourageStatus(productId, coloris, size, 'valide')
    if (!row) return NextResponse.json({ error: 'Aucun détourage à valider' }, { status: 400 })
    return NextResponse.json({ ok: true, row })
  }

  if (action === 'ignorer') {
    const row = upsertDetourage({
      productId,
      coloris,
      sizeLabel: size,
      sourceRel: findSource(product, coloris, size),
      pngPath: '',
      status: 'ignore',
    })
    return NextResponse.json({ ok: true, row })
  }

  if (action === 'run') {
    const sourceRel = findSource(product, coloris, size)
    if (!sourceRel) {
      return NextResponse.json(
        { ok: false, code: 'aucune_source', error: 'Aucune photo de face — importe ton PNG.' },
        { status: 200 }
      )
    }
    const kind = classifyView(path.basename(sourceRel))
    if (!isUsableFace(kind)) {
      return NextResponse.json(
        { ok: false, code: 'vue_non_face', kind, error: 'Vue inutilisable de face — importe ton PNG.' },
        { status: 200 }
      )
    }
    const abs = resolveCatalogFile(product, sourceRel)
    if (!abs) return NextResponse.json({ error: 'Source introuvable sur le serveur' }, { status: 400 })

    const res = await detourProduct(abs)
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, code: 'fond_non_exploitable', reason: res.reason, error: 'Fond non exploitable — importe ton PNG.' },
        { status: 200 }
      )
    }
    const rel = detouragePngRel(productId, coloris, size)
    fs.mkdirSync(detourageDir(productId), { recursive: true })
    fs.writeFileSync(path.resolve(config.rootDir, rel), res.png)
    const row = upsertDetourage({
      productId,
      coloris,
      sizeLabel: size,
      sourceRel,
      pngPath: rel,
      status: 'a_valider',
    })
    return NextResponse.json({ ok: true, row, kind, width: res.width, height: res.height })
  }

  return NextResponse.json({ error: 'Action inconnue' }, { status: 400 })
}
