export function shouldProbeSessionForChrome(
  pathname: string,
  isAuthenticated: boolean,
) {
  return pathname === "/" && !isAuthenticated;
}

export function getEffectiveChromeAuth(
  loaderAuthenticated: boolean,
  probedAuthenticated: boolean,
) {
  return loaderAuthenticated || probedAuthenticated;
}
