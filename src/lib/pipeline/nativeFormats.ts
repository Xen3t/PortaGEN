import type { ImageSize } from '@/lib/genai/client'

/**
 * Dimensions natives de sortie de Nano Banana pour le ratio « 3:2 » (réel : 1,4906 = 79/53,
 * grille interne de 64 px). Mesurées par le Lab le 08/07/2026 (data/lab/) :
 * le modèle renvoie exactement ces tailles, et renvoyer une entrée à cette taille
 * supprime le décalage du trottoir (−17 px → −1 px).
 *
 * Règle du pipeline : toute image envoyée au modèle est à la taille native ; le
 * redimensionnement vers le format de livraison (2000×1330) n'a lieu qu'en toute fin.
 */
export const NATIVE_DIMS: Record<ImageSize, { width: number; height: number }> = {
  '1K': { width: 1264, height: 848 },
  '2K': { width: 2528, height: 1696 },
  '4K': { width: 5056, height: 3392 },
}
