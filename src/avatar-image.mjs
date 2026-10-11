// Avatar images stay client-side until the already validated profile payload
// is saved. Crop to a square and encode a small data URL so a normal phone
// photo does not turn the profile request into a multi-megabyte upload.
import { MAX_CUSTOM_AVATAR_LENGTH } from '../public/shared.mjs';

export const AVATAR_MAX_DIMENSION = 256;
export const AVATAR_MAX_DATA_URL_LENGTH = MAX_CUSTOM_AVATAR_LENGTH;

const SOURCE_TYPES = /^image\/(?:png|jpe?g|webp|gif)$/i;
const DATA_URL = /^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/i;

export function isAvatarImageType(type) {
  return SOURCE_TYPES.test(String(type || ''));
}

export function isBoundedAvatarDataUrl(value) {
  return typeof value === 'string' && value.length <= AVATAR_MAX_DATA_URL_LENGTH && DATA_URL.test(value);
}

function loadImage(file) {
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('avatarDecode')); };
    image.src = url;
  });
}

async function decodeImage(file) {
  if (typeof globalThis.createImageBitmap === 'function') {
    try { return await globalThis.createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* fall back to Image */ }
  }
  return loadImage(file);
}

function releaseImage(image) {
  if (typeof image?.close === 'function') image.close();
}

function encodedCandidates(canvas) {
  // WebP is much smaller for portraits while retaining transparent clouds.
  // Older browsers may return PNG despite the requested type; the JPEG
  // fallback below keeps the payload bounded in those browsers too.
  const qualities = [0.84, 0.74, 0.64, 0.54, 0.44];
  const result = [];
  for (const quality of qualities) {
    result.push(canvas.toDataURL('image/webp', quality));
    result.push(canvas.toDataURL('image/jpeg', quality));
  }
  return result;
}

export async function imageFileToAvatarDataUrl(file) {
  if (!file || !isAvatarImageType(file.type)) throw new Error('avatarType');
  const image = await decodeImage(file);
  try {
    const sourceWidth = Number(image.width || image.naturalWidth);
    const sourceHeight = Number(image.height || image.naturalHeight);
    if (!sourceWidth || !sourceHeight) throw new Error('avatarDecode');
    const edge = Math.min(sourceWidth, sourceHeight);
    const sourceX = (sourceWidth - edge) / 2;
    const sourceY = (sourceHeight - edge) / 2;
    for (const dimension of [AVATAR_MAX_DIMENSION, 224, 192, 160]) {
      const canvas = document.createElement('canvas');
      canvas.width = dimension;
      canvas.height = dimension;
      const context = canvas.getContext('2d', { alpha: true });
      if (!context) throw new Error('avatarCanvas');
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(image, sourceX, sourceY, edge, edge, 0, 0, dimension, dimension);
      for (const candidate of encodedCandidates(canvas)) {
        if (isBoundedAvatarDataUrl(candidate)) return candidate;
      }
    }
    throw new Error('avatarTooLarge');
  } finally {
    releaseImage(image);
  }
}
