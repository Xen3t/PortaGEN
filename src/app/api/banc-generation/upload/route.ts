import path from 'node:path'
import fs from 'node:fs'
import sharp from 'sharp'
import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { config } from '@/lib/config'
import { BANC_LOT_RE, bancLotDir } from '@/lib/banc'
import {
  createGenerationSession,
  getGenerationSession,
} from '@/lib/db/generationSessions'
import { detourProduct, hasRealTransparency } from '@/lib/images/detourage'
import { moteurDaDef } from '@/lib/moteursDa'
import { parseProduitFromFileName } from '@/lib/productName'

/**
 * BANC « génération & resizing » — étape 1/3 : DÉTOURAGE (demande Mathias
 * 07/08 : la case affiche la VRAIE étape en cours, donc le dépôt est découpé en
 * trois requêtes enchaînées par le client — /upload (détourage) → /ralify →
 * /pose). Cette route enregistre UNE image : détourée par BiRefNet, sauf PNG à
 * vraie transparence (règle générale du 20/07 : jamais re-détouré).
 *
 * Le lot (?lot=… côté page) est créé ici au premier dépôt ; le manifeste, lui,
 * n'est écrit qu'à la fin de la chaîne (étape /pose) — une image interrompue en
 * cours de préparation ne revient pas au reload.
 */

const IMAGE_RE = /\.(png|jpg|jpeg|webp)$/i

function rel(full: string): string {
  return path.relative(config.rootDir, full)
}

export async function POST(req: NextRequest) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth

  const form = await req.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: 'Requête invalide' }, { status: 400 })

  const moteur = moteurDaDef(String(form.get('moteur') ?? 'janus'))
  if (!moteur) {
    return NextResponse.json({ error: 'Ce moteur n’est pas encore disponible.' }, { status: 400 })
  }

  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Aucune image.' }, { status: 400 })
  }

  const lotRaw = String(form.get('lot') ?? '')
  const lotId = BANC_LOT_RE.test(lotRaw)
    ? lotRaw
    : `banc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

  try {
    if (!IMAGE_RE.test(file.name)) throw new Error('format non supporté (PNG, JPG, WEBP)')
    if (file.size > 40 * 1024 * 1024) throw new Error('fichier trop lourd (40 Mo max)')

    // RÈGLE générale (pré-vol 20/07) : un PNG déjà détouré (vraie transparence)
    // ne repasse JAMAIS par BiRefNet.
    const buf = Buffer.from(await file.arrayBuffer())
    let productPng: Buffer
    if (await hasRealTransparency(buf)) {
      productPng = await sharp(buf).png().toBuffer()
    } else {
      const det = await detourProduct(buf)
      if (!det.ok) throw new Error(det.reason ?? 'échec du détourage')
      productPng = det.png
    }

    const safe = path
      .basename(file.name)
      .replace(IMAGE_RE, '')
      .replace(/[^a-zA-Z0-9._ -]/g, '')
      .replace(/\s+/g, '-')
      .slice(0, 60)
    // Préfixe unique : un même nom redéposé ne doit pas écraser le précédent.
    const uid = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    const outDir = bancLotDir(lotId)
    fs.mkdirSync(outDir, { recursive: true })
    // Fichier ORIGINEL conservé tel quel (avant détourage) — vue de contrôle
    // demandée le 07/08 : originel / détouré / RALify, chaque état inspectable.
    const ext = (file.name.match(/\.[a-z0-9]+$/i)?.[0] ?? '.png').toLowerCase()
    const originalPath = path.join(outDir, `${uid}-${safe || 'produit'}-original${ext}`)
    fs.writeFileSync(originalPath, buf)
    const pngPath = path.join(outDir, `${uid}-${safe || 'produit'}.png`)
    fs.writeFileSync(pngPath, productPng)

    // ESPRIT SESSION (demande Mathias 07/08) : le dépôt lui-même crée la
    // session — le lot se retrouve sur l'Accueil même sans lancement, on peut
    // fermer l'onglet et revenir par la carte.
    if (!getGenerationSession(lotId)) {
      createGenerationSession({
        batchId: lotId,
        produit: parseProduitFromFileName(file.name) || moteur.key,
        moteur: moteur.key,
        decorId: null,
        createdBy: auth.username,
      })
    }

    return NextResponse.json({ lotId, productPath: rel(pngPath), originalPath: rel(originalPath) })
  } catch (err) {
    return NextResponse.json(
      { lotId, error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    )
  }
}
