import sharp from 'sharp'
import type { RectPx } from '@/lib/geometry'

/**
 * Brique partagée « pose produit » (chantier pose + fusion, cadrage du 17/07/2026 —
 * docs/CADRAGE-POSE-FUSION-JANUS-2026-07-17.md). Reprend la « méthode 1 » validée par
 * Mathias sur l'Eiger puis à l'aveugle sur le Cervina Ruivo (scripts/test-pose-methode1.ts),
 * calibrée sur ses montages manuels Photoshop :
 *
 * 1. nettoyage de la transparence (alpha >= seuil uniquement) ;
 * 2. boîte englobante sur le masque nettoyé (le vrai portail, rien d'autre) ;
 * 3. cible = zone portail du gabarit élargie du débordement piliers par côté,
 *    bas ancré sur la ligne de sol ;
 * 4. étirement libre (largeur/hauteur indépendantes, comme la pratique Photoshop) ;
 * 5. collage sur « décor + aplats ».
 *
 * Réutilisable par les trois moteurs (JANUS / TERMINUS / FORCULUS).
 */

/** Débordement sur les piliers, en fraction de la largeur PAR CÔTÉ (Mathias, 17/07/2026). */
export const POSE_DEBORD_DEFAUT = 0.02
/**
 * Seuil de nettoyage : les PNG fournisseur contiennent des pixels fantômes quasi blancs
 * (alpha 1-159, restes des piliers du rendu) qui gonflent la boîte englobante — sans
 * nettoyage : trou entre portail et piliers + résidus blancs collés.
 */
export const POSE_SEUIL_ALPHA_DEFAUT = 200
/**
 * Réparation des trous d'alpha (constat du test réel du 20/07/2026) : l'alpha
 * fournisseur « mange » aussi les PIEDS ALU clairs/réfléchissants (intérieur à
 * alpha 0, liseré fantôme) → moignon blanc posé, que Nano nettoie. On rebouche
 * les poches de transparence ENCLAVÉES dans le produit quand leurs pixels ne
 * sont pas blancs (le pied est gris argenté ; un interstice d'ajouré laisse voir
 * le fond studio à luminance >= 250 et reste donc percé).
 */
const REPARE_LUM_MAX = 246
/**
 * Poches enclavées (constat du 21/07/2026) : sur certains rendus (Eiger 300B140…)
 * le pied alu est si surexposé que son RGB fantôme est BLANC — la passe couleur
 * ci-dessus n'a rien à récupérer. Mais le détourage fournisseur laisse un liseré
 * semi-transparent (alpha 1-199) qui trace le CONTOUR du pied : dans la bande
 * basse, une poche de transparence fermée par ce liseré, qui descend jusqu'au bas
 * du produit, étroite, et majoritairement sous de la vraie matière est un pied.
 * Une découpe d'ajouré s'arrête au-dessus du rail bas (elle ne « touche » jamais
 * le bas) et reste percée ; un pilier fantôme n'a pas de matière au-dessus de lui
 * (colonnes disqualifiées).
 */
const POCHE_BAS_MARGE = 0.03
const POCHE_LARGEUR_MAX = 0.2
const POCHE_COLONNES_MIN = 0.5
/** Halo (px) autour d'une poche restaurée où le liseré retrouve son alpha d'origine. */
const POCHE_HALO_PX = 8

export interface PoseOptions {
  /** Débordement piliers par côté (fraction de la largeur cible) */
  debord?: number
  /** Alpha minimal conservé (0-255) */
  seuilAlpha?: number
}

export interface ProduitNettoye {
  /** PNG du produit nettoyé et rogné sur sa boîte englobante */
  image: Buffer
  width: number
  height: number
  /** Boîte englobante dans l'image d'origine (bornes incluses) */
  bbox: { minX: number; minY: number; maxX: number; maxY: number }
  /** Pixels de matière restaurés dans les trous d'alpha enclavés (pieds alu…) */
  alphaReparePx: number
}

