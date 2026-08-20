/**
 * Rendering a markdown template into a seat brief.
 *
 * Prompts live as templates on disk, never string-assembled in code, so this
 * is the one place substitution happens. Rendering is total in both
 * directions: every template token must get a value and every value must have
 * a token, because a brief silently missing its evidence pack would still
 * read like a brief. Values are substituted in a single pass over the
 * template and never rescanned, so evidence content containing "{{" cannot
 * inject a second substitution.
 */

const TOKEN = /\{\{([a-z_]+)\}\}/gu;

export function templateTokens(template: string): ReadonlySet<string> {
  const names = new Set<string>();
  for (const match of template.matchAll(TOKEN)) {
    names.add(match[1] as string);
  }
  return names;
}

export function renderTemplate(
  template: string,
  vars: Readonly<Record<string, string>>,
): string {
  const tokens = templateTokens(template);
  for (const name of Object.keys(vars)) {
    if (!tokens.has(name)) throw new Error(`template has no {{${name}}} token`);
  }
  for (const name of tokens) {
    if (vars[name] === undefined) throw new Error(`no value for template token {{${name}}}`);
  }
  return template.replaceAll(TOKEN, (_whole, name: string) => vars[name] as string);
}
