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
