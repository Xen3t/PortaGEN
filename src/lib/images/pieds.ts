import sharp from 'sharp'

/**
 * Brique « protection des pieds » (28/07/2026).
 *
 * Constat : les pieds alu (platines réglables, tige de verrouillage, galets de
 * coulissant) survivent jusqu'à l'entrée posée, mais Nano les « nettoie » au
 * rendu — un petit objet métallique isolé à la jonction avec le sol ressemble à
 * un artefact de détourage, et la section SUPPORT FEET du prompt ne suffit pas.
 *
 * Deux parades complémentaires, sur le même repérage :
 * 1. OMBRE DE CONTACT dessinée sous chaque pied dans l'entrée posée — un pied
 *    qui porte sa propre ombre ressemble à un vrai objet posé, pas à un déchet
 *    de détourage (même philosophie que l'ombre pilier→lame du coulissant) ;
 * 2. RECOLLAGE après Nano — les pixels des pieds de l'entrée posée sont
 *    recopiés sur la sortie (masque = alpha du produit, rétréci d'un pixel),
 *    le portail ne bougeant pas d'un pixel entre entrée et sortie.
 *
 * Repérage : sur le produit détouré ÉTIRÉ à sa taille de pose, le bord bas
 * principal (rail bas / lame) est la ligne de fond la plus fréquente ; tout
 * groupe de colonnes étroit qui descend nettement plus bas est un pied.
 */

/** Dépassement minimal (px) sous le bord bas principal pour compter comme pied. */
const PIED_SAILLIE_MIN_PX = 3
/** Largeur maximale d'un pied, en fraction de la largeur du produit posé. */
const PIED_LARGEUR_MAX = 0.15
/** Hauteur maximale d'un pied, en fraction de la hauteur du produit — au-delà
 * c'est une structure (bas de poteau), jamais de la quincaillerie. */
const PIED_HAUTEUR_MAX = 0.15
/** Frontière structure → quincaillerie : chute de largeur (fraction de la
 * largeur des premières lignes) tenue sur au moins N lignes. Le poteau est
 * large, la tige est étroite — c'est la chute qui marque le début du pied. */
const PIED_CHUTE_LARGEUR = 0.6
const PIED_CHUTE_LIGNES_MIN = 3
/** Remontée (px) du recollage au-dessus du bord bas principal — ancrage au montant. */
const PIED_CHEVAUCHE_PX = 2
/** Colonnes vides tolérées à l'intérieur d'un même pied (anti-crénelage). */
const PIED_TROU_MAX_PX = 2
/** Alpha minimal (0-255) pour compter comme matière sur le produit étiré. */
const PIED_ALPHA_MIN = 128
/** Ombre de contact : opacité au centre et proportions de l'ellipse. */
const OMBRE_OPACITE = 0.35
const OMBRE_RX_FACTEUR = 0.75
const OMBRE_RY_FACTEUR = 0.22
const OMBRE_RY_MIN_PX = 4

export interface PiedBox {
  /** Boîte du pied en coordonnées de l'image posée (px) */
  x: number
  y: number
  w: number
  h: number
}

interface RectLike {
  x: number
  y: number
  w: number
  h: number
}

function intersecte(a: RectLike, b: RectLike): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

/**
 * Repère les pieds du produit posé. `produitEtire` est le PNG du produit nettoyé
 * étiré à la taille de pose ; `cible` son rectangle dans l'image posée. Les zones
 * de `exclure` (ex. aplats piliers redessinés PAR-DESSUS la lame du coulissant)
 * sont écartées : leurs pixels dans l'entrée posée ne sont plus ceux du produit.
 */
