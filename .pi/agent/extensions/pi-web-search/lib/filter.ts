// Domain allow/block filtering. Pure functions, no dependencies.

export function normalizeDomain(domain: string): string {
  const value = domain.trim();
  if (!value) return "";

  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    const hostname = url.hostname.toLowerCase().replace(/\.$/u, "");
    if (!hostname) throw new Error("empty hostname");
    return hostname;
  } catch {
    throw new Error(`Invalid domain: ${domain}`);
  }
}

export function normalizeDomains(domains: string[] | undefined): string[] {
  const input = domains ?? [];
  for (const raw of input) {
    if (raw.trim().length === 0) {
      throw new Error(`Invalid domain: ${raw}`);
    }
  }
  return [
    ...new Set(
      input.map((domain) => normalizeDomain(domain)).filter((domain) => domain.length > 0),
    ),
  ];
}

export function hostnameOf(url: string): string | undefined {
  try {
    const noSlashes = url.replace(/^\/\//u, "");
    const u = new URL(noSlashes.includes("://") ? noSlashes : `https://${noSlashes}`);
    const hostname = u.hostname.toLowerCase().replace(/\.$/u, "");
    return hostname || undefined;
  } catch {
    return undefined;
  }
}

export function isDomainMatch(url: string, domains: string[]): boolean {
  const hostname = hostnameOf(url);
  if (!hostname) return false;
  return domains.some(
    (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
  );
}
