import path from 'node:path'
import fs from 'node:fs'
import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { config } from '@/lib/config'
import { cadrageDaEffectif } from '@/lib/cadrageDa'
import { bancCadrage } from '@/lib/decorAutour'
import { getMesDecor } from '@/lib/db/mesDecors'
import { getProduitDescription } from '@/lib/db/produitDescriptions'
import {
  createGenerationSession,
  getGenerationSession,
} from '@/lib/db/generationSessions'
import { launchDecorAutourJobs, type DecorAutourLaunchItem } from '@/lib/server/launchDecorAutour'
import { getMoteurDaReglages, moteurDaDef } from '@/lib/moteursDa'
import { parseProduitFromFileName } from '@/lib/productName'
import type { ImageSize } from '@/lib/genai/client'

/**
 * DÉCOR ÉCRIN — étape 2 : GÉNÉRATION. Lance les jobs « decor-autour » du vrai
 * pipeline (RALify + plan gris + Nano) sur les images déjà déposées par
 * /api/banc-generation/upload.
 *
 * PAGE OFFICIELLE depuis le 07/08/2026 (le banc remplace l'ancienne MES Écrin,
 * décision Mathias) :
 *  - TOUJOURS 1 génération par image — les variantes passent par les VERSIONS
 *    (regénération, retours par prompt) de la vue en grand ;
 *  - les jobs ne sont PLUS marqués lab : générations à part entière ;
 *  - le premier lancement d'un lot crée une SESSION (cartes « Mes sessions »
 *    de l'accueil — la carte rouvre la page avec ?session=<lot>).
 *
 * Le suivi passe par /api/gamme/:batchId (poll) et ↻ par /api/jobs/:id/regen.
 */

interface GenItem {
  productPath: string
  w: number
  h: number
  coloris?: string
  /** Nom de fichier D'ORIGINE — clé de la bibliothèque de descriptions (le
   *  chemin serveur a un préfixe unique qui fausserait le parseur produit). */
  name?: string
}

const SIZES: ImageSize[] = ['1K', '2K', '4K']

export async function POST(req: NextRequest) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth

  let body: {
    items?: GenItem[]
    moteur?: string
    imageSize?: string
    batchId?: string
    produit?: string
    decorId?: number
    /** true = regénération manuelle (↻) : jamais de juge (règle 17/08). */
    regen?: boolean
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Requête invalide' }, { status: 400 })
  }

  const moteur = moteurDaDef(String(body.moteur ?? 'janus'))
  if (!moteur) {
    return NextResponse.json({ error: 'Ce moteur n’est pas encore disponible.' }, { status: 400 })
  }
  const imageSize: ImageSize = SIZES.includes(body.imageSize as ImageSize)
    ? (body.imageSize as ImageSize)
    : '2K'

  if (!Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json({ error: 'Aucune image à générer.' }, { status: 400 })
  }

  // Décor demandé (08/08) : validé ici — un id fantôme retomberait silencieusement
  // sur le défaut dans le pipeline, autant le dire tout de suite.
  let decorId: number | undefined
  if (body.decorId !== undefined) {
    decorId = Number(body.decorId)
    if (!Number.isInteger(decorId) || !getMesDecor(decorId)) {
      return NextResponse.json({ error: 'Décor introuvable.' }, { status: 400 })
    }
  }

  // Les chemins reviennent du client : on ne lance QUE des PNG déposés par
  // l'upload du banc (sous data/generation/banc-…) — anti-évasion de chemin.
  const genRoot = path.join(config.dataDir, 'generation')
  const items: DecorAutourLaunchItem[] = []
  /** Nom du 1ᵉʳ produit du lot — titre de la session si le champ Produit est vide. */
  let premierProduit = ''
  // Réglages « Cadrage & scène » du moteur (07/08 soir) : pilotent bancCadrage
  // (réf./gabarit/bascule XL) et l'interrupteur bandes de sol.
  const reglagesMoteur = getMoteurDaReglages(moteur.key)
  const cadrage = cadrageDaEffectif(moteur.key, reglagesMoteur.cadrageDa)
  for (const it of body.items) {
    const w = Number(it.w)
    const h = Number(it.h)
    const full = path.resolve(config.rootDir, String(it.productPath ?? ''))
    const sousBanc =
      full.startsWith(genRoot + path.sep) &&
      path.relative(genRoot, full).startsWith('banc-')
    if (!sousBanc || !fs.existsSync(full)) {
      return NextResponse.json({ error: 'Image hors périmètre du banc.' }, { status: 400 })
    }
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
      return NextResponse.json({ error: 'Taille manquante ou invalide.' }, { status: 400 })
    }
    // Description produit (bibliothèque vision, clé produit+coloris+moteur) :
    // cherchée PAR ITEM côté serveur — survit au reload, jamais envoyée par le
    // client. Absente = le step retombe sur la phrase générique.
    const coloris = typeof it.coloris === 'string' ? it.coloris : ''
    const nomProduit = parseProduitFromFileName(String(it.name ?? path.basename(full)))
    if (nomProduit && !premierProduit) premierProduit = nomProduit
    const desc = nomProduit ? getProduitDescription(nomProduit, coloris, moteur.key) : undefined
    items.push({
      size: { w, h },
      productPath: full,
      extra: {
        coloris,
        ...(desc ? { productDescription: desc.description } : {}),
        // Cadrage PAR ITEM (07/08) : la bascule XL du coulissant dépend de la
        // largeur — un lot peut mélanger standard et XL.
        ...bancCadrage(moteur.key, w, cadrage),
      },
    })
  }

  const produit = String(body.produit ?? '').trim().slice(0, 60)
  const { jobIds, batchId } = launchDecorAutourJobs({
    items,
    moteur: moteur.key,
    imageSize,
    slug: 'banc',
    createdBy: auth.username,
    batchId: typeof body.batchId === 'string' && body.batchId ? body.batchId : undefined,
    generations: 1,
    extra: {
      // banc:true = trace d'origine (page Décor Écrin) ; plus de lab depuis
      // que la page est officielle (07/08).
      banc: true,
      // Le cadrage (réf./gabarit/bascule XL) est PAR ITEM — voir plus haut.
      // Bandes de sol : réglage « Cadrage & scène » du moteur (défaut activé).
      bandesSol: cadrage.bandesSol,
      ...(produit ? { productName: produit } : {}),
      // Décor choisi dans l'en-tête (08/08) — id validé plus haut ; absent =
      // le pipeline prend le décor par défaut de la bibliothèque.
      ...(decorId !== undefined ? { decorId } : {}),
      // Juge vision (17/08) : réglage moteur `jugeMes` — le runner juge chaque
      // rendu et relance une version en cas de refus (2 relances max).
      // JAMAIS sur une regénération manuelle (règle Mathias 17/08 : « le juge
      // c'est une fois au début, pas ensuite ») — le ↻ envoie regen:true.
      ...(reglagesMoteur.jugeMes === 'on' && body.regen !== true ? { juge: true } : {}),
    },
  })

  // Une SESSION par lot (page officielle 07/08) : la carte « Mes sessions » de
  // l'accueil rouvre la page (?session=<lot>). Créée au 1ᵉʳ lancement seulement.
  if (!getGenerationSession(batchId)) {
    createGenerationSession({
      batchId,
      produit: produit || premierProduit || moteur.key,
      moteur: moteur.key,
      decorId: null,
      createdBy: auth.username,
    })
  }

  return NextResponse.json({ batchId, jobIds })
}
