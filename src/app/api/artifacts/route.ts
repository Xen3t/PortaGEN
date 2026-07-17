import fs from 'node:fs'
import path from 'node:path'
import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { resolveServedFile } from '@/lib/server/catalog'
import { getCatalogThumb } from '@/lib/catalogue/thumbs'

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json',
}

const THUMBABLE = new Set(['.png', '.jpg', '.jpeg', '.webp'])

/** Sert les artefacts (data/) et assets (Assets/) à l'interface, chemins contrôlés. */
export async function GET(req: NextRequest) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth
  const rel = req.nextUrl.searchParams.get('p') ?? ''
  const full = resolveServedFile(rel)
  if (!full) return NextResponse.json({ error: 'Fichier introuvable' }, { status: 404 })
  const ext = path.extname(full).toLowerCase()
  const type = MIME[ext] ?? 'application/octet-stream'

  // `?w=240` : sert une MINIATURE WebP (les images générées pèsent 2 à 4 Mo mais
  // l'interface les affiche en vignettes). Même cache local que le catalogue :
  // la miniature est fabriquée UNE fois puis relue depuis data/cache. Décor 12/07.
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
          // Une miniature ne change jamais (empreinte dans son nom) → cache long.
          'Cache-Control': 'private, max-age=604800, immutable',
          ETag: etag,
        },
      })
    } catch {
      // Image illisible par sharp : on retombe sur l'original.
    }
  }

  // Original en pleine résolution (zoom, téléchargement). Les artefacts sont
  // immuables (nom horodaté unique) : ETag sur mtime+taille + cache long → un
  // retour en arrière ne re-télécharge rien (revalidation 304 sinon).
  const st = fs.statSync(full)
  const etag = `"${st.mtimeMs}-${st.size}"`
  if (req.headers.get('if-none-match') === etag) {
    return new NextResponse(null, { status: 304, headers: { ETag: etag } })
  }
  const body = new Uint8Array(fs.readFileSync(full))
  return new NextResponse(body, {
    headers: {
      'Content-Type': type,
      'Cache-Control': 'private, max-age=86400',
      ETag: etag,
    },
  })
}
