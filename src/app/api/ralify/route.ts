import fs from 'node:fs'
import path from 'node:path'
import { NextRequest, NextResponse } from 'next/server'
import sharp from 'sharp'
import { requireApiUser } from '@/lib/auth/session'
import { config } from '@/lib/config'
import { getDb } from '@/lib/db'
import { getCatalogProduct, resolveCatalogFile, type CatalogProductRow } from '@/lib/catalogue/scan'
import { getDetourage, isGenerable } from '@/lib/catalogue/detourageStore'
import { serverPngUsable } from '@/lib/catalogue/detourageQueue'
import { detectColoris } from '@/lib/images/coloris'
import { appliquerRalify } from '@/lib/images/ralify'
import { prepareProduct } from '@/lib/images/product'
import { moteurForFamily, type MoteurKey } from '@/lib/moteurs'
import { resolveRalifyDecision, sanitizeRalify } from '@/lib/ralify'

/**
 * « Tester sur un produit » de l'encart RALify (maquette ralify-v2, 28/07/2026) :
 * essaie les réglages — MÊME NON ENREGISTRÉS, l'encart envoie sa config — sur un
 * PNG produit du catalogue, sans lancer de génération ni toucher au fichier.
 *
 * Le PNG vient des MÊMES sources que la génération réelle (route catalogue/generer) :
 * détourage LOCAL validé/importé s'il existe, sinon PNG de face du SERVEUR
 * (lecture seule). Il est préparé comme dans le pipeline (prepareProduct, piliers
 * fournisseur retirés) AVANT le traitement — l'aperçu montre ce que RALify ferait
 * réellement.
 *
 * GET  ?moteur=battant → une entrée testable par (produit, coloris) du moteur.
 * POST { productId, coloris, size, ralify } → avant/après (data URLs) + cible.
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

/** Chemin ABSOLU du PNG produit d'une référence — même priorité que la génération. */
function resolveProductPng(
  product: CatalogProductRow,
  coloris: string,
  size: { w: number; h: number }
): string | null {
  const local = getDetourage(product.id, coloris, `${size.w}x${size.h}`)
  if (isGenerable(local)) {
    const abs = path.resolve(config.rootDir, local!.png_path)
    if (fs.existsSync(abs)) return abs
  }
  try {
    const summary = JSON.parse(product.summary) as { sizes: SizeNode[] }
    const node = summary.sizes
      .find((s) => s.w === size.w && s.h === size.h)
      ?.coloris.find((c) => c.coloris === coloris)
    if (node?.facePng && serverPngUsable(node.facePng)) {
      return resolveCatalogFile(product, node.facePng)
    }
  } catch {
    // résumé illisible → pas de source pour cette référence
  }
  return null
}

export async function GET(req: NextRequest) {
  const auth = requireApiUser(req, 'admin')
  if (auth instanceof NextResponse) return auth
  const moteur = (req.nextUrl.searchParams.get('moteur') ?? 'battant') as MoteurKey
  const rows = getDb()
    .prepare('SELECT * FROM catalog_products ORDER BY name')
    .all() as CatalogProductRow[]

  // Serveur de fichiers coupé (O:\ non monté, VPN…) : on le détecte UNE fois par
  // racine — sinon des centaines d'existsSync sur un lecteur mort, chacun avec
  // son délai réseau, gèleraient la requête.
  const racines = new Map<string, boolean>()
  const racineOk = (serverPath: string) => {
    const root = path.parse(path.resolve(serverPath)).root
    if (!racines.has(root)) racines.set(root, fs.existsSync(root))
    return racines.get(root)!
  }

  // Une entrée par (produit, coloris) : pour juger la couleur, une taille suffit —
  // on prend la première référence dont le PNG existe vraiment.
  const produits: {
    productId: number
    produit: string
    coloris: string
    size: { w: number; h: number }
  }[] = []
  let serveurOk = true
  for (const p of rows) {
    if (moteurForFamily(p.family) !== moteur) continue
    if (!racineOk(p.server_path)) {
      serveurOk = false
      continue
    }
    let summary: { sizes: SizeNode[] }
    try {
      summary = JSON.parse(p.summary) as { sizes: SizeNode[] }
    } catch {
      continue
    }
    const vus = new Set<string>()
    for (const s of summary.sizes) {
      for (const c of s.coloris) {
        if (vus.has(c.coloris)) continue
        if (resolveProductPng(p, c.coloris, s)) {
          vus.add(c.coloris)
          produits.push({
            productId: p.id,
            produit: p.name,
            coloris: c.coloris,
            size: { w: s.w, h: s.h },
          })
        }
      }
    }
  }
  // Modèle de détection du RALify « après génération » (affiché par l'encart,
  // demande Mathias 17/08) : celui des appels texte de l'app.
  return NextResponse.json({ produits, serveurOk, modeleDetection: config.textModel })
}

