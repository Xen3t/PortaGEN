import type Database from 'better-sqlite3'
import { exiftool, type WriteTags } from 'exiftool-vendored'
import { getDb } from '@/lib/db'
import { isMarquageIaActif } from '@/lib/db/settings'

/**
 * Marquage IA des images produites par PortaGEN (brief Mathias 21/07/2026) :
 * chaque image générée reçoit la métadonnée IPTC officielle des contenus créés
 * par IA générative — DigitalSourceType = trainedAlgorithmicMedia, écrite dans
 * le paquet XMP (recommandation IPTC « synthetic media », lue par Google & co).
 *
 * Règles du brief :
 *  - un code déjà présent (ex. compositeSynthetic) est CONSERVÉ, jamais écrasé ;
 *  - les Content Credentials C2PA ne sont jamais retirés — exiftool ne modifie
 *    que les métadonnées demandées et laisse le reste du fichier intact
 *    (aucun réencodage des pixels) ;
 *  - paramétrable dans Admin → Réglages GÉNÉRAUX (toute l'application, pas par
 *    moteur), activé par défaut.
 */

/** URI officielle du code IPTC (vocabulaire cv.iptc.org, guidance IPTC 2023). */
export const DIGITAL_SOURCE_TYPE_IA =
  'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia'

/**
 * Écrit DigitalSourceType = trainedAlgorithmicMedia dans le fichier, sauf si un
 * code y figure déjà (on le conserve, règle du brief). Sans regard sur le
 * réglage global — c'est le rôle de {@link marquerImageIa}.
 */
export async function marquerFichierIa(absPath: string): Promise<void> {
  const lu = await exiftool.read(absPath, ['-XMP-iptcExt:DigitalSourceType'])
  const existant = (lu as Record<string, unknown>).DigitalSourceType
  if (typeof existant === 'string' && existant.trim()) return
  await exiftool.write(
    absPath,
    { 'XMP-iptcExt:DigitalSourceType': DIGITAL_SOURCE_TYPE_IA } as unknown as WriteTags,
    // Pas de copie « _original » : l'artefact est déjà notre seul exemplaire.
    { writeArgs: ['-overwrite_original'] }
  )
}

/**
 * Point d'entrée des pipelines : marque le fichier si le réglage global est
 * actif. Ne fait JAMAIS échouer une génération — un raté de métadonnée se
 * signale en console et l'image reste livrée telle quelle.
 */
export async function marquerImageIa(
  absPath: string,
  db: Database.Database = getDb()
): Promise<void> {
  try {
    if (!isMarquageIaActif(db)) return
    await marquerFichierIa(absPath)
  } catch (err) {
    console.warn(
      `Marquage IPTC impossible sur ${absPath} : ${err instanceof Error ? err.message : err}`
    )
  }
}

/** À appeler en fin de script CLI (les tests le font) — sans effet côté serveur. */
export async function fermerMarquage(): Promise<void> {
  await exiftool.end()
}