export async function detecterPieds(
  produitEtire: Buffer,
  cible: RectLike,
  exclure: RectLike[] = []
): Promise<PiedBox[]> {
  const { data, info } = await sharp(produitEtire, { limitInputPixels: false })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const W = info.width
  const H = info.height
  const ch = info.channels

  // Bord bas de la matière, colonne par colonne.
  const bottom = new Int32Array(W).fill(-1)
  for (let x = 0; x < W; x++) {
    for (let y = H - 1; y >= 0; y--) {
      if (data[(y * W + x) * ch + 3] >= PIED_ALPHA_MIN) {
        bottom[x] = y
        break
      }
    }
  }

  // Bord bas PRINCIPAL = valeur la plus fréquente (le rail bas domine largement).
  const histo = new Map<number, number>()
  for (let x = 0; x < W; x++) {
    if (bottom[x] < 0) continue
    histo.set(bottom[x], (histo.get(bottom[x]) ?? 0) + 1)
  }
  if (!histo.size) return []
  let baseline = -1
  let best = 0
  for (const [y, n] of histo) {
    if (n > best || (n === best && y > baseline)) {
      baseline = y
      best = n
    }
  }

  // Groupes contigus de colonnes qui descendent nettement sous le bord bas
  // principal, puis frontière structure → quincaillerie (sévérité demandée le
  // 28/07) : dans chaque groupe, le PROFIL DE LARGEUR ligne par ligne repère
  // où la structure large (bas de poteau, profil central) s'arrête et où la
  // quincaillerie étroite (tige) commence — la chute de largeur fait foi.
  // Sans ça, la tranche basse du poteau partait dans le patch.
  const largeurMax = Math.max(2, Math.round(W * PIED_LARGEUR_MAX))
  const hauteurMax = Math.max(4, Math.round(H * PIED_HAUTEUR_MAX))
  const seuil = baseline + PIED_SAILLIE_MIN_PX
  const pieds: PiedBox[] = []
  const groupes: { debut: number; fin: number; bas: number }[] = []
  let debut = -1
  let fin = -1
  let bas = -1
  const clore = () => {
    if (debut >= 0) groupes.push({ debut, fin, bas })
    debut = -1
    fin = -1
    bas = -1
  }
  for (let x = 0; x < W; x++) {
    if (bottom[x] > seuil) {
      if (debut < 0) debut = x
      fin = x
      if (bottom[x] > bas) bas = bottom[x]
    } else if (debut >= 0 && x - fin > PIED_TROU_MAX_PX) {
      clore()
    }
  }
  clore()

  const opaque = (x: number, y: number): boolean => data[(y * W + x) * ch + 3] >= PIED_ALPHA_MIN
  for (const g of groupes) {
    // Largeur de matière ligne par ligne sous le bord bas principal.
    const yHaut = Math.min(baseline + 1, H - 1)
    const largeurs: number[] = []
    for (let y = yHaut; y <= g.bas; y++) {
      let n = 0
      for (let x = g.debut; x <= g.fin; x++) if (opaque(x, y)) n++
      largeurs.push(n)
    }
    const ref = Math.max(...largeurs.slice(0, Math.min(4, largeurs.length)))
    // Première chute de largeur tenue sur PIED_CHUTE_LIGNES_MIN lignes.
    let frontiere = -1
    let run = 0
    for (let i = 0; i < largeurs.length; i++) {
      if (largeurs[i] > 0 && largeurs[i] < ref * PIED_CHUTE_LARGEUR) {
        if (++run >= PIED_CHUTE_LIGNES_MIN) {
          frontiere = yHaut + i - run + 1
          break
        }
      } else {
        run = 0
      }
    }
    // Base du patch : le bas de la structure si une chute a été trouvée,
    // sinon le bord bas principal (pied directement sous le vantail).
    let base = baseline
    let gx0 = g.debut
    let gx1 = g.fin
    if (frontiere >= 0) {
      base = frontiere - 1
      // Resserre la boîte aux colonnes de la quincaillerie elle-même.
      let minX = g.fin + 1
      let maxX = g.debut - 1
      for (let x = g.debut; x <= g.fin; x++) {
        for (let y = frontiere; y <= g.bas; y++) {
          if (opaque(x, y)) {
            if (x < minX) minX = x
            if (x > maxX) maxX = x
            break
          }
        }
      }
      if (maxX >= minX) {
        gx0 = minX
        gx1 = maxX
      }
    }
    const w = gx1 - gx0 + 1
    const y0 = Math.max(0, base - PIED_CHEVAUCHE_PX + 1)
    const boite: PiedBox = { x: cible.x + gx0, y: cible.y + y0, w, h: g.bas - y0 + 1 }
    if (
      w >= 2 &&
      w <= largeurMax &&
      boite.h <= hauteurMax &&
      !exclure.some((r) => intersecte(boite, r))
    ) {
      pieds.push(boite)
    }
  }
  return pieds
}