// Aperçu large : la zone de contrôle de l'encart est un comparateur plein cadre
// (demande Mathias 28/07 : « quand je m'en sers, faut qu'elle prenne de la place »).
const apercu = (buf: Buffer) =>
  sharp(buf)
    .resize({ width: 1200, withoutEnlargement: true })
    .png()
    .toBuffer()
    .then((b) => `data:image/png;base64,${b.toString('base64')}`)

/**
 * Traite et répond : décision résolue depuis les règles (actif forcé — le test
 * montre ce que les RÈGLES feraient, l'interrupteur ne vaut que pour les
 * générations), avant/après en data URL + toutes les infos de validation
 * (règle appliquée, moyennes de matière, pixels traités, dimensions).
 */
async function reponseTest(
  image: Buffer,
  ralify: NonNullable<ReturnType<typeof sanitizeRalify>>,
  produit: string,
  nomPourExceptions: string,
  coloris: string | null
) {
  const decision = resolveRalifyDecision({ ...ralify, actif: true }, nomPourExceptions, coloris)
  const meta = await sharp(image).metadata()
  const base = {
    produit,
    coloris,
    raison: decision.raison,
    intensite: ralify.intensite,
    largeur: meta.width ?? null,
    hauteur: meta.height ?? null,
  }
  const avant = await apercu(image)
  if (!decision.cible) {
    return NextResponse.json({ ...base, cible: null, avant, apres: null })
  }
  const traite = await appliquerRalify(image, decision.cible, ralify.intensite)
  return NextResponse.json({
    ...base,
    cible: decision.cible,
    avantHex: traite.avantHex,
    apresHex: traite.apresHex,
    pixelsTraites: traite.pixelsTraites,
    pixelsProteges: traite.pixelsProteges,
    avant,
    apres: await apercu(traite.image),
  })
}

export async function POST(req: NextRequest) {
  const auth = requireApiUser(req, 'admin')
  if (auth instanceof NextResponse) return auth

  // Variante « donner une image » (multipart) — AUCUN besoin du serveur de
  // fichiers : même logique que la génération directe, coloris détecté depuis
  // l'image, nom du fichier pour les exceptions.
  if ((req.headers.get('content-type') ?? '').includes('multipart/form-data')) {
    const form = await req.formData().catch(() => null)
    const file = form?.get('file')
    const ralify = sanitizeRalify(
      (() => {
        try {
          return JSON.parse(String(form?.get('ralify') ?? ''))
        } catch {
          return null
        }
      })()
    )
    if (!(file instanceof File) || !ralify) {
      return NextResponse.json({ error: 'Requête invalide' }, { status: 400 })
    }
    if (file.size > 40 * 1024 * 1024) {
      return NextResponse.json({ error: 'Fichier trop lourd (40 Mo max)' }, { status: 400 })
    }
    const buf = Buffer.from(await file.arrayBuffer())
    let image: Buffer
    try {
      image = (await prepareProduct(buf, { removePillars: true })).image
    } catch {
      image = buf
    }
    const detection = await detectColoris(image).catch(() => null)
    return reponseTest(image, ralify, file.name, file.name, detection?.coloris ?? null)
  }

  const body = await req.json().catch(() => null)
  const productId = Number(body?.productId)
  const coloris = typeof body?.coloris === 'string' ? body.coloris : ''
  const w = Number(body?.size?.w)
  const h = Number(body?.size?.h)
  const ralify = sanitizeRalify(body?.ralify)
  if (!Number.isFinite(productId) || !coloris || !Number.isFinite(w) || !Number.isFinite(h) || !ralify) {
    return NextResponse.json({ error: 'Requête invalide' }, { status: 400 })
  }
  const product = getCatalogProduct(productId)
  if (!product) return NextResponse.json({ error: 'Produit introuvable' }, { status: 404 })
  const pngPath = resolveProductPng(product, coloris, { w, h })
  if (!pngPath) {
    return NextResponse.json({ error: 'PNG produit introuvable pour cette référence' }, { status: 404 })
  }

  // Même préparation que le pipeline (piliers fournisseur retirés) — sinon un
  // visuel aux piliers opaques verrait ses piliers recolorés dans l'aperçu.
  let image: Buffer
  try {
    image = (await prepareProduct(pngPath, { removePillars: true, expectedSize: { w, h } })).image
  } catch {
    image = fs.readFileSync(pngPath)
  }
  return reponseTest(image, ralify, product.name, `${product.name} ${path.basename(pngPath)}`, coloris)
}
