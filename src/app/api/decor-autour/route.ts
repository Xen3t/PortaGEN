import fs from 'node:fs'
import path from 'node:path'
import { NextRequest, NextResponse } from 'next/server'
import sharp from 'sharp'
import { requireApiUser } from '@/lib/auth/session'
import { config } from '@/lib/config'
import { construirePlanGris, promptDecorAutour, resoudreProduit, tailleProduit } from '@/lib/decorAutour'
import { generateImage, type AspectRatio, type ImageSize } from '@/lib/genai/client'

const ARTIFACT_DIR = 'decor-autour'
const ASPECTS: AspectRatio[] = ['3:2', '4:3']
const SIZES: ImageSize[] = ['1K', '2K', '4K']

/** Chemin relatif racine (ce que /api/artifacts?p= attend). */
function rel(full: string): string {
  return path.relative(config.rootDir, full)
}

/** Base de nom d'artefact sûre depuis le nom du produit + taille. */
function baseArtefact(fileName: string, w: number, h: number, stamp: string): string {
  const nom = path
    .basename(fileName)
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return `${nom || 'produit'}-${w}x${h}-${stamp}`
}

/**
 * Aperçu GRATUIT (sans Nano) : le plan gris seul, produit posé à la vraie échelle
 * PortaGEN. `?file=<chemin relatif sous data/products>`.
 */
export async function GET(req: NextRequest) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth
  const file = req.nextUrl.searchParams.get('file') ?? ''
  try {
    const produitPath = resoudreProduit(file)
    const size = tailleProduit(path.basename(produitPath))
    const plan = await construirePlanGris(produitPath, size)
    return new NextResponse(new Uint8Array(plan.buffer), {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=60' },
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    )
  }
}

/**
 * Génère UNE image par appel (le client boucle sur les images cochées). Renvoie
 * le plan gris envoyé et le rendu brut de Nano, servis ensuite via /api/artifacts.
 */
export async function POST(req: NextRequest) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth

  let body: { file?: string; description?: string; aspectRatio?: string; imageSize?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Requête invalide' }, { status: 400 })
  }

  const description = typeof body.description === 'string' ? body.description : ''
  const aspectRatio = ASPECTS.includes(body.aspectRatio as AspectRatio)
    ? (body.aspectRatio as AspectRatio)
    : '3:2'
  const imageSize = SIZES.includes(body.imageSize as ImageSize)
    ? (body.imageSize as ImageSize)
    : '2K'

  try {
    const produitPath = resoudreProduit(body.file ?? '')
    const fileName = path.basename(produitPath)
    const size = tailleProduit(fileName)

    const dir = path.join(config.artifactsDir, ARTIFACT_DIR)
    fs.mkdirSync(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const base = baseArtefact(fileName, size.w, size.h, stamp)

    // 1) Plan gris : produit posé à la vraie échelle PortaGEN.
    const plan = await construirePlanGris(produitPath, size)
    const planPath = path.join(dir, `plan-${base}.png`)
    fs.writeFileSync(planPath, plan.buffer)

    // 2) Nano peint le décor autour (client image de l'app, marquage IA + journal).
    const out = await generateImage({
      prompt: promptDecorAutour(description),
      images: [{ source: plan.buffer, mimeType: 'image/png' }],
      aspectRatio,
      imageSize,
      artifactName: `rendu-${base}`,
      artifactDir: ARTIFACT_DIR,
    })

    // 3) Recadrage exact au format de livraison — rendu BRUT, sans recollage.
    const finalPath = path.join(dir, `final-${base}.jpg`)
    await sharp(out.buffer)
      .resize(plan.planW, plan.planH, { fit: 'cover' })
      .jpeg(config.deliveryJpeg)
      .toFile(finalPath)

    return NextResponse.json({
      file: body.file,
      w: size.w,
      h: size.h,
      planPath: rel(planPath),
      resultPath: rel(finalPath),
      aspectRatio,
      imageSize,
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