/**
 * Option 2 — SVG des ombres de contact : une ellipse en dégradé radial sous
 * chaque pied, centrée sur son point de contact au sol. À composer sur l'entrée
 * posée AVANT l'appel Nano.
 *
 * REJETÉE en production le 28/07/2026 (test scripts/test-pieds.ts, portillon
 * ARLBERG 100×160) : Nano interprète « pied + ombre » comme un objet sombre et
 * peint un sabot noir à la place de la platine. Conservée pour le script de
 * test et une éventuelle variante plus subtile.
 */
export function ombresPiedsSvg(width: number, height: number, pieds: PiedBox[]): string {
  const ellipses = pieds
    .map((p, i) => {
      const cx = p.x + p.w / 2
      const cy = p.y + p.h
      const rx = Math.max(3, p.w * (0.5 + OMBRE_RX_FACTEUR / 2))
      const ry = Math.max(OMBRE_RY_MIN_PX, Math.round(p.w * OMBRE_RY_FACTEUR))
      return `<ellipse cx="${cx}" cy="${cy}" rx="${rx.toFixed(1)}" ry="${ry}" fill="url(#op${i})"/>`
    })
    .join('\n  ')
  const grads = pieds
    .map(
      (_, i) => `<radialGradient id="op${i}">
      <stop offset="0" stop-color="black" stop-opacity="${OMBRE_OPACITE}"/>
      <stop offset="0.7" stop-color="black" stop-opacity="${OMBRE_OPACITE * 0.5}"/>
      <stop offset="1" stop-color="black" stop-opacity="0"/>
    </radialGradient>`
    )
    .join('\n    ')
  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    ${grads}
  </defs>
  ${ellipses}
</svg>`
}

export interface PoteauRange {
  /** Colonnes du poteau (coordonnées de l'image posée), platine incluse */
  x: number
  w: number
}

/**
 * Repère les poteaux d'extrémité du produit posé (battant : montants à chapeau
 * qui portent les gonds — Nano les absorbe parfois dans le pilier stuc). Une
 * colonne de poteau est opaque sur la moitié de la hauteur ET monte jusqu'en
 * haut du produit (le chapeau dépasse le vantail). La bande retenue va du bord
 * du produit à la fin du poteau, débords de platine inclus. Un produit sans
 * poteau différencié (bord haut plat) ne retourne rien.
 */
export async function detecterPoteaux(produitEtire: Buffer, cible: RectLike): Promise<PoteauRange[]> {
  const { data, info } = await sharp(produitEtire, { limitInputPixels: false })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const W = info.width
  const H = info.height
  const ch = info.channels
  const hautMax = Math.max(1, Math.round(H * POTEAU_HAUT_FRACTION))
  const estPoteau = new Uint8Array(W)
  for (let x = 0; x < W; x++) {
    let opaque = 0
    let haut = false
    for (let y = 0; y < H; y++) {
      if (data[(y * W + x) * ch + 3] >= PIED_ALPHA_MIN) {
        opaque++
        if (y < hautMax) haut = true
      }
    }
    if (haut && opaque >= H * POTEAU_COL_FRACTION) estPoteau[x] = 1
  }
  const bord = Math.round(W * POTEAU_BORD_FRACTION)
  const largeurMax = Math.max(3, Math.round(W * POTEAU_LARGEUR_MAX))
  const ranges: PoteauRange[] = []
  // Gauche : premier run de colonnes poteau dans la bande de bord.
  let c0 = 0
  while (c0 < bord && !estPoteau[c0]) c0++
  if (c0 < bord && estPoteau[c0]) {
    let c1 = c0
    while (c1 + 1 < W && estPoteau[c1 + 1]) c1++
    if (c1 - c0 + 1 <= largeurMax) {
      ranges.push({ x: cible.x, w: Math.min(W, c1 + 1 + POTEAU_MARGE_PX) })
    }
  }
  // Droite : symétrique.
  let d1 = W - 1
  while (d1 >= W - bord && !estPoteau[d1]) d1--
  if (d1 >= W - bord && estPoteau[d1]) {
    let d0 = d1
    while (d0 - 1 >= 0 && estPoteau[d0 - 1]) d0--
    if (d1 - d0 + 1 <= largeurMax) {
      const x0 = Math.max(0, d0 - POTEAU_MARGE_PX)
      ranges.push({ x: cible.x + x0, w: W - x0 })
    }
  }
  return ranges
}

/** Recalage sur les BORDS du montant (v3, 28/07 soir) : Nano déplace parfois le
 * montant de quelques pixels — le pied est recollé là où le montant EST dans la
 * sortie. On corrèle les GRADIENTS des profils de luminance (bords = signal
 * fort, insensible à l'exposition) : profil horizontal de la bande de structure
 * au-dessus du pied pour dx, profil vertical autour du pied pour dy. Un
 * décalage n'est retenu que si la corrélation est franche, sinon 0. */
const RECALE_DX_MAX_PX = 25
const RECALE_DY_MAX_PX = 10
const RECALE_BANDE_HAUT_PX = 90
const RECALE_BANDE_MARGE_PX = 10
const RECALE_PROFIL_MARGE_X_PX = 60
const RECALE_CONFIANCE_MIN = 0.35
/** Poteaux d'extrémité : colonne de poteau = opaque sur ≥ 50 % de la hauteur ET
 * matière dans les 5 % supérieurs (le chapeau du poteau domine le vantail). */
const POTEAU_COL_FRACTION = 0.5
const POTEAU_HAUT_FRACTION = 0.05
const POTEAU_BORD_FRACTION = 0.15
const POTEAU_LARGEUR_MAX = 0.08
const POTEAU_MARGE_PX = 4
/** Recollage SÉLECTIF des poteaux (retour Mathias 28/07 : recoller tout le
 * poteau coupe les reflets de soleil que Nano a posés dessus) : le poteau est
 * examiné par tranches horizontales — une tranche n'est recollée que si Nano
 * l'a vraiment abîmée (structure divergente OU niveau moyen très éloigné,
 * ex. stuc blanc à la place du poteau). Une tranche juste relit-éclairée
 * (écart uniforme) est laissée au rendu. */
const POTEAU_BANDE_H_PX = 40
const POTEAU_SEUIL_STRUCTURE = 10
const POTEAU_ECART_MOYEN_MAX = 60
const POTEAU_MIN_ECH_BANDE = 30
/** Recollage : bornes du gain d'exposition (sécurité si la référence est douteuse). */
const RECOLLE_GAIN_MIN = 0.6
const RECOLLE_GAIN_MAX = 1.8
/** Recollage : fondu du bord haut du patch (px) pour un raccord invisible. */
const RECOLLE_FONDU_PX = 6

/**
 * Option 1 — recollage : recopie les pixels des pieds ET des poteaux
 * d'extrémité de l'entrée posée sur la sortie Nano. Masque = alpha du produit
 * étiré rétréci d'un pixel (pas de liseré recollé). Nano relit l'exposition du
 * portail : tout est corrigé d'un gain GLOBAL mesuré sur le cœur du produit
 * (zone que Nano préserve), pondéré par la luminosité du pixel. Les poteaux
 * sont recollés à leur position d'origine (ce sont eux l'ancre géométrique du
 * produit) ; les pieds restants sont recalés prudemment sur le rendu.
 * Retourne null si rien à recoller.
 */
export async function recollerPieds(
  sortie: Buffer,
  sortieDims: { width: number; height: number },
  entreePosee: Buffer,
  entreeDims: { width: number; height: number },
  produitEtire: Buffer,
  cible: RectLike,
  pieds: PiedBox[],
  poteaux: PoteauRange[] = []
): Promise<Buffer | null> {
  if (!pieds.length && !poteaux.length) return null
  const base = await sharp(entreePosee, { limitInputPixels: false })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const produit = await sharp(produitEtire, { limitInputPixels: false })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const rendu = await sharp(sortie, { limitInputPixels: false })
    .raw()
    .toBuffer({ resolveWithObject: true })
  const W = entreeDims.width
  const H = entreeDims.height
  const chB = base.info.channels
  const pW = produit.info.width
  const pH = produit.info.height
  const chP = produit.info.channels
  const chR = rendu.info.channels
  const sx = rendu.info.width / W
  const sy = rendu.info.height / H

  const alphaProduit = (x: number, y: number): number => {
    const px = x - cible.x
    const py = y - cible.y
    if (px < 0 || py < 0 || px >= pW || py >= pH) return 0
    return produit.data[(py * pW + px) * chP + 3]
  }
  // Érosion 1 px : un pixel n'est gardé que si tout son voisinage 4 est opaque.
  const garde = (x: number, y: number): boolean =>
    alphaProduit(x, y) >= PIED_ALPHA_MIN &&
    alphaProduit(x - 1, y) >= PIED_ALPHA_MIN &&
    alphaProduit(x + 1, y) >= PIED_ALPHA_MIN &&
    alphaProduit(x, y - 1) >= PIED_ALPHA_MIN &&
    alphaProduit(x, y + 1) >= PIED_ALPHA_MIN

  // Luminance de la sortie au point natif (x, y), -1 hors cadre.
  const lumSortie = (x: number, y: number): number => {
    const rxp = Math.round(x * sx)
    const ryp = Math.round(y * sy)
    if (rxp < 0 || ryp < 0 || rxp >= rendu.info.width || ryp >= rendu.info.height) return -1
    const s = (ryp * rendu.info.width + rxp) * chR
    return (rendu.data[s] + rendu.data[s + 1] + rendu.data[s + 2]) / 3
  }

  // Gain d'exposition GLOBAL : mesuré sur le cœur du produit (tiers central),
  // la zone que Nano préserve fidèlement — plus robuste qu'une référence
  // locale au pied, qui peut tomber sur une zone que Nano a justement mangée.
  const gain = [1, 1, 1]
  {
    const sommeE = [0, 0, 0]
    const sommeS = [0, 0, 0]
    let n = 0
    const gx0 = cible.x + Math.round(pW * 0.3)
    const gx1 = cible.x + Math.round(pW * 0.7)
    const gy0 = cible.y + Math.round(pH * 0.25)
    const gy1 = cible.y + Math.round(pH * 0.75)
    for (let y = Math.max(0, gy0); y < Math.min(H, gy1); y += 4) {
      for (let x = Math.max(0, gx0); x < Math.min(W, gx1); x += 4) {
        if (alphaProduit(x, y) < PIED_ALPHA_MIN) continue
        const rxp = Math.round(x * sx)
        const ryp = Math.round(y * sy)
        if (rxp < 0 || ryp < 0 || rxp >= rendu.info.width || ryp >= rendu.info.height) continue
        const e = (y * W + x) * chB
        const s = (ryp * rendu.info.width + rxp) * chR
        for (let c = 0; c < 3; c++) {
          sommeE[c] += base.data[e + c]
          sommeS[c] += rendu.data[s + c]
        }
        n++
      }
    }
    if (n > 0) {
      for (let c = 0; c < 3; c++) {
        const g = sommeE[c] > 0 ? sommeS[c] / sommeE[c] : 1
        gain[c] = Math.min(RECOLLE_GAIN_MAX, Math.max(RECOLLE_GAIN_MIN, g))
      }
    }
  }
  // Gain pondéré par la luminosité : plein effet dans les sombres, atténué
  // dans les clairs — une platine alu brillante corrigée du gain mesuré sur
  // du gris anthracite vire au rose saturé (constat du test du 28/07).
  const corrigeAvec = (v: number, c: number, g: number[]): number => {
    const facteur = 1 + (g[c] - 1) * (1 - v / 255)
    return Math.max(0, Math.min(255, Math.round(v * facteur)))
  }
  const corrige = (v: number, c: number): number => corrigeAvec(v, c, gain)

  const calque = Buffer.alloc(W * H * 4)
  let pixels = 0

  // POTEAUX D'EXTRÉMITÉ, recollage SÉLECTIF par tranches : seules les tranches
  // que Nano a vraiment abîmées (absorbées dans le stuc, déplacées) sont
  // recollées, à leur position d'ORIGINE. Les tranches intactes gardent le
  // rendu Nano — reflets de soleil compris. Chaque tranche recollée prend le
  // gain de la tranche intacte la plus proche (raccord de lumière local).
  for (const pt of poteaux) {
    const x0 = Math.max(0, pt.x)
    const x1 = Math.min(W - 1, pt.x + pt.w - 1)
    const yDeb = Math.max(0, cible.y)
    const yFin = Math.min(H - 1, cible.y + pH - 1)
    interface Bande {
      y0: number
      y1: number
      abime: boolean
      sommeE: number[]
      sommeS: number[]
      n: number
    }
    const bandes: Bande[] = []
    for (let by = yDeb; by <= yFin; by += POTEAU_BANDE_H_PX) {
      const be = Math.min(yFin, by + POTEAU_BANDE_H_PX - 1)
      const ech: { lE: number; lS: number }[] = []
      const sommeE = [0, 0, 0]
      const sommeS = [0, 0, 0]
      for (let y = by; y <= be; y += 2) {
        for (let x = x0; x <= x1; x += 2) {
          if (!garde(x, y)) continue
          const lS = lumSortie(x, y)
          if (lS < 0) continue
          const e = (y * W + x) * chB
          ech.push({ lE: (base.data[e] + base.data[e + 1] + base.data[e + 2]) / 3, lS })
          const rxp = Math.round(x * sx)
          const ryp = Math.round(y * sy)
          const s = (ryp * rendu.info.width + rxp) * chR
          for (let c = 0; c < 3; c++) {
            sommeE[c] += base.data[e + c]
            sommeS[c] += rendu.data[s + c]
          }
        }
      }
      const n = ech.length
      let abime = true
      if (n >= POTEAU_MIN_ECH_BANDE) {
        let mE = 0
        let mS = 0
        for (const q of ech) {
          mE += q.lE
          mS += q.lS
        }
        mE /= n
        mS /= n
        let s = 0
        for (const q of ech) s += Math.abs(q.lE - mE - (q.lS - mS))
        // Structure divergente (bords déplacés, stuc texturé) OU niveau moyen
        // très éloigné (poteau sombre devenu stuc clair) = tranche abîmée.
        abime = s / n > POTEAU_SEUIL_STRUCTURE || Math.abs(mS - mE) > POTEAU_ECART_MOYEN_MAX
      }
      bandes.push({ y0: by, y1: be, abime, sommeE, sommeS, n })
    }
    const gainLocal = (i: number): number[] => {
      let proche = -1
      let dist = Infinity
      for (let k = 0; k < bandes.length; k++) {
        if (bandes[k].abime || bandes[k].n < POTEAU_MIN_ECH_BANDE) continue
        const d = Math.abs(k - i)
        if (d < dist) {
          dist = d
          proche = k
        }
      }
      if (proche < 0) return gain
      const b = bandes[proche]
      const g = [1, 1, 1]
      for (let c = 0; c < 3; c++) {
        g[c] =
          b.sommeE[c] > 0
            ? Math.min(RECOLLE_GAIN_MAX, Math.max(RECOLLE_GAIN_MIN, b.sommeS[c] / b.sommeE[c]))
            : 1
      }
      return g
    }
    for (let i = 0; i < bandes.length; i++) {
      const b = bandes[i]
      if (!b.abime) continue
      const g = gainLocal(i)
      // Fondu vertical aux frontières avec une tranche gardée au rendu.
      const fonduHaut = i > 0 && !bandes[i - 1].abime
      const fonduBas = i < bandes.length - 1 && !bandes[i + 1].abime
      for (let y = b.y0; y <= b.y1; y++) {
        let f = 1
        if (fonduHaut) f = Math.min(f, (y - b.y0 + 1) / RECOLLE_FONDU_PX)
        if (fonduBas) f = Math.min(f, (b.y1 - y + 1) / RECOLLE_FONDU_PX)
        for (let x = x0; x <= x1; x++) {
          if (!garde(x, y)) continue
          const src = (y * W + x) * chB
          const dst = (y * W + x) * 4
          for (let c = 0; c < 3; c++) calque[dst + c] = corrigeAvec(base.data[src + c], c, g)
          calque[dst + 3] = Math.round(255 * f)
          pixels++
        }
      }
    }
  }

  // PIEDS hors poteaux (butée centrale, tige…) : recalage local PRUDENT puis
  // collage — les pieds sous un poteau sont déjà couverts par son patch.
  const piedsRestants = pieds.filter(
    (p) => !poteaux.some((pt) => p.x + p.w / 2 >= pt.x && p.x + p.w / 2 < pt.x + pt.w)
  )
  const lumEntree = (x: number, y: number): number => {
    const e = (y * W + x) * chB
    return (base.data[e] + base.data[e + 1] + base.data[e + 2]) / 3
  }
  // Corrélation glissante des gradients : décalage du pic, 0 si signal mou.
  const calePic = (gE: number[], gS: number[], max: number): number => {
    let auto = 0
    for (const g of gE) auto += g * g
    if (auto <= 0) return 0
    let meilleur = 0
    let bestC = -Infinity
    for (let d = -max; d <= max; d++) {
      let c = 0
      for (let i = 0; i < gE.length; i++) {
        const j = i + d
        if (j < 0 || j >= gS.length) continue
        c += gE[i] * gS[j]
      }
      if (c > bestC || (c === bestC && Math.abs(d) < Math.abs(meilleur))) {
        bestC = c
        meilleur = d
      }
    }
    return bestC >= auto * RECALE_CONFIANCE_MIN ? meilleur : 0
  }
  const gradient = (a: number[]): number[] => a.slice(1).map((v, i) => v - a[i])

  for (const p of piedsRestants) {
    // dx : bords verticaux du montant, bande de structure au-dessus du pied.
    const bandY0 = Math.max(0, p.y - RECALE_BANDE_HAUT_PX)
    const bandY1 = Math.max(bandY0 + 1, p.y - RECALE_BANDE_MARGE_PX)
    const profX0 = Math.max(0, p.x - RECALE_PROFIL_MARGE_X_PX)
    const profX1 = Math.min(W - 1, p.x + p.w - 1 + RECALE_PROFIL_MARGE_X_PX)
    const profilX = (lum: (x: number, y: number) => number): number[] => {
      const arr: number[] = []
      for (let x = profX0; x <= profX1; x++) {
        let s = 0
        let n = 0
        for (let y = bandY0; y < bandY1; y += 2) {
          const l = lum(x, y)
          if (l >= 0) {
            s += l
            n++
          }
        }
        arr.push(n ? s / n : 0)
      }
      return arr
    }
    const dxPied = calePic(gradient(profilX(lumEntree)), gradient(profilX(lumSortie)), RECALE_DX_MAX_PX)

    // dy : bords horizontaux (bas de vantail, ligne de sol) autour du pied,
    // sortie échantillonnée avec le dx déjà trouvé.
    const profY0 = Math.max(0, p.y - RECALE_BANDE_HAUT_PX)
    const profY1 = Math.min(H - 1, p.y + p.h - 1 + 40)
    const profilY = (lum: (x: number, y: number) => number, dx: number): number[] => {
      const arr: number[] = []
      for (let y = profY0; y <= profY1; y++) {
        let s = 0
        let n = 0
        for (let x = profX0; x <= profX1; x += 2) {
          const l = lum(x + dx, y)
          if (l >= 0) {
            s += l
            n++
          }
        }
        arr.push(n ? s / n : 0)
      }
      return arr
    }
    const dyPied = calePic(
      gradient(profilY((x, y) => (x >= 0 && x < W ? lumEntree(x, y) : -1), 0)),
      gradient(profilY(lumSortie, dxPied)),
      RECALE_DY_MAX_PX
    )

    const x1 = Math.min(W - 1, p.x + p.w - 1)
    const y1 = Math.min(H - 1, p.y + p.h - 1)
    for (let y = Math.max(0, p.y); y <= y1; y++) {
      for (let x = Math.max(0, p.x); x <= x1; x++) {
        if (!garde(x, y)) continue
        // Collage à la position RECALÉE (là où Nano a mis le montant).
        const xd = x + dxPied
        const yd = y + dyPied
        if (xd < 0 || yd < 0 || xd >= W || yd >= H) continue
        const src = (y * W + x) * chB
        const dst = (yd * W + xd) * 4
        for (let c = 0; c < 3; c++) calque[dst + c] = corrige(base.data[src + c], c)
        // Fondu du bord haut : le patch s'estompe vers le rendu Nano.
        const fondu = Math.min(1, (y - p.y + 1) / RECOLLE_FONDU_PX)
        calque[dst + 3] = Math.round(255 * fondu)
        pixels++
      }
    }
  }
  if (!pixels) return null

  let overlay = await sharp(calque, {
    raw: { width: W, height: H, channels: 4 },
    limitInputPixels: false,
  })
    .png()
    .toBuffer()
  if (rendu.info.width !== W || rendu.info.height !== H) {
    overlay = await sharp(overlay, { limitInputPixels: false })
      .resize(rendu.info.width, rendu.info.height, { fit: 'fill' })
      .png()
      .toBuffer()
  }
  return sharp(sortie, { limitInputPixels: false })
    .composite([{ input: overlay }])
    .png()
    .toBuffer()
}
