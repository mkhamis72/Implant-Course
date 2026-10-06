const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * The Host header as a canonical host name: lower case, no port, no trailing dot.
 * IP addresses and anything that isn't a host name give null (they never match a company).
 */
export function normaliseHost(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let host = raw.trim().toLowerCase();
  if (!host || host.startsWith('[')) return null;
  host = host.replace(/:\d+$/, '').replace(/\.$/, '');
  if (host.length > 253) return null;
  const labels = host.split('.');
  if (!labels.every((l) => LABEL.test(l))) return null;
  if (labels.every((l) => /^\d+$/.test(l))) return null;
  return host;
}
