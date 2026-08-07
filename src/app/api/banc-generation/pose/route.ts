import path from 'node:path'
import fs from 'node:fs'
import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { config } from '@/lib/config'
import {
  BANC_LOT_RE,
  bancPlanDir,
  ecrireBancManifest,
  lireBancManifest,
  resoudreSousLot,
  type BancManifest,
} from '@/lib/banc'
import { cadrageDaEffectif } from '@/lib/cadrageDa'
import { bancCadrage, construirePlanGris } from '@/lib/decorAutour'
import { getMoteurDaReglages, moteurDaDef } from '@/lib/moteursDa'

/**
 * BANC « génération & resizing » — étape 3/3 : POSE / RESIZING. Pose le produit
 * (RALifié si l'étape 2 a produit un fichier, sinon brut) sur le plan gris,
 * référence 400 (le resizing des 400B s'applique à toutes les images — ordre
 * Mathias 07/08). Quand RALify a été appliqué, pose AUSSI le brut : le
 * comparateur avant/après RALify de la vue en grand s'en nourrit.
 *
 * C'est ici, en FIN de chaîne, que le manifeste du lot est écrit — la page
 * retrouve au reload les images complètement préparées.
 */

interface PoseBody {
  lot?: string
  moteur?: string
  productPath?: string
  ralifyPath?: string | null
  w?: number
  h?: number
  name?: string
  coloris?: string
  produit?: string
  /** N° de dépôt (groupe d'affichage — voir BancManifestItem.groupe). */
  groupe?: number
  /** Fichier originel (rel) — persisté au manifeste pour les vues de contrôle. */
  originalPath?: string
}

function rel(full: string): string {
  return path.relative(config.rootDir, full)
}

export async function POST(req: NextRequest) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth

  let body: PoseBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Requête invalide' }, { status: 400 })
  }

  const moteur = moteurDaDef(String(body.moteur ?? 'janus'))
  if (!moteur) {
    return NextResponse.json({ error: 'Ce moteur n’est pas encore disponible.' }, { status: 400 })
  }
  const lotId = String(body.lot ?? '')
  if (!BANC_LOT_RE.test(lotId)) {
    return NextResponse.json({ error: 'Identifiant de lot invalide' }, { status: 400 })
  }
  const w = Number(body.w)
  const h = Number(body.h)
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return NextResponse.json({ error: 'Taille manquante ou invalide.' }, { status: 400 })
  }

  try {
    const productFull = resoudreSousLot(lotId, String(body.productPath ?? ''))
    const ralifyFull = body.ralifyPath ? resoudreSousLot(lotId, String(body.ralifyPath)) : null
    const reglages = getMoteurDaReglages(moteur.key)
    const planDir = bancPlanDir(lotId)
    fs.mkdirSync(planDir, { recursive: true })
    const base = path.basename(productFull).replace(/\.png$/i, '')

    // Cadrage selon moteur ET largeur (bancCadrage, source de vérité unique),
    // depuis les RÉGLAGES « Cadrage & scène » du moteur (07/08 soir) : réf.,
    // zoom/décalage, bascule XL du coulissant + pilier droit devant.
    const cadrage = cadrageDaEffectif(moteur.key, reglages.cadrageDa)
    const { refWidth, gabarit, pilierDroitDevant } = bancCadrage(moteur.key, w, cadrage)
    const optsPlan = {
      seuilAlpha: reglages.poseSeuilAlpha,
      refWidth,
      bandesSol: cadrage.bandesSol,
      gabarit,
      pilierDroitDevant,
      couleurs: cadrage.couleurs,
      recouvrementCm: cadrage.recouvrementCm,
      queueCouverturePct: cadrage.queueCouverturePct,
      queueSeuilPct: cadrage.queueSeuilPct,
      produitLargeurPct: cadrage.produitLargeurPct,
      produitHauteurPct: cadrage.produitHauteurPct,
    }

    // Plan AFFICHÉ = le plan qui partira à Nano (produit RALifié si RALify actif).
    const plan = await construirePlanGris(ralifyFull ?? productFull, { w, h }, optsPlan)
    const planFull = path.join(planDir, `${base}-plan.png`)
    fs.writeFileSync(planFull, plan.buffer)

    let planBrutPath: string | undefined
    if (ralifyFull) {
      const planBrut = await construirePlanGris(productFull, { w, h }, optsPlan)
      const p = path.join(planDir, `${base}-plan-brut.png`)
      fs.writeFileSync(p, planBrut.buffer)
      planBrutPath = rel(p)
    }

    const coloris = typeof body.coloris === 'string' ? body.coloris : ''
    const produit = String(body.produit ?? '').trim().slice(0, 60)
    const manifest: BancManifest = lireBancManifest(lotId) ?? {
      moteur: moteur.key,
      produit: '',
      items: [],
    }
    if (produit && !manifest.produit) manifest.produit = produit
    const groupe = Number(body.groupe)
    // Vues de contrôle (07/08) : originel + RALify persistés au manifeste —
    // résolus SOUS LE LOT (anti-évasion), ignorés silencieusement sinon.
    let originalRel: string | undefined
    try {
      originalRel = body.originalPath ? rel(resoudreSousLot(lotId, String(body.originalPath))) : undefined
    } catch {
      originalRel = undefined
    }
    manifest.items.push({
      name: String(body.name ?? path.basename(productFull)),
      w,
      h,
      coloris,
      productPath: rel(productFull),
      planPath: rel(planFull),
      ...(planBrutPath ? { planBrutPath } : {}),
      ...(Number.isFinite(groupe) && groupe > 0 ? { groupe } : {}),
      ...(originalRel ? { originalPath: originalRel } : {}),
      ...(ralifyFull ? { ralifyPath: rel(ralifyFull) } : {}),
    })
    ecrireBancManifest(lotId, manifest)

    return NextResponse.json({ planPath: rel(planFull), planBrutPath: planBrutPath ?? null })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    )
  }
}
