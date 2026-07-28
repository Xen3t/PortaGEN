import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import {
  CONCURRENCY_KEY,
  CONCURRENCY_MAX,
  CONCURRENCY_MIN,
  IMAGE_MODEL_KEY,
  IMAGE_MODELS,
  MARQUAGE_IA_KEY,
  PRICE_IN_KEY,
  PRICE_OUT_KEY,
  SERVER_ROOT_KEY,
  getConcurrencyPerUser,
  getImageModel,
  getPricing,
  getServerRoot,
  isMarquageIaActif,
  setSetting,
} from '@/lib/db/settings'

/** Réglages d'application — lecture pour tous, écriture ADMIN. */
export async function GET(req: NextRequest) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth
  return NextResponse.json({
    concurrencyPerUser: getConcurrencyPerUser(),
    bounds: { min: CONCURRENCY_MIN, max: CONCURRENCY_MAX },
    pricing: getPricing(),
    serverRoot: getServerRoot(),
    marquageIa: isMarquageIaActif(),
    imageModel: getImageModel(),
    imageModels: IMAGE_MODELS,
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

  // Tarif Gemini indicatif (€ / million de tokens) : 0 = non configuré.
  for (const [field, key] of [
    ['priceEurPerMTokIn', PRICE_IN_KEY],
    ['priceEurPerMTokOut', PRICE_OUT_KEY],
  ] as const) {
    if (body?.[field] !== undefined) {
      const value = Number(body[field])
      if (!Number.isFinite(value) || value < 0 || value > 10000) {
        return NextResponse.json(
          { error: 'Tarif invalide (nombre entre 0 et 10 000 € par million de tokens)' },
          { status: 400 }
        )
      }
      setSetting(key, String(value))
    }
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
    pricing: getPricing(),
    serverRoot: getServerRoot(),
    marquageIa: isMarquageIaActif(),
    imageModel: getImageModel(),
  })
}
