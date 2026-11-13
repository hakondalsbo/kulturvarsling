/**
 * signUp kan returnere user uten session når e-postbekreftelse er på.
 * Bare user og session sammen betyr at brukeren er innlogget.
 */
export function registreringErInnlogget(
  data: { user?: unknown; session?: unknown } | null | undefined,
): boolean {
  return !!(data?.user && data.session);
}
