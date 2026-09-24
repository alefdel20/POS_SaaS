const TOKEN_KEY = "pos_app_token";
const THEME_KEY_PREFIX = "pos_app_theme_";

export function getStoredToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearStoredToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export function getStoredTheme(businessId?: number | null) {
  if (!businessId) return null;
  return localStorage.getItem(`${THEME_KEY_PREFIX}${businessId}`);
}

export function setStoredTheme(businessId: number, theme: "light" | "dark") {
  localStorage.setItem(`${THEME_KEY_PREFIX}${businessId}`, theme);
}

const BUNDLE_SKIPPED_KEY_PREFIX = "pos_app_bundle_skipped_";

// Por sesion (sessionStorage): "empezar sin productos" no debe rebotar al wizard
// en cada recarga, pero tampoco lo oculta para siempre mientras no se confirme.
export function isBundleSkipped(businessId?: number | null) {
  if (!businessId) return false;
  try {
    return sessionStorage.getItem(`${BUNDLE_SKIPPED_KEY_PREFIX}${businessId}`) === "1";
  } catch {
    return false;
  }
}

export function setBundleSkipped(businessId?: number | null) {
  if (!businessId) return;
  try {
    sessionStorage.setItem(`${BUNDLE_SKIPPED_KEY_PREFIX}${businessId}`, "1");
  } catch {
    // sin storage disponible: el wizard puede reaparecer al recargar
  }
}
