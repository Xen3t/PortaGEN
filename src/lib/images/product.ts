import sharp from 'sharp'

/**
 * Préparation des images produit (portails détourés).
 *
 * 1. Détourage de secours : les PNG fournis par l'infographie ont normalement un fond
 *    transparent ; un fond uni clair est supprimé par remplissage depuis les bords
 *    (jamais l'intérieur du produit) ; un fond complexe n'est pas improvisé.
 * 2. Rognage des marges transparentes : le produit est recadré au pixel près sur sa
 *    boîte englobante — indispensable, sinon l'étirement vers la zone d'intégration
 *    inclut les marges et le produit « flotte » plus petit que son empreinte réelle.
 * 3. Retrait des piliers du visuel (option) : beaucoup de rendus produit incluent
 *    leurs propres piliers blancs de part et d'autre du portail ; dans la MES ce sont
 *    les piliers du décor qui encadrent le produit, ceux du visuel sont supprimés.
 */

export interface FlankZone {
  /** Colonnes (relatives à la boîte du produit) couvertes par le pilier */
  start: number
  end: number
  widthPx: number
}

export interface PillarDetection {
  left: FlankZone | null
  right: FlankZone | null
  /** true si la découpe a réellement été appliquée */
  applied: boolean
  /**
   * 'ok' : piliers retirés · 'aucun-pilier' : rien à retirer ·
   * 'ambigu' : zones blanches non concluantes (ex. portail blanc) — image conservée telle quelle ·
   * 'ratio-degrade' : la découpe donnerait des proportions incohérentes avec la taille attendue.
   */
  reason: 'ok' | 'aucun-pilier' | 'ambigu' | 'ratio-degrade'
  ratioBefore: number
  ratioAfter: number | null
}

export interface PrepareProductOptions {
  /** Détecte et supprime les piliers latéraux présents dans le visuel produit */
  removePillars?: boolean
  /** Taille nominale (cm) servant à valider les proportions après découpe */
  expectedSize?: { w: number; h: number } | null
}

export interface PreparedProduct {
  /** PNG avec transparence, rogné sur le produit */
  image: Buffer
  width: number
  height: number
  /** true si un détourage automatique a été appliqué */
  backgroundRemoved: boolean
  /** true si des marges (transparentes) ont été rognées */
  trimmed: boolean
  /** Détection des piliers du visuel (null si l'option n'était pas demandée) */
  pillars: PillarDetection | null
  /** Visuel de contrôle : zones supprimées en rouge, lignes de découpe en vert */
  annotated: Buffer | null
  /**
   * Dépassement des gonds : distance (px) entre le bord de l'image et le premier
   * montant du cadre (colonne pleine hauteur). Sert à caler la pose sur le CADRE,
   * les gonds venant chevaucher les piliers du décor. 0 si rien ne dépasse.
   */
  frameInsetLeftPx: number
  frameInsetRightPx: number
  /**
   * Dépassement sous les vantaux (tige de verrouillage, pieds de gonds) : distance (px)
   * entre le bas de l'image et la dernière ligne « pleine » des vantaux. Le bas des
   * vantaux se cale sur le sol, la quincaillerie déborde en dessous.
   */
  frameInsetBottomPx: number
}

