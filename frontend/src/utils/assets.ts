const API_URL = (import.meta as any).env.VITE_API_BASE_URL || "http://pos-apis-chatbots-backen-kv6lbk-0befdc-31-97-214-24.traefik.me/api";

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
