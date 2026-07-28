import sharp from 'sharp'

/**
 * RALify — traitement du PNG produit (chantier 28/07/2026). Portage de la
 * méthode du space HF Xenet/RALify_7016 de Mathias (processing.py, OpenCV) :
 * recoloration dans l'espace CIELAB vers la teinte RAL cible en CONSERVANT la
 * luminance relative — les ombres, reflets et le relief du visuel d'origine
 * restent, seule la teinte est ramenée au RAL.
 *
 * Différences avec le space :
 * - le masque n'est plus un seuil sur fond blanc (fragile) mais le canal ALPHA
 *   du PNG détouré — exactement la matière du produit ;
 * - PROTECTION DE LA QUINCAILLERIE (retour Mathias 28/07 : poignée et serrure
 *   recolorées = inacceptable) : la couleur DOMINANTE de la matière est mesurée
 *   (médianes L/a/b, robustes aux petits éléments), et seuls les pixels qui lui
 *   ressemblent sont traités. Poignée noire, inox clair, trou de serrure…
 *   s'écartent de la dominante → intacts, avec un fondu progressif pour éviter
 *   toute frontière visible.
 *
 * Détail (fidèle à recolor_lab_preserve_luminance) :
 * - a et b (la teinte) : interpolés vers la cible selon intensité × protection ;
 * - L (la clarté) : multiplié par (L cible / L moyen de la matière TRAITÉE) —
 *   le contraste clair/sombre est préservé, la clarté MOYENNE rejoint la cible.
 */

export interface RalifyResult {
  /** PNG recoloré (alpha intact). */
  image: Buffer
  /** Pixels de matière traités (ressemblent à la dominante). */
  pixelsTraites: number
  /** Pixels de matière PROTÉGÉS (poignée, serrure… trop loin de la dominante). */
  pixelsProteges: number
  /** Couleur moyenne de la matière traitée AVANT, pour contrôle. */
  avantHex: string
  /** Couleur moyenne de la matière traitée APRÈS. */
  apresHex: string
  /** Dominante mesurée et tolérances retenues (contrôle / calibration). */
  stats: { medL: number; medA: number; medB: number; sigL: number; sigA: number; sigB: number; tolL: number; tolAb: number }
}

// --- sRGB (0-255) ↔ CIELAB (D65), conversions standard ---

const LIN = new Float32Array(256)
for (let i = 0; i < 256; i++) {
  const v = i / 255
  LIN[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

function linearToSrgb(v: number): number {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055
  return Math.min(255, Math.max(0, Math.round(c * 255)))
}

// Blanc de référence D65.
const Xn = 0.95047
const Yn = 1.0
const Zn = 1.08883

function labF(t: number): number {
  return t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29
}

function labFInv(t: number): number {
  const t3 = t * t * t
  return t3 > 216 / 24389 ? t3 : (108 / 841) * (t - 4 / 29)
}

export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const rl = LIN[r]
  const gl = LIN[g]
  const bl = LIN[b]
  const fx = labF((0.4124564 * rl + 0.3575761 * gl + 0.1804375 * bl) / Xn)
  const fy = labF((0.2126729 * rl + 0.7151522 * gl + 0.072175 * bl) / Yn)
  const fz = labF((0.0193339 * rl + 0.119192 * gl + 0.9503041 * bl) / Zn)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

export function labToRgb(L: number, a: number, b: number): [number, number, number] {
  const fy = (L + 16) / 116
  const fx = fy + a / 500
  const fz = fy - b / 200
  const x = labFInv(fx) * Xn
  const y = labFInv(fy) * Yn
  const z = labFInv(fz) * Zn
  return [
    linearToSrgb(3.2404542 * x - 1.5371385 * y - 0.4985314 * z),
    linearToSrgb(-0.969266 * x + 1.8760108 * y + 0.041556 * z),
    linearToSrgb(0.0556434 * x - 0.2040259 * y + 1.0572252 * z),
  ]
}

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ]
}

const toHex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')

/** Valeur au percentile p (0-1) d'un histogramme, en unité de bin. */
function percentile(hist: Float64Array | Uint32Array, total: number, p: number): number {
  const seuil = total * p
  let cum = 0
  for (let i = 0; i < hist.length; i++) {
    cum += hist[i]
    if (cum >= seuil) return i
  }
  return hist.length - 1
}

