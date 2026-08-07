import path from 'node:path'
import fs from 'node:fs'
import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { config } from '@/lib/config'
import { BANC_LOT_RE, bancLotDir, bancPlanDir, ecrireBancManifest, lireBancManifest } from '@/lib/banc'

/**
 * BANC « génération & resizing » — relecture d'un lot après rechargement de la
 * page (?lot=… dans l'URL). Renvoie le manifeste : moteur, produit et les
 * images préparées (plans gris compris). Les jobs éventuels se relisent à côté
 * via /api/gamme/<lotId> (le lot sert aussi de batchId).
 */
export async function GET(req: NextRequest) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth
  const id = req.nextUrl.searchParams.get('id') ?? ''
  if (!BANC_LOT_RE.test(id)) {
    return NextResponse.json({ error: 'Identifiant de lot invalide' }, { status: 400 })
  }
  const manifest = lireBancManifest(id)
  if (!manifest) return NextResponse.json({ error: 'Lot introuvable' }, { status: 404 })
  return NextResponse.json(manifest)
}

/**
 * CHOIX DE VERSION (retour arrière, 07/08) : épingle — ou désépingle — la
 * version affichée par une case. Corps : { id, p: productPath,
 * chosenJobId: number | null } ; null = suivre la dernière version prête.
 * RENOMMAGE (08/08) : { id, produit } — met le nom de session du manifeste en
 * phase avec la ligne generation_sessions (renommée par sa propre route).
 */
export async function PATCH(req: NextRequest) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth
  const body = await req.json().catch(() => null)
  const id = typeof body?.id === 'string' ? body.id : ''
  if (!BANC_LOT_RE.test(id)) {
    return NextResponse.json({ error: 'Requête invalide' }, { status: 400 })
  }
  const manifest = lireBancManifest(id)
  if (!manifest) return NextResponse.json({ error: 'Lot introuvable' }, { status: 404 })

  // Renommage du lot (nom de session).
  if (typeof body?.produit === 'string') {
    const produit = body.produit.trim().slice(0, 60)
    if (!produit) return NextResponse.json({ error: 'Nom de session vide' }, { status: 400 })
    manifest.produit = produit
    ecrireBancManifest(id, manifest)
    return NextResponse.json({ ok: true })
  }

  const p = typeof body?.p === 'string' ? body.p : ''
  const chosen = body?.chosenJobId
  if (!p || (chosen !== null && !Number.isInteger(chosen))) {
    return NextResponse.json({ error: 'Requête invalide' }, { status: 400 })
  }
  const item = manifest.items.find((i) => i.productPath === p)
  if (!item) return NextResponse.json({ error: 'Image absente du lot' }, { status: 404 })
  if (chosen === null) delete item.chosenJobId
  else item.chosenJobId = chosen
  ecrireBancManifest(id, manifest)
  return NextResponse.json({ ok: true })
}

/** Efface `full` s'il vit bien sous `dir` (garde anti-évasion) et existe. */
function effacerSous(dir: string, relPath: string | undefined): void {
  if (!relPath) return
  const full = path.resolve(config.rootDir, relPath)
  if (!full.startsWith(dir + path.sep)) return
  try {
    if (fs.existsSync(full)) fs.unlinkSync(full)
  } catch {
    // fichier verrouillé : le manifeste fait foi, le fichier orphelin est bénin
  }
}

/**
 * SUPPRESSION d'une image du lot (croix ✕ de la case, 07/08) : l'entrée sort du
 * MANIFESTE — sans ça elle « revenait » au rechargement — et ses fichiers (PNG
 * produit, RALify, plans) sont effacés. `?id=<lot>&p=<productPath>`.
 */
export async function DELETE(req: NextRequest) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth
  const id = req.nextUrl.searchParams.get('id') ?? ''
  const p = req.nextUrl.searchParams.get('p') ?? ''
  if (!BANC_LOT_RE.test(id) || !p) {
    return NextResponse.json({ error: 'Requête invalide' }, { status: 400 })
  }
  const manifest = lireBancManifest(id)
  if (!manifest) return NextResponse.json({ error: 'Lot introuvable' }, { status: 404 })
  const item = manifest.items.find((i) => i.productPath === p)
  if (item) {
    manifest.items = manifest.items.filter((i) => i !== item)
    ecrireBancManifest(id, manifest)
    const lotDir = bancLotDir(id)
    const planDir = bancPlanDir(id)
    effacerSous(lotDir, item.productPath)
    effacerSous(lotDir, item.productPath.replace(/\.png$/i, '') + '-ralify.png')
    effacerSous(planDir, item.planPath)
    effacerSous(planDir, item.planBrutPath)
  }
  return NextResponse.json({ ok: true })
}