export interface PoseResult {
  /** Base + produit posé (PNG) — l'entrée de l'appel « fusion » */
  image: Buffer
  /** Rectangle réellement couvert par le produit posé (px) */
  cible: { x: number; y: number; w: number; h: number }
  /** Produit nettoyé (pour artefacts de contrôle) */
  produit: ProduitNettoye
  /** Produit nettoyé ÉTIRÉ à la taille de pose (PNG) — repérage des pieds */
  etire: Buffer
}

/**
 * Étapes 1-2 : ne garde que les pixels d'alpha >= seuil, répare les trous d'alpha
 * enclavés non blancs (pieds alu) et les poches enclavées de la bande basse dont le
 * RGB fantôme est blanc (pieds cramés), puis rogne sur la boîte englobante du masque.
 */
export async function nettoyerProduit(
  input: Buffer | string,
  seuilAlpha = POSE_SEUIL_ALPHA_DEFAUT,
  reparePochesPieds = true
): Promise<ProduitNettoye> {
  const { data, info } = await sharp(input, { limitInputPixels: false })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const W = info.width
  const H = info.height
  const ch = info.channels
  // Alpha d'origine conservé : le seuillage détruit le liseré semi-transparent
  // dont la réparation des poches enclavées (pieds cramés) a besoin plus bas.
  const alphaOrig = new Uint8Array(W * H)
  for (let p = 0, i = ch - 1; i < data.length; p++, i += ch) {
    alphaOrig[p] = data[i]
    if (data[i] < seuilAlpha) data[i] = 0
  }

  // Boîte englobante de la matière franche (avant réparation).
  let minX = W
  let maxX = -1
  let minY = H
  let maxY = -1
  for (let y = 0; y < H; y++) {
    const row = y * W
    for (let x = 0; x < W; x++) {
      if (data[(row + x) * ch + 3] > 0) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX === -1) {
    throw new Error(`Produit entièrement transparent au seuil alpha ${seuilAlpha}`)
  }

  // Réparation des PIEDS : dans la BANDE BASSE du produit (les pieds vivent sous
  // le rail bas), à l'INTÉRIEUR de la boîte, on restaure la matière non blanche
  // que l'alpha fournisseur a détourée à tort (pied alu réfléchissant) — mais
  // UNIQUEMENT par contiguïté depuis la matière opaque : le pied touche son
  // montant ; un fragment de pilier fantôme séparé par du fond blanc n'est
  // jamais atteint. Le fond studio (luminance >= 250) et les interstices
  // d'ajouré (fond visible, blanc) ne sont jamais rebouchés.
  const bandTop = Math.max(minY, Math.round(maxY - (maxY - minY + 1) * 0.12))
  // Une colonne n'est réparable que si un VRAI élément du produit la surplombe
  // (matière opaque sur >= 10 % de la hauteur au-dessus de la bande) : les
  // montants et le profil central qualifient ; un liseré de pilier fantôme dont
  // la colonne ne porte qu'un gond de quelques pixels ne qualifie jamais.
  const colOK = new Uint8Array(W)
  const colMin = Math.round((maxY - minY + 1) * 0.1)
  for (let x = minX; x <= maxX; x++) {
    let c = 0
    for (let y = minY; y < bandTop; y++) {
      if (data[(y * W + x) * ch + 3] > 0) c++
    }
    if (c >= colMin) colOK[x] = 1
  }
  const restorable = (o: number): boolean => {
    if (data[o + 3] !== 0) return false
    const lum = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]
    return lum < REPARE_LUM_MAX
  }
  const inBand = (i: number): boolean => {
    const y = Math.floor(i / W)
    const x = i - y * W
    return y >= bandTop && x >= minX && x <= maxX && colOK[x] === 1
  }
  const queue = new Int32Array(W * (H - bandTop))
  const queued = new Uint8Array(W * H)
  let qh = 0
  let qt = 0
  // Germes : pixels restaurables collés à de la matière opaque.
  for (let y = bandTop; y < H; y++) {
    const row = y * W
    for (let x = minX; x <= maxX; x++) {
      if (!colOK[x]) continue
      const i = row + x
      if (!restorable(i * ch)) continue
      const touche =
        (x > 0 && data[(i - 1) * ch + 3] > 0) ||
        (x < W - 1 && data[(i + 1) * ch + 3] > 0) ||
        (i >= W && data[(i - W) * ch + 3] > 0) ||
        (i + W < W * H && data[(i + W) * ch + 3] > 0)
      if (touche && !queued[i]) {
        queued[i] = 1
        queue[qt++] = i
      }
    }
  }
  let alphaReparePx = 0
  while (qh < qt) {
    const i = queue[qh++]
    data[i * ch + 3] = 255
    alphaReparePx++
    const y = Math.floor(i / W)
    const x = i - y * W
    if (y > maxY) maxY = y
    // Voisins SANS enroulement de ligne : i-1 en x=0 retomberait sur la fin de la
    // ligne précédente (cas réel : PNG rognés sur leur boîte, minX=0 / maxX=W-1).
    const voisins: number[] = []
    if (x > 0) voisins.push(i - 1)
    if (x < W - 1) voisins.push(i + 1)
    if (i >= W) voisins.push(i - W)
    if (i + W < W * H) voisins.push(i + W)
    for (const j of voisins) {
      if (queued[j] || !inBand(j) || !restorable(j * ch)) continue
      queued[j] = 1
      queue[qt++] = j
    }
  }

  // Réparation des POCHES ENCLAVÉES (pieds cramés — voir POCHE_* plus haut).
  // DÉSACTIVABLE (reparePochesPieds=false) : une lame coulissante n'a pas de
  // pieds, et sa clairance sous-lame — compartimentée par les galets et fermée
  // par le liseré du sol studio — serait rebouchée à tort (régression attrapée
  // au pré-vol TERMINUS du 21/07).
  // 1. Le « fond » est inondé depuis le bord de la fenêtre de bande à travers les
  //    pixels vraiment vides (alpha nul avant ET après réparation) — le liseré
  //    et la matière bloquent le passage.
  if (reparePochesPieds) {
    const winX0 = Math.max(0, minX - 40)
    const winX1 = Math.min(W - 1, maxX + 40)
    const winW = winX1 - winX0 + 1
    const vide = (i: number): boolean => data[i * ch + 3] === 0 && alphaOrig[i] === 0
    const local = (i: number): number => {
      const y = Math.floor(i / W)
      return (y - bandTop) * winW + (i - y * W - winX0)
    }
    // 0 = non visité, 1 = fond joignable, 2 = poche examinée
    const etat = new Uint8Array(winW * (H - bandTop))
    const pile: number[] = []
    for (let x = winX0; x <= winX1; x++) pile.push(bandTop * W + x, (H - 1) * W + x)
    for (let y = bandTop; y < H; y++) pile.push(y * W + winX0, y * W + winX1)
    while (pile.length) {
      const i = pile.pop() as number
      if (!vide(i) || etat[local(i)]) continue
      etat[local(i)] = 1
      const y = Math.floor(i / W)
      const x = i - y * W
      if (x > winX0) pile.push(i - 1)
      if (x < winX1) pile.push(i + 1)
      if (y > bandTop) pile.push(i - W)
      if (y < H - 1) pile.push(i + W)
    }
    // 2. Chaque poche non joignable est un candidat pied : gardes-fous puis
    //    restauration (intérieur opaque, liseré du halo remis à son alpha d'origine).
    const largeurMax = Math.round((maxX - minX + 1) * POCHE_LARGEUR_MAX)
    for (let y0 = bandTop; y0 < H; y0++) {
      for (let x0 = winX0; x0 <= winX1; x0++) {
        const depart = y0 * W + x0
        if (!vide(depart) || etat[local(depart)]) continue
        const poche: number[] = []
        let px0 = W
        let px1 = -1
        let py0 = H
        let py1 = -1
        let enColOK = 0
        etat[local(depart)] = 2
        pile.push(depart)
        while (pile.length) {
          const i = pile.pop() as number
          poche.push(i)
          const y = Math.floor(i / W)
          const x = i - y * W
          if (x < px0) px0 = x
          if (x > px1) px1 = x
          if (y < py0) py0 = y
          if (y > py1) py1 = y
          if (colOK[x]) enColOK++
          const voisinsP: number[] = []
          if (x > winX0) voisinsP.push(i - 1)
          if (x < winX1) voisinsP.push(i + 1)
          if (y > bandTop) voisinsP.push(i - W)
          if (y < H - 1) voisinsP.push(i + W)
          for (const j of voisinsP) {
            if (!vide(j) || etat[local(j)]) continue
            etat[local(j)] = 2
            pile.push(j)
          }
        }
        const toucheBas = py1 >= maxY - Math.round((maxY - minY + 1) * POCHE_BAS_MARGE)
        const etroite = px1 - px0 + 1 <= largeurMax
        const sousMatiere = enColOK >= poche.length * POCHE_COLONNES_MIN
        if (!toucheBas || !etroite || !sousMatiere) continue
        for (const i of poche) {
          data[i * ch + 3] = 255
          alphaReparePx++
          const y = Math.floor(i / W)
          if (y > maxY) maxY = y
        }
        // Liseré : dans le halo de la poche, les pixels que le seuillage a vidés
        // retrouvent leur alpha d'origine — le contour du pied redevient matière.
        const hx0 = Math.max(winX0, px0 - POCHE_HALO_PX)
        const hx1 = Math.min(winX1, px1 + POCHE_HALO_PX)
        const hy0 = Math.max(bandTop, py0 - POCHE_HALO_PX)
        const hy1 = Math.min(H - 1, py1 + POCHE_HALO_PX)
        for (let y = hy0; y <= hy1; y++) {
          for (let x = hx0; x <= hx1; x++) {
            const i = y * W + x
            if (data[i * ch + 3] !== 0 || alphaOrig[i] === 0) continue
            data[i * ch + 3] = alphaOrig[i]
            alphaReparePx++
            if (y > maxY) maxY = y
          }
        }
      }
    }
  }
  // MANGEUR DE PIXELS BLANCS (constat Mathias 28/07/2026) : le seuillage tue
  // aussi les voiles blancs SEMI-TRANSPARENTS légitimes du produit (inserts
  // décoratifs ARLBERG : alpha 1-49, luminance ~240). Discriminant : un pilier
  // fantôme ou une frange de détourage touche l'EXTÉRIEUR de la silhouette ;
  // un insert est ENCLAVÉ dans la matière opaque. On inonde l'extérieur à
  // travers les pixels vidés : tout pixel vidé NON joignable qui avait un
  // alpha fantôme (1-199) retrouve son alpha D'ORIGINE (translucidité
  // conservée — rien n'est rebouché en opaque).
  {
    const joignable = new Uint8Array(W * H)
    const pile: number[] = []
    for (let x = 0; x < W; x++) pile.push(x, (H - 1) * W + x)
    for (let y = 0; y < H; y++) pile.push(y * W, y * W + W - 1)
    while (pile.length) {
      const i = pile.pop() as number
      if (joignable[i] || data[i * ch + 3] !== 0) continue
      joignable[i] = 1
      const y = Math.floor(i / W)
      const x = i - y * W
      if (x > 0) pile.push(i - 1)
      if (x < W - 1) pile.push(i + 1)
      if (y > 0) pile.push(i - W)
      if (y < H - 1) pile.push(i + W)
    }
    for (let i = 0; i < W * H; i++) {
      if (data[i * ch + 3] === 0 && !joignable[i] && alphaOrig[i] > 0 && alphaOrig[i] < seuilAlpha) {
        data[i * ch + 3] = alphaOrig[i]
        alphaReparePx++
      }
    }
  }

  const image = await sharp(data, {
    raw: { width: W, height: H, channels: ch },
    limitInputPixels: false,
  })
    .extract({ left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 })
    .png()
    .toBuffer()
  return {
    image,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    bbox: { minX, minY, maxX, maxY },
    alphaReparePx,
  }
}

