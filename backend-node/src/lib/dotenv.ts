/**
 * .env parser with python-dotenv's rules, so the .env written for Django reads the same:
 *  - KEY=value, optional "export " prefix, blank lines and "# comments" ignored;
 *  - unquoted values: a comment starts only at " #" (whitespace before "#"), so secret keys
 *    containing "#" stay intact (Node's built-in parser would cut them);
 *  - 'single quotes' are literal; "double quotes" support \n, \t, \", \\ escapes;
 *  - ${VAR} is expanded in unquoted and double-quoted values (like load_dotenv's default).
 */

export function parseDotEnv(text: string, env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const result: Record<string, string> = {};
  const lookup = (name: string) => env[name] ?? result[name] ?? '';
  const expand = (value: string) => value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (_, name: string, fallback = '') => lookup(name) || fallback);

  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1];
    let rest = match[2];

    if (rest.startsWith("'") || rest.startsWith('"')) {
      const quote = rest[0];
      // A quoted value may span several lines.
      while (!new RegExp(`^${quote}(?:\\\\.|[^${quote}\\\\])*${quote}`).test(rest) && i + 1 < lines.length) {
        rest += `\n${lines[++i]}`;
      }
      const quoted = new RegExp(`^${quote}((?:\\\\.|[^${quote}\\\\])*)${quote}`).exec(rest);
      const inner = quoted ? quoted[1] : rest.slice(1);
      result[key] =
        quote === "'"
          ? inner.replace(/\\'/g, "'")
          : expand(inner.replace(/\\(.)/g, (_, ch: string) => ({ n: '\n', t: '\t', r: '\r' })[ch] ?? ch));
      continue;
    }

    const comment = rest.search(/\s#/);
    if (comment !== -1) rest = rest.slice(0, comment);
    result[key] = expand(rest.trim());
  }
  return result;
}