const ALPHA_MIN = 10
// Colonne « pilier » : majoritairement blanche (clair et sans couleur marquée).
const WHITE_LUM = 185
const WHITE_CHROMA = 34
const WHITE_COL_FRACTION = 0.6
// Un pilier plausible fait entre 3 % et 20 % de la largeur du visuel.
const PILLAR_MIN_FRACTION = 0.03
const PILLAR_MAX_FRACTION = 0.2
// Colonnes sombres consécutives marquant la frontière pilier/portail
// (les gonds fixés sur le pilier ne suffisent pas à assombrir une colonne).
const PILLAR_DARK_RUN = 6
// Après découpe, écart toléré entre le ratio mesuré et la taille de la nomenclature
// (le chapeau de gendarme bombe la boîte englobante : ~6 % sur un 300x140 réel).
const PILLAR_RATIO_TOL = 0.15
// Montant du cadre : colonne opaque sur au moins la moitié de la hauteur du produit
// (un gond n'occupe que quelques centimètres ; un chapeau bombé garde ses côtés > 50 %).
const FRAME_COL_FRACTION = 0.5
// Dépassement de gond plausible : au-delà de 10 % de la largeur par côté, on n'y croit pas.
const FRAME_INSET_MAX_FRACTION = 0.1
// Largeur minimale d'un montant (bande soutenue) : 1 % de la largeur, au moins 3 colonnes.
const FRAME_MIN_RUN_FRACTION = 0.01
// Ligne « pleine » des vantaux : au moins 25 % de la largeur opaque (une tige de
// verrouillage ou des pieds de gonds n'atteignent jamais cette fraction).
const FRAME_ROW_FRACTION = 0.25

export async function prepareProduct(
  input: Buffer | string,
  opts: PrepareProductOptions = {}
): Promise<PreparedProduct> {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const W = info.width
  const H = info.height
  const n = W * H

  // Le produit est-il déjà détouré ? (transparence réelle quelque part)
  let hasAlpha = false
  for (let i = 0; i < n; i++) {
    if (data[i * 4 + 3] < 250) {
      hasAlpha = true
      break
    }
  }

  let rgba = data
  let backgroundRemoved = false
  if (!hasAlpha) {
    const removed = removeSolidBackground(data, W, H)
    if (removed) {
      rgba = removed
      backgroundRemoved = true
    }
  }

  // Rognage sur la boîte englobante de l'alpha.
  const box = bboxWithin(rgba, W, 0, W - 1, 0, H - 1)
  if (!box) {
    throw new Error('Image produit entièrement transparente')
  }
  const trimmed = box.minX > 0 || box.minY > 0 || box.maxX < W - 1 || box.maxY < H - 1

  // Retrait des piliers du visuel (option, avec garde-fous).
  let pillars: PillarDetection | null = null
  let annotated: Buffer | null = null
  let crop = {
    left: box.minX,
    top: box.minY,
    width: box.maxX - box.minX + 1,
    height: box.maxY - box.minY + 1,
  }
  if (opts.removePillars) {
    const res = await removeFlankingPillars(rgba, W, H, box, opts.expectedSize ?? null)
    pillars = res.detection
    annotated = res.annotated
    if (res.crop) crop = res.crop
  }

  // Dépassement des gonds par rapport aux montants du cadre (pose calée sur le cadre).
  let frameInsetLeftPx = 0
  let frameInsetRightPx = 0
  let frameInsetBottomPx = 0
  if (opts.removePillars) {
    const insets = frameInsets(rgba, W, crop)
    frameInsetLeftPx = insets.left
    frameInsetRightPx = insets.right
    frameInsetBottomPx = insets.bottom
  }

  const image = await sharp(rgba, { raw: { width: W, height: H, channels: 4 } })
    .extract(crop)
    .png()
    .toBuffer()

  return {
    image,
    width: crop.width,
    height: crop.height,
    backgroundRemoved,
    trimmed,
    pillars,
    annotated,
    frameInsetLeftPx,
    frameInsetRightPx,
    frameInsetBottomPx,
  }
}

/**
 * Distance entre chaque bord du produit et le premier montant du cadre (colonne
 * opaque sur ≥ 50 % de la hauteur). Les gonds, poignées ou butées qui dépassent
 * de la boîte englobante n'atteignent jamais cette fraction.
 */
