import path from 'node:path'
import fs from 'node:fs'
import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { getCatalogProduct, resolveCatalogFile } from '@/lib/catalogue/scan'
import { getDetourage, isGenerable } from '@/lib/catalogue/detourageStore'
import { serverPngUsable } from '@/lib/catalogue/detourageQueue'
import { moteurForFamily } from '@/lib/moteurs'
import { config } from '@/lib/config'

/**
 * Entrée « via le catalogue » de MES Contrainte (acté Mathias 07/08/2026 —
 * « comme le legacy ») : liste les visuels GÉNÉRABLES d'un produit du
 * catalogue, résolus avec la même règle que le lancement legacy (détourage
 * LOCAL validé d'abord, sinon le PNG de face du serveur s'il est utilisable).
 *
 * La page /generation/decor-autour?produit=<id> télécharge ces fichiers et
 * les fait entrer dans sa chaîne normale (détourage passe-plat sur un PNG déjà
 * transparent → RALify → description → pose) : une session comme les autres.
 * Le nom renvoyé porte taille + coloris (« ATHOS 300B140 Gris.png ») — c'est
 * lui que toute la page lit.
 */

interface ColorisNode {
  coloris: string
  facePng: string | null
}
interface SizeNode {
  w: number
  h: number
  coloris: ColorisNode[]
}

const LETTRE: Record<string, string> = { battant: 'B', coulissant: 'C', portillon: 'P' }

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = requireApiUser(req, 'admin')
  if (auth instanceof NextResponse) return auth

  const { id } = await ctx.params
  const productId = Number(id)
  const product = getCatalogProduct(productId)
  if (!product) return NextResponse.json({ error: 'Produit introuvable' }, { status: 404 })

  const moteurKey = moteurForFamily(product.family)
  const lettre = moteurKey ? LETTRE[moteurKey] : null
  if (!lettre) {
    return NextResponse.json(
      { error: 'Famille de produit sans moteur de mise en situation.' },
      { status: 400 }
    )
  }

  let summary: { sizes?: SizeNode[] }
  try {
    summary = JSON.parse(product.summary) as { sizes?: SizeNode[] }
  } catch {
    return NextResponse.json({ error: 'Résumé du produit illisible.' }, { status: 500 })
  }

  const items: { name: string; url: string; w: number; h: number; coloris: string }[] = []
  for (const s of summary.sizes ?? []) {
    for (const c of s.coloris) {
      // Même résolution que le lancement legacy : détourage local validé
      // d'abord, sinon la face du serveur si elle est une vraie face.
      let url: string | null = null
      const local = getDetourage(productId, c.coloris, `${s.w}x${s.h}`)
      if (isGenerable(local)) {
        const abs = path.resolve(config.rootDir, local!.png_path)
        if (fs.existsSync(abs)) {
          url = `/api/artifacts?p=${encodeURIComponent(local!.png_path)}`
        }
      }
      if (!url && c.facePng && serverPngUsable(c.facePng) && resolveCatalogFile(product, c.facePng)) {
        url = `/api/catalogue/${productId}/fichier?p=${encodeURIComponent(c.facePng)}`
      }
      if (!url) continue
      items.push({
        name: `${product.name} ${s.w}${lettre}${s.h} ${c.coloris}.png`,
        url,
        w: s.w,
        h: s.h,
        coloris: c.coloris,
      })
    }
  }

  return NextResponse.json({ produit: product.name, items })
}