/**
 * Poids de protection : 1 tant que l'écart tient dans la tolérance, fondu
 * linéaire jusqu'à 0 à 1,7 × tolérance — pas de frontière visible.
 */
function poids(distance: number, tolerance: number): number {
  if (distance <= tolerance) return 1
  const fin = tolerance * 1.7
  if (distance >= fin) return 0
  return (fin - distance) / (fin - tolerance)
}

/**
 * Recolore la matière DOMINANTE du PNG (alpha > 0) vers `cibleHex`, intensité
 * 0-100. La quincaillerie (couleur trop éloignée de la dominante) est protégée.
 * PNG sans matière (tout transparent) : rendu inchangé.
 */
export async function appliquerRalify(
  input: Buffer | string,
  cibleHex: string,
  intensitePct: number
): Promise<RalifyResult> {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const n = info.width * info.height
  const s = Math.min(100, Math.max(0, intensitePct)) / 100
  const rendu = () =>
    sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
      .png()
      .toBuffer()

  // Passe 1 — la couleur DOMINANTE de la matière : histogrammes de L (bins de
  // 0,25) et de a/b (bins de 1, décalés de +128), médianes et écarts robustes
  // (interquartile → sigma). Les médianes ignorent les petits éléments (poignée,
  // serrure) qui fausseraient une moyenne.
  const histL = new Uint32Array(401)
  const histA = new Uint32Array(256)
  const histB = new Uint32Array(256)
  let count = 0
  for (let i = 0; i < n; i++) {
    const o = i * 4
    if (data[o + 3] === 0) continue
    const [L, a, b] = rgbToLab(data[o], data[o + 1], data[o + 2])
    histL[Math.min(400, Math.max(0, Math.round(L * 4)))]++
    histA[Math.min(255, Math.max(0, Math.round(a) + 128))]++
    histB[Math.min(255, Math.max(0, Math.round(b) + 128))]++
    count++
  }
  if (count === 0) {
    const vide = { medL: 0, medA: 0, medB: 0, sigL: 0, sigA: 0, sigB: 0, tolL: 0, tolAb: 0 }
    return { image: await rendu(), pixelsTraites: 0, pixelsProteges: 0, avantHex: '#000000', apresHex: '#000000', stats: vide }
  }
  const medL = percentile(histL, count, 0.5) / 4
  const medA = percentile(histA, count, 0.5) - 128
  const medB = percentile(histB, count, 0.5) - 128
  const iqr = (h: Uint32Array, scale: number) =>
    (percentile(h, count, 0.75) - percentile(h, count, 0.25)) / scale
  const sigL = iqr(histL, 4) / 1.349
  const sigA = iqr(histA, 1) / 1.349
  const sigB = iqr(histB, 1) / 1.349
  // Tolérances : 3 sigmas robustes, avec des planchers pour les visuels très
  // uniformes (rendus 3D plats) — le léger modelé de la matière reste traité.
  // Planchers SERRÉS (calibrés sur l'ARLBERG, 28/07) : sa poignée gris neutre a
  // la MÊME clarté que la matière anthracite, seul l'écart de teinte (≈ 5,6 en
  // a/b) la distingue — un plancher a/b au-delà de 3 la ferait recolorer.
  const tolL = Math.max(8, 3 * sigL)
  const tolAb = Math.max(3, 3 * Math.hypot(sigA, sigB))
  const stats = { medL, medA, medB, sigL, sigA, sigB, tolL, tolAb }

  // Passe 2 — poids de protection PAR PIXEL, quantifié 0-255. Les PNG
  // fournisseur gardent du bruit de compression : un pixel de matière isolé peut
  // s'écarter de la dominante et ressortirait moucheté si on le protégeait seul.
  const wq = new Uint8Array(n)
  const mq = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const o = i * 4
    if (data[o + 3] === 0) continue
    const [L, a, b] = rgbToLab(data[o], data[o + 1], data[o + 2])
    const w = poids(Math.abs(L - medL), tolL) * poids(Math.hypot(a - medA, b - medB), tolAb)
    wq[i] = Math.round(w * 255)
    mq[i] = 255
  }

  // Lissage de la carte de protection (anti-moucheté) : moyenne locale du poids,
  // normalisée par la matière présente (la transparence ne dilue pas les bords).
  // Le voisinage décide : le bruit isolé suit sa zone, la quincaillerie (zones
  // entières) reste protégée. Rayon calé sur la définition de l'image (les blocs
  // de compression font ~8 px sur les grands visuels).
  const W = info.width
  const H = info.height
  const R = Math.max(2, Math.min(8, Math.round(Math.min(W, H) / 700)))
  const wh = new Uint32Array(n)
  const mh = new Uint32Array(n)
  for (let y = 0; y < H; y++) {
    const row = y * W
    let sw2 = 0
    let sm2 = 0
    for (let x = 0; x <= Math.min(R, W - 1); x++) {
      sw2 += wq[row + x]
      sm2 += mq[row + x]
    }
    for (let x = 0; x < W; x++) {
      wh[row + x] = sw2
      mh[row + x] = sm2
      const add = x + R + 1
      const del = x - R
      if (add < W) {
        sw2 += wq[row + add]
        sm2 += mq[row + add]
      }
      if (del >= 0) {
        sw2 -= wq[row + del]
        sm2 -= mq[row + del]
      }
    }
  }
  for (let x = 0; x < W; x++) {
    let sw2 = 0
    let sm2 = 0
    for (let y = 0; y <= Math.min(R, H - 1); y++) {
      sw2 += wh[y * W + x]
      sm2 += mh[y * W + x]
    }
    for (let y = 0; y < H; y++) {
      const i = y * W + x
      // wq est réécrit avec le poids LISSÉ (les sommes wh/mh ne bougent plus).
      if (mq[i] !== 0) wq[i] = sm2 > 0 ? Math.round((sw2 / sm2) * 255) : wq[i]
      const add = y + R + 1
      const del = y - R
      if (add < H) {
        sw2 += wh[add * W + x]
        sm2 += mh[add * W + x]
      }
      if (del >= 0) {
        sw2 -= wh[del * W + x]
        sm2 -= mh[del * W + x]
      }
    }
  }

  // Passe 3 — clarté et couleur moyennes de la matière TRAITÉE (pondérées par la
  // protection lissée) : le facteur L est global, c'est lui qui préserve le contraste.
  let sumW = 0
  let sumL = 0
  let sr = 0
  let sg = 0
  let sb = 0
  let traites = 0
  let proteges = 0
  for (let i = 0; i < n; i++) {
    const o = i * 4
    if (mq[i] === 0) continue
    const w = wq[i] / 255
    if (w >= 0.5) traites++
    else proteges++
    const [L] = rgbToLab(data[o], data[o + 1], data[o + 2])
    sumW += w
    sumL += w * L
    sr += w * data[o]
    sg += w * data[o + 1]
    sb += w * data[o + 2]
  }
  if (sumW < 1) {
    // Toute la matière est « protégée » (cas dégénéré) : on ne touche à rien.
    return { image: await rendu(), pixelsTraites: 0, pixelsProteges: proteges, avantHex: '#000000', apresHex: '#000000', stats }
  }
  const avantHex = toHex(sr / sumW, sg / sumW, sb / sumW)
  const meanL = sumL / sumW
  const [tR, tG, tB] = hexToRgb(cibleHex)
  const [tL, ta, tb] = rgbToLab(tR, tG, tB)
  // Facteur de clarté : la moyenne de la matière rejoint la cible, le relief est
  // conservé. L'intensité et la protection s'y appliquent pixel par pixel.
  const lFactor = meanL > 0.5 ? tL / meanL - 1 : 0

  // Passe 4 — recoloration, pondérée par intensité × protection lissée.
  let s2r = 0
  let s2g = 0
  let s2b = 0
  for (let i = 0; i < n; i++) {
    const o = i * 4
    if (mq[i] === 0) continue
    const w = wq[i] / 255
    const sw = s * w
    if (sw > 0) {
      const [L, a, b] = rgbToLab(data[o], data[o + 1], data[o + 2])
      const [r2, g2, b2] = labToRgb(
        Math.min(100, Math.max(0, L * (1 + sw * lFactor))),
        a * (1 - sw) + ta * sw,
        b * (1 - sw) + tb * sw
      )
      data[o] = r2
      data[o + 1] = g2
      data[o + 2] = b2
    }
    s2r += w * data[o]
    s2g += w * data[o + 1]
    s2b += w * data[o + 2]
  }
  return {
    image: await rendu(),
    pixelsTraites: traites,
    pixelsProteges: proteges,
    avantHex,
    apresHex: toHex(s2r / sumW, s2g / sumW, s2b / sumW),
    stats,
  }
}