/**
 * Étape 3 : rectangle cible depuis la zone portail projetée en pixels — élargi du
 * débordement par côté, bas ancré sur le bas de la zone (la ligne de sol), hauteur
 * nominale sans débordement vertical.
 */
export function poseCible(
  gate: Pick<RectPx, 'x' | 'y' | 'w' | 'h'>,
  debord = POSE_DEBORD_DEFAUT
): { x: number; y: number; w: number; h: number } {
  const w = Math.round(gate.w * (1 + 2 * debord))
  const h = Math.round(gate.h)
  return { x: Math.round(gate.x - gate.w * debord), y: Math.round(gate.y + gate.h - h), w, h }
}

/**
 * Pose sur une CIBLE explicite : nettoie le produit, l'étire librement sur le
 * rectangle donné et le colle sur l'image de base. Sert aux moteurs dont la
 * cible n'est pas le simple débord symétrique (TERMINUS : lame en recouvrement
 * du pilier droit, bord gauche ancré sur l'ouverture).
 */
export async function poserProduitSurCible(
  base: Buffer | string,
  produitInput: Buffer | string,
  cible: { x: number; y: number; w: number; h: number },
  seuilAlpha = POSE_SEUIL_ALPHA_DEFAUT,
  reparePochesPieds = true
): Promise<PoseResult> {
  const produit = await nettoyerProduit(produitInput, seuilAlpha, reparePochesPieds)
  const etire = await sharp(produit.image)
    .resize(cible.w, cible.h, { fit: 'fill' })
    .png()
    .toBuffer()
  const image = await sharp(base)
    .composite([{ input: etire, left: cible.x, top: cible.y }])
    .png()
    .toBuffer()
  return { image, cible, produit, etire }
}

