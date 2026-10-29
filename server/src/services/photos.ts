import sharp from 'sharp';

export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
export const MAX_SIDE = 1280;

export class PhotoError extends Error {
  constructor(message: string, public status = 415) {
    super(message);
  }
}

export type ProcessedPhoto = { data: Buffer; width: number; height: number; bytes: number };

// Valida pelo CONTEÚDO (não pelo nome nem pelo cabeçalho), aplica a rotação do EXIF, reduz e
// regrava em WebP sem nenhum metadado (remove GPS, modelo do aparelho, data etc.).
export async function processPhoto(input: Buffer): Promise<ProcessedPhoto> {
  try {
    const probe = await sharp(input, { limitInputPixels: 100_000_000 }).metadata();
    if (!probe.format || !['jpeg', 'png', 'webp'].includes(probe.format)) {
      throw new PhotoError('Formato não aceito. Envie uma foto JPEG, PNG ou WebP.');
    }
    const { data, info } = await sharp(input, { limitInputPixels: 100_000_000 })
      .rotate()
      .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height, bytes: data.length };
  } catch (error) {
    if (error instanceof PhotoError) throw error;
    throw new PhotoError('Não foi possível ler essa imagem. Tente outra foto (JPEG, PNG ou WebP).');
  }
}
