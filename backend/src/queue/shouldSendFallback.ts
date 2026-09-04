export function shouldSendFallbackEmail(anyUserActiveSinceAlert: boolean[]): boolean {
  return !anyUserActiveSinceAlert.some((active) => active);
}
