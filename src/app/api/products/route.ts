import fs from 'node:fs'
import path from 'node:path'
import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { config } from '@/lib/config'
import { parseSizeFromProductName } from '@/lib/productName'

const PRODUCTS_DIR = path.join(config.dataDir, 'products')
const IMAGE_RE = /\.(png|jpg|jpeg|webp)$/i

interface ProductEntry {
  path: string
  name: string
  group: string
  size: { w: number; h: number } | null
  mtime: number
}

/**
 * Groupe d'un produit : le sous-dossier de data/products s'il y en a un
 * (ex. « VOGEL/VOGEL 300B140.png »), sinon le début du nom de fichier avant
 * la taille (ex. « VALIER-300B140_… » → « VALIER »).
 */
function groupOf(fileName: string, subdir: string | null): string {
  if (subdir) return subdir
  const m = fileName.toUpperCase().match(/(\d{3})\s*[A-Z]\s*(\d{2,3})/)
  const prefix = m && m.index ? fileName.slice(0, m.index) : fileName.replace(IMAGE_RE, '')
  return prefix.replace(/[\s_-]+$/, '').trim() || 'Divers'
}

/**
 * Bibliothèque d'images produit (PNG détourés déposés par l'équipe), rangée en
 * gammes : un sous-dossier par gamme, une image par taille (taille lue dans le
 * nom de fichier). Les fichiers posés en vrac sont regroupés par préfixe.
 */
export async function GET(req: NextRequest) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth
  fs.mkdirSync(PRODUCTS_DIR, { recursive: true })
  const products: ProductEntry[] = []
  for (const entry of fs.readdirSync(PRODUCTS_DIR)) {
    const full = path.join(PRODUCTS_DIR, entry)
    if (fs.statSync(full).isDirectory()) {
      for (const f of fs.readdirSync(full)) {
        if (!IMAGE_RE.test(f)) continue
        const p = path.join(full, f)
        products.push({
          path: path.relative(config.rootDir, p),
          name: f.replace(IMAGE_RE, ''),
          group: groupOf(f, entry),
          size: parseSizeFromProductName(f),
          mtime: fs.statSync(p).mtimeMs,
        })
      }
    } else if (IMAGE_RE.test(entry)) {
      products.push({
        path: path.relative(config.rootDir, full),
        name: entry.replace(IMAGE_RE, ''),
        group: groupOf(entry, null),
        size: parseSizeFromProductName(entry),
        mtime: fs.statSync(full).mtimeMs,
      })
    }
  }
  products.sort((a, b) => b.mtime - a.mtime)

  const groups = [...new Set(products.map((p) => p.group))]
    .sort((a, b) => a.localeCompare(b, 'fr'))
    .map((name) => ({ name, products: products.filter((p) => p.group === name) }))

  return NextResponse.json({ products, groups })
}

/** Upload d'une image produit (multipart). */
export async function POST(req: NextRequest) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth
  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Fichier manquant' }, { status: 400 })
  }
  if (!/\.(png|jpg|jpeg|webp)$/i.test(file.name)) {
    return NextResponse.json({ error: 'Format accepté : PNG, JPG, WEBP' }, { status: 400 })
  }
  if (file.size > 40 * 1024 * 1024) {
    return NextResponse.json({ error: 'Fichier trop lourd (40 Mo max)' }, { status: 400 })
  }
  // Rangement facultatif dans une gamme (sous-dossier), ex. « VOGEL ».
  const dirRaw = typeof form?.get('dir') === 'string' ? String(form?.get('dir')) : ''
  const dir = dirRaw.replace(/[^a-zA-Z0-9._ -]/g, '').trim().slice(0, 60)
  const targetDir = dir ? path.join(PRODUCTS_DIR, dir) : PRODUCTS_DIR
  fs.mkdirSync(targetDir, { recursive: true })
  const safe = path
    .basename(file.name)
    .replace(/[^a-zA-Z0-9._ -]/g, '')
    .replace(/\s+/g, '-')
  const target = path.join(targetDir, safe)
  fs.writeFileSync(target, Buffer.from(await file.arrayBuffer()))
  return NextResponse.json({
    product: { path: path.relative(config.rootDir, target), name: safe },
  })
}

/**
 * Suppression d'un visuel produit (ADMIN) : le fichier est effacé du disque.
 * Le dossier de gamme est retiré s'il devient vide. Les MES déjà générées avec
 * ce visuel sont conservées.
 */
export async function DELETE(req: NextRequest) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth
  if (auth.role !== 'admin') {
    return NextResponse.json({ error: 'Réservé aux administrateurs' }, { status: 403 })
  }
  const body = await req.json().catch(() => null)
  const rel = typeof body?.path === 'string' ? body.path : ''
  const abs = path.resolve(config.rootDir, rel)
  // Garde-fou : uniquement des images, uniquement dans data/products
  if (!abs.startsWith(path.resolve(PRODUCTS_DIR) + path.sep) || !IMAGE_RE.test(abs)) {
    return NextResponse.json({ error: 'Chemin invalide' }, { status: 400 })
  }
  if (!fs.existsSync(abs)) {
    return NextResponse.json({ error: 'Fichier introuvable' }, { status: 404 })
  }
  fs.rmSync(abs)
  const dir = path.dirname(abs)
  if (dir !== path.resolve(PRODUCTS_DIR) && fs.readdirSync(dir).length === 0) {
    fs.rmdirSync(dir)
  }
  return NextResponse.json({ ok: true })
}
