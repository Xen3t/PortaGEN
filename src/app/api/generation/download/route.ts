import fs from 'node:fs'
import { NextRequest, NextResponse } from 'next/server'
import { zipSync, type Zippable } from 'fflate'
import { requireApiUser } from '@/lib/auth/session'
import { resolveServedFile } from '@/lib/server/catalog'

/**
 * Téléchargement groupé depuis la page « Génération » (demande Mathias 13/07/2026) :
 * un ZIP avec les MES Site dans un dossier WEB/ et les MES Marketplace dans MP/.
 * Le client envoie la liste (chemins de livraison + noms de fichiers) — selon le
 * bouton, il envoie tout, seulement les Site, ou seulement les MP.
 *
 * Corps : { items: [{ p: string, name: string, folder: 'WEB' | 'MP' }] }
 * Les JPEG sont déjà compressés → ZIP en « stockage » (level 0), instantané.
 */

const MAX_ITEMS = 200

export async function POST(req: NextRequest) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => null)
  const items: { p?: unknown; name?: unknown; folder?: unknown }[] = Array.isArray(body?.items)
    ? body.items.slice(0, MAX_ITEMS)
    : []
  if (items.length === 0) {
    return NextResponse.json({ error: 'Aucun fichier à télécharger.' }, { status: 400 })
  }

  const entries: Zippable = {}
  const missing: string[] = []
  for (const it of items) {
    if (typeof it.p !== 'string' || (it.folder !== 'WEB' && it.folder !== 'MP')) continue
    const full = resolveServedFile(it.p)
    if (!full) {
      missing.push(it.p)
      continue
    }
    // Nom fourni par l'UI (battant_gris_300B140_site.jpg…) — nettoyé par prudence.
    const base =
      typeof it.name === 'string' && it.name.trim()
        ? it.name.replace(/[^\w.\- ]+/g, '_').slice(0, 120)
        : 'image.jpg'
    // Collision (même coloris + même taille) → suffixe -2, -3…
    let key = `${it.folder}/${base}`
    for (let n = 2; key in entries; n++) {
      key = `${it.folder}/${base.replace(/(\.\w+)?$/, (ext) => `-${n}${ext}`)}`
    }
    entries[key] = [new Uint8Array(fs.readFileSync(full)), { level: 0 }]
  }

  if (Object.keys(entries).length === 0) {
    return NextResponse.json(
      { error: 'Aucun fichier trouvé sur le serveur.', missing },
      { status: 404 }
    )
  }

  const zipped = zipSync(entries)
  return new NextResponse(new Uint8Array(zipped), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="MES.zip"',
      'Cache-Control': 'no-store',
    },
  })
}
