import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import {
  CONCURRENCY_KEY,
  CONCURRENCY_MAX,
  CONCURRENCY_MIN,
  IMAGE_MODEL_KEY,
  IMAGE_MODELS,
  MARQUAGE_IA_KEY,
  PREP_CONCURRENCE_KEY,
  PREP_CONCURRENCE_MAX,
  PREP_CONCURRENCE_MIN,
  SAS_IMAGES_KEY,
  SAS_IMAGES_MAX,
  SAS_IMAGES_MIN,
  SERVER_ROOT_KEY,
  VISION_MODEL_KEY,
  VISION_TEMPLATE_KEY,
  getConcurrencyPerUser,
  getImageModel,
  getPrepConcurrence,
  getSasImagesLimite,
  getServerRoot,
  getVisionModel,
  getVisionTemplate,
  isMarquageIaActif,
  setSetting,
} from '@/lib/db/settings'
import { PROMPT_DESCRIPTION_DEFAUT } from '@/lib/genai/descriptionProduit'

/** Réglages d'application — lecture pour tous, écriture ADMIN. */
export async function GET(req: NextRequest) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth
  return NextResponse.json({
    concurrencyPerUser: getConcurrencyPerUser(),
    bounds: { min: CONCURRENCY_MIN, max: CONCURRENCY_MAX },
    serverRoot: getServerRoot(),
    marquageIa: isMarquageIaActif(),
    imageModel: getImageModel(),
    imageModels: IMAGE_MODELS,
    // Modèles & exécution (07/08) — vision descriptions, sas sharp, préparation front.
    visionModel: getVisionModel(),
    visionTemplate: getVisionTemplate(),
    visionTemplateDefaut: PROMPT_DESCRIPTION_DEFAUT,
    sasImages: getSasImagesLimite(),
    sasBounds: { min: SAS_IMAGES_MIN, max: SAS_IMAGES_MAX },
    prepConcurrence: getPrepConcurrence(),
    prepBounds: { min: PREP_CONCURRENCE_MIN, max: PREP_CONCURRENCE_MAX },
  })
}

export async function PATCH(req: NextRequest) {
  const auth = requireApiUser(req, 'admin')
  if (auth instanceof NextResponse) return auth
  const body = await req.json().catch(() => null)

  if (body?.concurrencyPerUser !== undefined) {
    const value = Number(body.concurrencyPerUser)
    if (!Number.isInteger(value) || value < CONCURRENCY_MIN || value > CONCURRENCY_MAX) {
      return NextResponse.json(
        { error: `Valeur invalide (entier entre ${CONCURRENCY_MIN} et ${CONCURRENCY_MAX})` },
        { status: 400 }
      )
    }
    setSetting(CONCURRENCY_KEY, String(value))
  }

  // Marquage IA des images (IPTC DigitalSourceType) — réglage global, jamais par moteur.
  if (body?.marquageIa !== undefined) {
    if (typeof body.marquageIa !== 'boolean') {
      return NextResponse.json({ error: 'Valeur invalide (attendu vrai/faux)' }, { status: 400 })
    }
    setSetting(MARQUAGE_IA_KEY, body.marquageIa ? '1' : '0')
  }

  // Modèle de génération d'images : Nano Banana Pro ou Nano Banana (réglage global).
  if (body?.imageModel !== undefined) {
    if (!IMAGE_MODELS.some((m) => m.id === body.imageModel)) {
      return NextResponse.json(
        { error: `Modèle invalide (attendu : ${IMAGE_MODELS.map((m) => m.id).join(' ou ')})` },
        { status: 400 }
      )
    }
    setSetting(IMAGE_MODEL_KEY, String(body.imageModel))
  }

  // Modèle vision des descriptions produit — nom LIBRE (à vérifier via ListModels,
  // règle du 07/08 : jamais de nom en dur non vérifié). Vide = retour au défaut.
  if (body?.visionModel !== undefined) {
    const value = String(body.visionModel).trim()
    if (value.length > 80 || /\s/.test(value)) {
      return NextResponse.json({ error: 'Nom de modèle invalide' }, { status: 400 })
    }
    setSetting(VISION_MODEL_KEY, value)
  }

  // Gabarit du prompt vision — vide = retour au gabarit d'usine.
  if (body?.visionTemplate !== undefined) {
    const value = String(body.visionTemplate)
    if (value.length > 8000) {
      return NextResponse.json({ error: 'Gabarit trop long (8000 caractères max)' }, { status: 400 })
    }
    setSetting(VISION_TEMPLATE_KEY, value)
  }

  // Sas de calcul d'image (phases sharp simultanées dans le processus web).
  if (body?.sasImages !== undefined) {
    const value = Number(body.sasImages)
    if (!Number.isInteger(value) || value < SAS_IMAGES_MIN || value > SAS_IMAGES_MAX) {
      return NextResponse.json(
        { error: `Valeur invalide (entier entre ${SAS_IMAGES_MIN} et ${SAS_IMAGES_MAX})` },
        { status: 400 }
      )
    }
    setSetting(SAS_IMAGES_KEY, String(value))
  }

  // Chaînes de préparation côté page MES Contrainte.
  if (body?.prepConcurrence !== undefined) {
    const value = Number(body.prepConcurrence)
    if (!Number.isInteger(value) || value < PREP_CONCURRENCE_MIN || value > PREP_CONCURRENCE_MAX) {
      return NextResponse.json(
        { error: `Valeur invalide (entier entre ${PREP_CONCURRENCE_MIN} et ${PREP_CONCURRENCE_MAX})` },
        { status: 400 }
      )
    }
    setSetting(PREP_CONCURRENCE_KEY, String(value))
  }

  // Racine du serveur de fichiers (catalogue vivant) — l'app n'y accède qu'en LECTURE.
  if (body?.serverRoot !== undefined) {
    const value = String(body.serverRoot).trim()
    if (!value || value.length > 500) {
      return NextResponse.json({ error: 'Chemin de serveur invalide' }, { status: 400 })
    }
    setSetting(SERVER_ROOT_KEY, value)
  }

  return NextResponse.json({
    ok: true,
    concurrencyPerUser: getConcurrencyPerUser(),
    serverRoot: getServerRoot(),
    marquageIa: isMarquageIaActif(),
    imageModel: getImageModel(),
  })
}
