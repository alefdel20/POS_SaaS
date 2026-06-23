import { API_BASE_URL } from "../api/config";

const API_URL = API_BASE_URL;

function getApiOrigin() {
  try {
    const parsed = new URL(API_URL);
    return parsed.origin;
  } catch {
    return "";
  }
}

export function resolveProductImageUrl(imagePath?: string | null) {
  if (!imagePath) {
    return null;
  }

  if (/^https?:\/\//i.test(imagePath)) {
    return imagePath;
  }

  const origin = getApiOrigin();
  return origin ? `${origin}${imagePath}` : imagePath;
}

export const resolveUploadedAssetUrl = resolveProductImageUrl;
