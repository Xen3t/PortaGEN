import sharp from 'sharp'

/**
 * Redimensionne une image vers des dimensions exactes.
 * fit 'fill' = étirement (assumé pour le CANNY : ~1 % de distorsion, invisible sur du trait,
 * et il préserve les positions relatives — c'est ce qui compte pour le guidage).
 */
export async function resizeExact(
  input: Buffer | string,
  width: number,
  height: number,
  fit: 'fill' | 'cover' = 'fill'
): Promise<Buffer> {
  return sharp(input).resize({ width, height, fit }).png().toBuffer()
}

export async function imageSize(input: Buffer | string): Promise<{ width: number; height: number }> {
  const meta = await sharp(input).metadata()
  return { width: meta.width ?? 0, height: meta.height ?? 0 }
}
