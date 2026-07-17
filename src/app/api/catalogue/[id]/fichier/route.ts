import fs from 'node:fs'
import path from 'node:path'
import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { getCatalogProduct, resolveCatalogFile } from '@/lib/catalogue/scan'
import { getCatalogThumb } from '@/lib/catalogue/thumbs'

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
}

const THUMBABLE = new Set(['.png', '.jpg', '.jpeg', '.webp'])

/**
 * Sert un fichier du serveur d'entreprise à l'interface — LECTURE SEULE,
 * chemin borné au dossier de la gamme (aucune traversée possible).
 * `?w=240` : sert une MINIATURE WebP générée et cachée en local (les
 * originaux pèsent plusieurs Mo, l'interface affiche des vignettes).
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth
  const { id } = await ctx.params
  const product = getCatalogProduct(Number(id))
  if (!product) return NextResponse.json({ error: 'Produit introuvable' }, { status: 404 })
  const rel = req.nextUrl.searchParams.get('p') ?? ''
  const full = resolveCatalogFile(product, rel)
  if (!full) return NextResponse.json({ error: 'Fichier introuvable' }, { status: 404 })
  const ext = path.extname(full).toLowerCase()
  const type = MIME[ext]
  if (!type) return NextResponse.json({ error: 'Type de fichier non servi' }, { status: 415 })

  const wParam = Number(req.nextUrl.searchParams.get('w'))
  if (Number.isFinite(wParam) && wParam > 0 && THUMBABLE.has(ext)) {
    try {
      const thumb = await getCatalogThumb(full, wParam)
      // Le nom de la miniature EST son empreinte (chemin+mtime+taille+largeur) :
      // ETag parfait — le navigateur revalide en 304 sans re-télécharger.
      const etag = `"${path.basename(thumb, '.webp')}"`
      if (req.headers.get('if-none-match') === etag) {
        return new NextResponse(null, { status: 304, headers: { ETag: etag } })
      }
      return new NextResponse(new Uint8Array(fs.readFileSync(thumb)), {
        headers: {
          'Content-Type': 'image/webp',
          'Cache-Control': 'private, max-age=86400',
          ETag: etag,
        },
      })
    } catch {
      // Image illisible par sharp : on retombe sur l'original.
    }
  }

  const body = new Uint8Array(fs.readFileSync(full))
  return new NextResponse(body, {
    headers: { 'Content-Type': type, 'Cache-Control': 'private, max-age=3600' },
  })
}
