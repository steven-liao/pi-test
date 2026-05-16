/**
 * Permission System Extension — Utility Functions
 *
 * Lightweight glob matching (no external dependencies).
 * Supports: *, **, ?, {a,b} on both / and \\ path separators.
 */

/**
 * Convert a glob pattern to a regular expression.
 * Supports:
 *   - `*`       matches any chars except path separator
 *   - `**`      matches any chars including path separators
 *   - `?`       matches a single char except path separator
 *   - `{a,b}`   alternation
 */
function globToRegex(pattern: string): RegExp {
  let src = "";

  // Normalize separators
  const normalized = pattern.replace(/\\/g, "/");

  let i = 0;
  while (i < normalized.length) {
    const ch = normalized[i];

    if (ch === "*" && normalized[i + 1] === "*" && (normalized[i + 2] === "/" || normalized[i + 2] === undefined)) {
      // ** — match everything
      src += ".*";
      if (normalized[i + 2] === "/") i += 3;
      else i += 2;
      continue;
    }

    if (ch === "*") {
      // * — match within a single path component
      src += "[^/]*";
      i++;
      continue;
    }

    if (ch === "?") {
      src += "[^/]";
      i++;
      continue;
    }

    if (ch === "{") {
      // {a,b} alternation
      const end = normalized.indexOf("}", i);
      if (end === -1) {
        src += "\\{";
        i++;
        continue;
      }
      const inner = normalized.slice(i + 1, end);
      const alts = inner.split(",").map((a) => a.trim()).filter(Boolean);
      src += "(?:" + alts.map((a) => globToRegex(a).source.replace(/^\^|\$$/g, "")).join("|") + ")";
      i = end + 1;
      continue;
    }

    // Escape special regex chars
    if ("+().^$|\\[]".includes(ch)) {
      src += "\\" + ch;
    } else {
      src += ch;
    }
    i++;
  }

  return new RegExp("^" + src + "$", "i");
}

const globCache = new Map<string, RegExp>();

/**
 * Test if a path matches a glob pattern.
 *
 * @param path   The file path to test (e.g., ".env.local", "src/components/foo.ts")
 * @param pattern The glob pattern (e.g., ".env*", "src/**\/*.ts")
 * @param options Optional settings (currently supports `dot` for matching dotfiles)
 * @returns true if path matches pattern
 */
export function minimatch(path: string, pattern: string, _options?: { dot?: boolean }): boolean {
  // Normalize separators
  const normalizedPath = path.replace(/\\/g, "/");
  const cacheKey = `${normalizedPath}::${pattern}`;

  const cached = globCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const regex = globToRegex(pattern);
  const result = regex.test(normalizedPath);

  // Simple bounded cache
  if (globCache.size > 500) globCache.clear();
  globCache.set(cacheKey, result);

  return result;
}
