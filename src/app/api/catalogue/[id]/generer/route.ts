import path from 'node:path'
import fs from 'node:fs'
import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { getCatalogProduct, resolveCatalogFile } from '@/lib/catalogue/scan'
import { getColorisSettings } from '@/lib/catalogue/defaults'
import { getDecor } from '@/lib/db/decors'
import { launchGammeJobs } from '@/lib/server/launchGamme'
import { getDetourage, isGenerable } from '@/lib/catalogue/detourageStore'
import { serverPngUsable } from '@/lib/catalogue/detourageQueue'
import { listProductGenerations } from '@/lib/catalogue/generations'
import { enqueueNewJob } from '@/lib/server/runner'
import { getJob } from '@/lib/db'
import { config } from '@/lib/config'
import { getMoteurReglages, moteurDef, moteurForFamily } from '@/lib/moteurs'
import { COULISSANT_XL_MIN_W } from '@/lib/gabaritSets'

/**
 * Lancement d'une génération DEPUIS la page produit (bloc 3.1, 12/07/2026).
 *
 * Le client n'envoie qu'un repère de case : { coloris, size:{w,h}, format }.
 * Le serveur résout TOUT lui-même (jamais de chemin de fichier venu du
 * navigateur) : le PNG détouré depuis le résumé du scan (serveur en lecture seule),
 * le décor et l'alignement depuis les réglages par défaut du coloris. Les jobs
 * produits sont identiques à ceux de /api/gamme (fonction partagée), tagués
 * `catalogProductId`/`coloris`/`format` pour retrouver la MES dans la grille.
 *
 * Bloc 3.1 : format Site (2000×1330) uniquement, une case à la fois. Le
 * marketplace (recadrage + bords) arrive au bloc 3.3, les lots au bloc 3.2.
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

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth

  const { id } = await ctx.params
  const productId = Number(id)
  const product = getCatalogProduct(productId)
  if (!product) return NextResponse.json({ error: 'Produit introuvable' }, { status: 404 })

  // Aiguillage AUTOMATIQUE produit → moteur (cadrage 13/07/2026) : la famille
  // désigne le moteur ; seuls les moteurs ACTIFS génèrent (Battant « JANUS »,
  // Portillon « FORCULUS » — Coulissant encore en préparation).
  const moteurKey = moteurForFamily(product.family)
  const moteur = moteurKey ? moteurDef(moteurKey) : undefined
  if (!moteur || moteur.status !== 'actif') {
    return NextResponse.json(
      { error: 'Le moteur de mise en situation n’est pas encore disponible pour cette famille.' },
      { status: 400 }
    )
  }

  const body = await req.json().catch(() => null)
  const coloris = typeof body?.coloris === 'string' ? body.coloris : ''
  const w = Number(body?.size?.w)
  const h = Number(body?.size?.h)
  const format = typeof body?.format === 'string' ? body.format : ''
  if (!coloris || !Number.isFinite(w) || !Number.isFinite(h)) {
    return NextResponse.json({ error: 'Requête incomplète (coloris/taille).' }, { status: 400 })
  }
  // batchId partagé : toutes les cases d'un même LOT (ou d'un Reprendre/Dupliquer)
  // portent le même batch → un seul « lancement » dans l'historique (bloc 3.4).
  const reuseBatch = typeof body?.batchId === 'string' && body.batchId ? body.batchId : undefined
  // décor d'appoint (« Dupliquer » : pareil mais un autre décor) — n'écrase PAS
  // le décor par défaut enregistré du coloris, il ne vaut que pour ce lancement.
  const overrideDecorRaw = Number(body?.decorId)
  const overrideDecorId =
    Number.isInteger(overrideDecorRaw) && overrideDecorRaw > 0 ? overrideDecorRaw : null
  // ===== MARKETPLACE (2000×2000) — à la demande uniquement (bloc 3.3) =====
  // Fabriqué à partir de la MES Site : on ne résout ni décor ni PNG produit,
  // juste la source Site (locale d'abord, sinon serveur) → job « marketplace ».
  if (format === '2000x2000') {
    // Réglage du moteur : 'jamais' = déclinaison MP interdite (Admin → Réglages par moteur).
    if (getMoteurReglages(moteur.key).marketplace === 'jamais') {
      return NextResponse.json(
        { error: 'La déclinaison Marketplace est désactivée pour ce moteur.' },
        { status: 400 }
      )
    }
    const sizeLabel = `${w}x${h}`
    let sitePath: string | null = null
    let gateFrac: { x: number; y: number; w: number; h: number } | undefined
    const localSite = listProductGenerations(productId).find(
      (g) => g.coloris === coloris && g.size === sizeLabel && g.format === '2000x1330' && g.deliveryPath
    )
    if (localSite?.deliveryPath) {
      const abs = path.resolve(config.rootDir, localSite.deliveryPath)
      if (fs.existsSync(abs)) sitePath = abs
      // Zone du portail (recadrage Marketplace) depuis le job Site.
      const sj = getJob(localSite.jobId)
      if (sj?.result) {
        try {
          const r = JSON.parse(sj.result)
          if (r?.zoneFrac) gateFrac = r.zoneFrac
        } catch {
          // résultat illisible : on estimera la zone par la taille
        }
      }
    }
    if (!sitePath) {
      const summary = JSON.parse(product.summary) as {
        mes?: { format: string; file: string; size: string | null; coloris: string | null }[]
      }
      const siteMes = (summary.mes ?? []).find(
        (m) =>
          m.format === '2000x1330' &&
          m.size === sizeLabel &&
          (m.coloris === coloris || m.coloris === null)
      )
      if (siteMes) sitePath = resolveCatalogFile(product, siteMes.file)
    }
    if (!sitePath) {
      return NextResponse.json(
        { error: 'Génère d’abord la mise en situation Site.', code: 'site_manquant' },
        { status: 400 }
      )
    }
    const slug = `cat-${product.name}-${w}x${h}-mp`
      .replace(/[^a-z0-9-]+/gi, '-')
      .slice(0, 40)
      .toLowerCase()
    const batchId =
      reuseBatch ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const jobId = enqueueNewJob(
      'marketplace',
      {
        sourcePath: sitePath,
        size: { w, h },
        slug,
        catalogProductId: productId,
        coloris,
        format: '2000x2000',
        gateFrac,
        sizeW: w,
        // Recadrage + prompt d'extension PAR moteur (correctif portillon 13/07/2026).
        moteur: moteur.key,
      },
      batchId,
      auth.username
    )
    return NextResponse.json({ jobIds: [jobId], batchId })
  }

  if (format !== '2000x1330') {
    return NextResponse.json(
      { error: 'Format inconnu.', code: 'format_indisponible' },
      { status: 400 }
    )
  }

  // Réglages par défaut du coloris — cas « aucun décor » : on demande à l'UI
  // d'ouvrir la fenêtre de réglages plutôt que de planter (demande Mathias).
  // Un décor d'appoint (Dupliquer) prime sur le décor par défaut pour ce seul lancement.
  const settings = getColorisSettings(productId, coloris)
  // Coulissants XL (22/07/2026) : les largeurs ≥ 450 partent sur le DÉCOR XL du
  // coloris — décors incompatibles entre jeux (échelle différente), donc jamais
  // de repli silencieux : sans décor XL actif, la case reste en attente. Un
  // décor d'appoint du mauvais jeu est ignoré au profit du défaut du bon jeu.
  const isXl = moteur.key === 'coulissant' && w >= COULISSANT_XL_MIN_W
  const overrideDecor = overrideDecorId !== null ? getDecor(overrideDecorId) : null
  const overrideOk = overrideDecor && (overrideDecor.type === 'coulissant-xl') === isXl
  const effectiveDecorId =
    (overrideOk ? overrideDecorId : null) ?? (isXl ? settings.decorXlId : settings.decorId)
  if (effectiveDecorId === null) {
    return NextResponse.json(
      {
        error: isXl
          ? 'Choisis un décor XL par défaut pour ce coloris (tailles 450-600).'
          : 'Choisis un décor par défaut pour ce coloris.',
        code: 'reglages_manquants',
        coloris,
      },
      { status: 409 }
    )
  }
  const decor = getDecor(effectiveDecorId)
  if (!decor || decor.status !== 'actif' || (decor.type === 'coulissant-xl') !== isXl) {
    return NextResponse.json(
      {
        error: isXl
          ? 'Le décor XL de ce coloris n’est plus disponible — choisis-en un autre.'
          : 'Le décor par défaut de ce coloris n’est plus disponible — choisis-en un autre.',
        code: 'reglages_manquants',
        coloris,
      },
      { status: 409 }
    )
  }
  const decorPath = path.resolve(config.rootDir, decor.file_path)
  if (!decorPath.startsWith(path.resolve(config.dataDir)) || !fs.existsSync(decorPath)) {
    return NextResponse.json({ error: 'Fichier du décor introuvable.' }, { status: 400 })
  }

  // Source du produit : d'abord un détourage LOCAL validé/importé (chantier 2),
  // sinon le PNG de face du serveur (seulement si c'est une vraie face).
  let productPath: string | null = null
  const local = getDetourage(productId, coloris, `${w}x${h}`)
  if (isGenerable(local)) {
    const abs = path.resolve(config.rootDir, local!.png_path)
    if (fs.existsSync(abs)) productPath = abs
  }
  if (!productPath) {
    const summary = JSON.parse(product.summary) as { sizes: SizeNode[] }
    const sizeNode = summary.sizes.find((s) => s.w === w && s.h === h)
    const colorisNode = sizeNode?.coloris.find((c) => c.coloris === coloris)
    if (colorisNode?.facePng && serverPngUsable(colorisNode.facePng)) {
      productPath = resolveCatalogFile(product, colorisNode.facePng)
    }
  }
  if (!productPath) {
    return NextResponse.json(
      { error: 'Aucun visuel détouré pour cette référence — détoure-la d’abord.', code: 'png_absent' },
      { status: 400 }
    )
  }

  // 'moteur' (défaut) → align ABSENT du job : le réglage du moteur décide
  // (Admin → Réglages par moteur). 'off'/'manual' = dérogation de CE coloris.
  const align: 'off' | number | undefined =
    settings.align === 'off' ? 'off' : settings.align === 'manual' ? settings.alignPx : undefined
  const slug = `cat-${product.name}-${w}x${h}`
    .replace(/[^a-z0-9-]+/gi, '-')
    .slice(0, 40)
    .toLowerCase()

  const { jobIds, batchId } = launchGammeJobs({
    decorPath,
    // productName : sert aux exceptions RALify « nom du produit contient »
    // (le PNG détouré local s'appelle coloris_taille.png, le nom n'y est pas).
    items: [{ size: { w, h }, productPath, extra: { coloris, format, productName: product.name } }],
    align,
    slug,
    moteur: moteur.key,
    createdBy: auth.username,
    batchId: reuseBatch,
    extra: { catalogProductId: productId },
  })
  return NextResponse.json({ jobIds, batchId })
}
