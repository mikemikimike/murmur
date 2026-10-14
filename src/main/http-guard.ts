import type { IncomingMessage } from 'node:http';

/**
 * Request guards shared by Murmur's loopback HTTP servers (control panel, MCP).
 *
 * Binding to 127.0.0.1 is not enough on its own: with DNS rebinding a web
 * page on `evil.example` re-resolves its own hostname to 127.0.0.1 and then
 * talks to us "same-origin", so the browser's CORS checks never fire. The
 * attacker cannot forge the Host header though, so rejecting any Host that
 * is not a loopback name closes that hole.
 */

export function isLoopbackHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '127.0.0.1' || h === '::1';
}

/** True when the request's Host header names a loopback address. */
export function hasLoopbackHost(req: IncomingMessage): boolean {
  const host = req.headers.host;
  if (!host) return false;
  try {
    return isLoopbackHostname(new URL(`http://${host}`).hostname);
  } catch {
    return false;
  }
}

/**
 * True when the request has no Origin (non-browser clients such as MCP hosts
 * and curl) or an http(s) Origin on a loopback hostname. Browsers always send
 * Origin on cross-origin and state-changing requests, so a page on any other
 * site is rejected.
 */
export function hasLoopbackOriginOrNone(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      isLoopbackHostname(parsed.hostname)
    );
  } catch {
    return false;
  }
}
