/**
 * Flag drift: does the installed CLI's help still document every flag a
 * launch profile uses? Three fast-moving CLIs mean flags rot in weeks; thin
 * glue must fail loudly. Help text is evidence of
 * documentation, not of behavior; behavior belongs to the live smoke.
 */

export function profileFlagsOf(args: readonly string[]): readonly string[] {
  return [
    ...new Set(
      args
        .filter((arg) => arg.startsWith("--") || /^-[A-Za-z]$/u.test(arg))
        .map((arg) => arg.split("=")[0] as string),
    ),
  ];
}

/** Flags the help text never mentions. An empty result means no known drift. */
export function undocumentedFlags(
  args: readonly string[],
  helpText: string,
): readonly string[] {
  return profileFlagsOf(args).filter((flag) => !documentsFlag(helpText, flag));
}

function documentsFlag(helpText: string, flag: string): boolean {
  const escaped = flag.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9_-])${escaped}(?=$|[^A-Za-z0-9_-])`, "mu").test(helpText);
}
