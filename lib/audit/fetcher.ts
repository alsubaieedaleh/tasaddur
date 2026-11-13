import dns from "node:dns/promises";
import net from "node:net";

export const USER_AGENT = "TasaddurBot/1.0 (+https://tasaddur.sa/bot; SEO audit)";
const MAX_BYTES = 3 * 1024 * 1024;
const MAX_REDIRECTS = 5;

export interface FetchResult {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  ms: number;
  bytes: number;
  body: string;
  headers: Record<string, string>;
  redirects: string[];
  error?: string;
}

/** Turns "  HTTPS://Www.Example.sa/path?x " into "www.example.sa". Returns null when it isn't a public hostname. */
export function normalizeDomain(input: string): string | null {
  let s = (input || "").trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = "http://" + s;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (u.port && !allowPrivate()) return null;
  if (allowPrivate() && (host === "localhost" || net.isIP(host))) return u.port ? `${host}:${u.port}` : host;
  if (net.isIP(host)) return null;
  if (!/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/.test(host)) return null;
  return host;
}

function allowPrivate(): boolean {
  return process.env.ALLOW_PRIVATE_HOSTS === "1";
}

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224
    );
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return isPrivateIp(v.slice(7));
  return v === "::" || v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
}

/** Blocks requests to internal networks (SSRF protection). */
async function assertPublicHost(hostname: string): Promise<void> {
  if (allowPrivate()) return;
  const addrs = net.isIP(hostname) ? [{ address: hostname }] : await dns.lookup(hostname, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error("blocked_host");
}

async function readLimited(res: Response): Promise<{ text: string; bytes: number }> {
  if (!res.body) return { text: "", bytes: 0 };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_BYTES) {
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  const buf = Buffer.concat(chunks);
  return { text: new TextDecoder("utf-8", { fatal: false }).decode(buf), bytes };
}

/** GET a URL, following redirects manually so every hop is checked against private networks. */
export async function safeFetch(url: string, timeoutMs = 12000, readBody = true): Promise<FetchResult> {
  const started = Date.now();
  const redirects: string[] = [];
  let current = url;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const u = new URL(current);
      if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("bad_protocol");
      await assertPublicHost(u.hostname);
      const res = await fetch(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "accept-language": "ar-SA,ar;q=0.9,en;q=0.8" },
      });
      const loc = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && loc) {
        await res.body?.cancel();
        redirects.push(current);
        current = new URL(loc, current).toString();
        continue;
      }
      const ttfb = Date.now() - started;
      const { text, bytes } = readBody ? await readLimited(res) : { text: "", bytes: 0 };
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => (headers[k] = v));
      return { requestedUrl: url, finalUrl: current, status: res.status, ms: ttfb, bytes, body: text, headers, redirects };
    }
    throw new Error("too_many_redirects");
  } catch (e) {
    const msg = e instanceof Error ? (e.name === "AbortError" ? "timeout" : e.message) : String(e);
    return { requestedUrl: url, finalUrl: current, status: 0, ms: Date.now() - started, bytes: 0, body: "", headers: {}, redirects, error: msg };
  } finally {
    clearTimeout(timer);
  }
}