function frameInsets(
  rgba: Buffer,
  W: number,
  crop: { left: number; top: number; width: number; height: number }
): { left: number; right: number; bottom: number } {
  const colOpaque = new Array<number>(crop.width).fill(0)
  const rowOpaque = new Array<number>(crop.height).fill(0)
  for (let y = crop.top; y < crop.top + crop.height; y++) {
    for (let x = crop.left; x < crop.left + crop.width; x++) {
      if (rgba[(y * W + x) * 4 + 3] > ALPHA_MIN) {
        colOpaque[x - crop.left]++
        rowOpaque[y - crop.top]++
      }
    }
  }
  const isFrame = (c: number) => colOpaque[c] >= crop.height * FRAME_COL_FRACTION
  // Un montant est une bande SOUTENUE de colonnes pleine hauteur : les résidus de bord
  // de pilier (2-3 colonnes d'ombre de transition) ne comptent pas.
  const run = Math.max(3, Math.round(crop.width * FRAME_MIN_RUN_FRACTION))
  const sustained = (c: number, step: 1 | -1) => {
    for (let k = 0; k < run; k++) {
      const x = c + k * step
      if (x < 0 || x >= crop.width || !isFrame(x)) return false
    }
    return true
  }
  let left = 0
  while (left < crop.width && !sustained(left, 1)) left++
  let rightCol = crop.width - 1
  while (rightCol >= 0 && !sustained(rightCol, -1)) rightCol--
  // Bas des vantaux : dernière ligne « pleine » soutenue (la tige de verrouillage et
  // les pieds de gonds qui dépassent en dessous n'occupent que quelques % de largeur).
  const isFrameRow = (rw: number) => rowOpaque[rw] >= crop.width * FRAME_ROW_FRACTION
  const rowRun = Math.max(3, Math.round(crop.height * FRAME_MIN_RUN_FRACTION))
  const sustainedRow = (rw: number) => {
    for (let k = 0; k < rowRun; k++) {
      if (rw - k < 0 || !isFrameRow(rw - k)) return false
    }
    return true
  }
  let bottomRow = crop.height - 1
  while (bottomRow >= 0 && !sustainedRow(bottomRow)) bottomRow--
  let bottom = bottomRow < 0 ? 0 : crop.height - 1 - bottomRow
  if (bottom > crop.height * FRAME_INSET_MAX_FRACTION) bottom = 0

  if (rightCol < left) return { left: 0, right: 0, bottom } // aucun montant : produit atypique
  const right = crop.width - 1 - rightCol
  const max = crop.width * FRAME_INSET_MAX_FRACTION
  return { left: left <= max ? left : 0, right: right <= max ? right : 0, bottom }
}