/**
 * Pose complète : nettoie le produit, l'étire librement sur la cible et le colle
 * sur l'image de base (décor + aplats). La sortie est l'entrée de l'appel « fusion ».
 */
export async function poserProduit(
  base: Buffer | string,
  produitInput: Buffer | string,
  gate: Pick<RectPx, 'x' | 'y' | 'w' | 'h'>,
  opts: PoseOptions = {}
): Promise<PoseResult> {
  return poserProduitSurCible(
    base,
    produitInput,
    poseCible(gate, opts.debord ?? POSE_DEBORD_DEFAUT),
    opts.seuilAlpha ?? POSE_SEUIL_ALPHA_DEFAUT
  )
}

export interface ProduitCandidat {
  /** Chemin (ou identifiant) du PNG produit */
  file: string
  /** Taille nominale lue dans le nom (cm) */
  w: number
  h: number
}

/**
 * Étape 5 (choix du PNG) : même largeur obligatoire, hauteur la plus proche —
 * l'étirement libre absorbe l'écart de hauteur (ex. taille 400×100 → PNG 400B115).
 * Retourne null si aucun candidat de la bonne largeur.
 */
export function choisirProduit<T extends ProduitCandidat>(
  candidats: T[],
  size: { w: number; h: number }
): T | null {
  const memesLargeurs = candidats.filter((c) => c.w === size.w)
  if (!memesLargeurs.length) return null
  return memesLargeurs.sort((a, b) => Math.abs(a.h - size.h) - Math.abs(b.h - size.h))[0]
}
