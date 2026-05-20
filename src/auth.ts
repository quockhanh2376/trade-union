import { AUTH_CACHE_TTL_MS } from "./constants";

let authSessionExpiresAt = 0;
let authCacheExpiryLogged = false;

export function hasActiveAuthSession(): boolean {
  return authSessionExpiresAt > Date.now();
}

export function rememberAuthSession(): void {
  authSessionExpiresAt = Date.now() + AUTH_CACHE_TTL_MS;
  authCacheExpiryLogged = false;
}

export function clearAuthSession(): void {
  authSessionExpiresAt = 0;
  authCacheExpiryLogged = false;
}

function isAuthCacheExpired(): boolean {
  return authSessionExpiresAt > 0 && !hasActiveAuthSession();
}

export function autoExpireAuthCache(logFn: (msg: string) => void): void {
  if (authCacheExpiryLogged) return;
  if (!isAuthCacheExpired()) return;
  authSessionExpiresAt = 0;
  authCacheExpiryLogged = true;
  logFn("Microsoft admin auth session expired after 10 minutes.");
}