interface Box {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** Boîte englobante des pixels opaques dans la fenêtre donnée (bornes incluses). */
function bboxWithin(
  rgba: Buffer,
  W: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number
): Box | null {
  let minX = x1 + 1
  let minY = y1 + 1
  let maxX = -1
  let maxY = -1
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (rgba[(y * W + x) * 4 + 3] > ALPHA_MIN) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  return maxX === -1 ? null : { minX, minY, maxX, maxY }
}

/**
 * Détection des piliers latéraux du visuel produit, colonne par colonne :
 * depuis chaque bord, une suite de colonnes majoritairement blanches est un pilier ;
 * la frontière avec le portail est une série de colonnes sombres persistantes.
 * La découpe n'est appliquée que si elle est concluante (largeurs plausibles, ratio
 * cohérent avec la nomenclature) — sinon l'image est conservée telle quelle.
 */
async function removeFlankingPillars(
  rgba: Buffer,
  W: number,
  H: number,
  box: Box,
  expected: { w: number; h: number } | null
): Promise<{
  detection: PillarDetection
  annotated: Buffer | null
  crop: { left: number; top: number; width: number; height: number } | null
}> {
  const boxW = box.maxX - box.minX + 1
  const boxH = box.maxY - box.minY + 1

  // Profil par colonne : pixels opaques, et parmi eux pixels « blancs ».
  const colOpaque = new Array<number>(boxW).fill(0)
  const colWhite = new Array<number>(boxW).fill(0)
  for (let y = box.minY; y <= box.maxY; y++) {
    for (let x = box.minX; x <= box.maxX; x++) {
      const o = (y * W + x) * 4
      if (rgba[o + 3] <= ALPHA_MIN) continue
      const c = x - box.minX
      colOpaque[c]++
      const r = rgba[o]
      const g = rgba[o + 1]
      const b = rgba[o + 2]
      const lum = 0.299 * r + 0.587 * g + 0.114 * b
      const chroma = Math.max(r, g, b) - Math.min(r, g, b)
      if (lum > WHITE_LUM && chroma < WHITE_CHROMA) colWhite[c]++
    }
  }
  const isPillarColumn = (c: number) =>
    colOpaque[c] > boxH * 0.05 && colWhite[c] / Math.max(1, colOpaque[c]) >= WHITE_COL_FRACTION

  const scan = (from: 'left' | 'right'): FlankZone | null => {
    const step = from === 'left' ? 1 : -1
    let x = from === 'left' ? 0 : boxW - 1
    while (x >= 0 && x < boxW && colOpaque[x] <= boxH * 0.05) x += step
    if (x < 0 || x >= boxW || !isPillarColumn(x)) return null
    const start = x
    let last = x
    let dark = 0
    while (x >= 0 && x < boxW) {
      if (isPillarColumn(x)) {
        dark = 0
        last = x
      } else if (++dark > PILLAR_DARK_RUN) {
        break
      }
      x += step
    }
    return {
      start: Math.min(start, last),
      end: Math.max(start, last),
      widthPx: Math.abs(last - start) + 1,
    }
  }

  const left = scan('left')
  const right = scan('right')
  const qualifies = (z: FlankZone | null) =>
    !!z && z.widthPx >= boxW * PILLAR_MIN_FRACTION && z.widthPx <= boxW * PILLAR_MAX_FRACTION
  const overwide = (z: FlankZone | null) => !!z && z.widthPx > boxW * PILLAR_MAX_FRACTION
  const leftOk = qualifies(left)
  const rightOk = qualifies(right)

  const ratioBefore = boxW / boxH
  let applied = false
  let reason: PillarDetection['reason'] = 'aucun-pilier'
  let ratioAfter: number | null = null
  let crop: { left: number; top: number; width: number; height: number } | null = null

  if (!leftOk && !rightOk) {
    reason = overwide(left) || overwide(right) ? 'ambigu' : 'aucun-pilier'
  } else {
    const cutL = leftOk && left ? left.end + 1 : 0
    const cutR = rightOk && right ? right.start - 1 : boxW - 1
    // Le portail restant doit occuper une part substantielle du visuel.
    const gate =
      cutR - cutL + 1 >= boxW * 0.3
        ? bboxWithin(rgba, W, box.minX + cutL, box.minX + cutR, box.minY, box.maxY)
        : null
    if (!gate) {
      reason = 'ambigu'
    } else {
      const gateW = gate.maxX - gate.minX + 1
      const gateH = gate.maxY - gate.minY + 1
      ratioAfter = gateW / gateH
      if (expected) {
        const exp = expected.w / expected.h
        if (Math.abs(ratioAfter - exp) / exp <= PILLAR_RATIO_TOL) {
          applied = true
          reason = 'ok'
        } else {
          reason = 'ratio-degrade'
        }
      } else if (
        leftOk &&
        rightOk &&
        left &&
        right &&
        Math.max(left.widthPx, right.widthPx) / Math.min(left.widthPx, right.widthPx) <= 2.5
      ) {
        // Sans taille de référence : deux piliers de largeurs comparables exigés.
        applied = true
        reason = 'ok'
      } else {
        reason = 'ambigu'
      }
      if (applied) {
        crop = { left: gate.minX, top: gate.minY, width: gateW, height: gateH }
      }
    }
  }

  // Visuel de contrôle (rouge = zones piliers, vert = lignes de découpe appliquées).
  let annotated: Buffer | null = null
  if (reason !== 'aucun-pilier') {
    const rects = [left, right]
      .filter((z): z is FlankZone => !!z)
      .map(
        (z) =>
          `<rect x="${z.start}" y="0" width="${z.widthPx}" height="${boxH}" fill="red" fill-opacity="0.35"/>`
      )
      .join('')
    const lines = crop
      ? `<line x1="${crop.left - box.minX}" y1="0" x2="${crop.left - box.minX}" y2="${boxH}" stroke="#00c000" stroke-width="4"/>
         <line x1="${crop.left - box.minX + crop.width - 1}" y1="0" x2="${crop.left - box.minX + crop.width - 1}" y2="${boxH}" stroke="#00c000" stroke-width="4"/>`
      : ''
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${boxW}" height="${boxH}">${rects}${lines}</svg>`
    const basePng = await sharp(rgba, { raw: { width: W, height: H, channels: 4 } })
      .extract({ left: box.minX, top: box.minY, width: boxW, height: boxH })
      .png()
      .toBuffer()
    annotated = await sharp(basePng)
      .flatten({ background: '#f0f0f0' })
      .composite([{ input: Buffer.from(svg) }])
      .png()
      .toBuffer()
  }

  return {
    detection: { left, right, applied, reason, ratioBefore, ratioAfter },
    annotated,
    crop,
  }
}

/**
 * Suppression d'un fond UNI clair par remplissage depuis les bords.
 * Retourne le buffer RGBA modifié, ou null si le fond n'est pas exploitable
 * (non uniforme / sombre) — dans ce cas on ne touche à rien.
 */
function removeSolidBackground(data: Buffer, W: number, H: number): Buffer | null {
  const n = W * H
  const corner = (x: number, y: number) => {
    const o = (y * W + x) * 4
    return [data[o], data[o + 1], data[o + 2]] as const
  }
  const corners = [corner(0, 0), corner(W - 1, 0), corner(0, H - 1), corner(W - 1, H - 1)]
  const avg = [0, 1, 2].map((c) => corners.reduce((a, k) => a + k[c], 0) / 4)
  const coherent = corners.every((k) => k.every((v, c) => Math.abs(v - avg[c]) < 18))
  const bright = (avg[0] + avg[1] + avg[2]) / 3 > 160
  if (!coherent || !bright) return null

  const TOL = 26
  const isBackground = (i: number) => {
    const o = i * 4
    return (
      Math.abs(data[o] - avg[0]) < TOL &&
      Math.abs(data[o + 1] - avg[1]) < TOL &&
      Math.abs(data[o + 2] - avg[2]) < TOL
    )
  }
  const visited = new Uint8Array(n)
  const queue = new Int32Array(n)
  let qh = 0
  let qt = 0
  for (let x = 0; x < W; x++) {
    for (const i of [x, (H - 1) * W + x]) {
      if (!visited[i] && isBackground(i)) {
        visited[i] = 1
        queue[qt++] = i
      }
    }
  }
  for (let y = 0; y < H; y++) {
    for (const i of [y * W, y * W + W - 1]) {
      if (!visited[i] && isBackground(i)) {
        visited[i] = 1
        queue[qt++] = i
      }
    }
  }
  while (qh < qt) {
    const i = queue[qh++]
    const x = i % W
    const neighbors = [
      x > 0 ? i - 1 : -1,
      x < W - 1 ? i + 1 : -1,
      i - W >= 0 ? i - W : -1,
      i + W < n ? i + W : -1,
    ]
    for (const j of neighbors) {
      if (j < 0 || visited[j] || !isBackground(j)) continue
      visited[j] = 1
      queue[qt++] = j
    }
  }
  const out = Buffer.from(data)
  for (let i = 0; i < n; i++) {
    if (visited[i]) out[i * 4 + 3] = 0
  }
  return out
}

export { parseSizeFromProductName } from '@/lib/productName'
