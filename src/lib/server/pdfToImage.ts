import sharp from 'sharp'

/**
 * Conversion PDF → image (bloc 3.5, 13/07/2026). Les moodboards des gammes sur le
 * serveur sont des PDF ; le pipeline de décor a besoin d'une IMAGE. On rend la
 * PREMIÈRE page du PDF avec MuPDF (WASM — aucune compilation native, portable en
 * prod, pas de Ghostscript/Poppler système), puis sharp finalise le JPEG.
 *
 * Décidé avec Mathias : on convertit les moodboards PDF en JPG (13/07/2026).
 */

/** Rend la 1re page d'un PDF en PNG (buffer). `scale` 2 ≈ 144 dpi. */
async function pdfFirstPageToPng(pdfBuffer: Buffer, scale = 2): Promise<Buffer> {
  // Import dynamique : MuPDF est un module WASM/ESM (chargé côté Node uniquement).
  const mupdf = await import('mupdf')
  const doc = mupdf.Document.openDocument(new Uint8Array(pdfBuffer), 'application/pdf')
  try {
    if (doc.countPages() < 1) throw new Error('PDF sans page')
    const page = doc.loadPage(0)
    try {
      const pix = page.toPixmap(
        mupdf.Matrix.scale(scale, scale),
        mupdf.ColorSpace.DeviceRGB,
        false,
        true
      )
      try {
        return Buffer.from(pix.asPNG())
      } finally {
        pix.destroy()
      }
    } finally {
      page.destroy()
    }
  } finally {
    doc.destroy()
  }
}

/** Rend la 1re page d'un PDF en JPEG, éventuellement redimensionné en largeur. */
export async function pdfFirstPageToJpeg(
  pdfBuffer: Buffer,
  opts: { scale?: number; quality?: number; width?: number } = {}
): Promise<Buffer> {
  const png = await pdfFirstPageToPng(pdfBuffer, opts.scale ?? 2)
  let img = sharp(png)
  if (opts.width) img = img.resize({ width: opts.width, withoutEnlargement: true })
  return img.jpeg({ quality: opts.quality ?? 88 }).toBuffer()
}
