export function safeNextPath(nextPath: string): string {
  return nextPath.startsWith("/") && !nextPath.startsWith("//")
    ? nextPath
    : "/onboarding";
}

export function magicLinkRedirectUrl(origin: string, nextPath: string): string {
  return `${origin}/auth/confirm?next=${encodeURIComponent(safeNextPath(nextPath))}`;
}
