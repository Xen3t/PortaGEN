import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { getCatalogProduct, resolveCatalogFile } from '@/lib/catalogue/scan'
import { pdfFirstPageToJpeg } from '@/lib/server/pdfToImage'
import { config } from '@/lib/config'

/**
 * Aperçu (vignette JPEG) d'un moodboard de la gamme, pour le picker « Générer un
 * décor » (bloc 3.5). Les moodboards des gammes sont des PDF que la route
 * `fichier` sert bruts — ici on rend la 1re page en image (MuPDF), redimensionnée
 * et CACHÉE en local pour ne convertir qu'une fois. Les moodboards déjà images
 * sont simplement redimensionnés. Lecture seule côté serveur.
 */
const CACHE_DIR = path.join(config.dataDir, 'cache', 'moodboard-preview')

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = requireApiUser(req, 'admin')
  if (auth instanceof NextResponse) return auth
  const { id } = await ctx.params
  const product = getCatalogProduct(Number(id))
  if (!product) return NextResponse.json({ error: 'Produit introuvable' }, { status: 404 })

  const rel = req.nextUrl.searchParams.get('p') ?? ''
  const w = Math.min(1200, Math.max(80, Number(req.nextUrl.searchParams.get('w')) || 320))
  const file = resolveCatalogFile(product, rel)
  if (!file) return NextResponse.json({ error: 'Moodboard introuvable' }, { status: 404 })
  const ext = path.extname(file).toLowerCase()

  try {
    let jpeg: Buffer
    if (ext === '.pdf') {
      const stat = fs.statSync(file)
      const key = crypto
        .createHash('sha1')
        .update(`${id}|${rel}|${w}|${stat.mtimeMs}|${stat.size}`)
        .digest('hex')
      const cached = path.join(CACHE_DIR, key + '.jpg')
      if (fs.existsSync(cached)) {
        jpeg = fs.readFileSync(cached)
      } else {
        jpeg = await pdfFirstPageToJpeg(fs.readFileSync(file), { scale: 1.5, width: w, quality: 78 })
        fs.mkdirSync(CACHE_DIR, { recursive: true })
        fs.writeFileSync(cached, jpeg)
      }
    } else {
      jpeg = await sharp(file).resize({ width: w, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer()
    }
    return new NextResponse(new Uint8Array(jpeg), {
      headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400' },
    })
  } catch {
    return NextResponse.json({ error: 'Aperçu indisponible' }, { status: 500 })
  }
}
