import dns from "node:dns";
import net from "node:net";
import { Agent, fetch as undiciFetch } from "undici";

export const USER_AGENT = "Mozilla/5.0 (compatible; TasaddurBot/1.0; +https://tasaddur.onrender.com/bot)";
const MAX_HTML_BYTES = 1.5 * 1024 * 1024;
const MAX_REDIRECTS = 5;

export interface FetchResult {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  /** Time to response headers of the final hop (ms). */
  ms: number;
  bytes: number;
  body: string;
  headers: Record<string, string>;
  redirects: string[];
  error?: string;
}

function allowPrivate(): boolean {
  return process.env.ALLOW_PRIVATE_HOSTS === "1";
}

/** Turns "  HTTPS://Www.Example.sa/path?x " into "example.sa". Returns null when it isn't a public hostname. */
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
  const host = u.hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  if (allowPrivate() && (host === "localhost" || net.isIP(host))) return u.port ? `${host}:${u.port}` : host;
  if (u.port) return null;
  if (net.isIP(host.replace(/^\[|\]$/g, ""))) return null;
  if (!/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(xn--[a-z0-9-]{2,59}|[a-z]{2,63})$/.test(host)) return null;
  return host;
}

const blocked = new net.BlockList();
for (const [addr, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(addr, prefix, "ipv4");
for (const [addr, prefix] of [
  ["::", 128], ["::1", 128], ["::", 96], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64], ["2001:db8::", 32], ["2002::", 16],
  ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
] as const) blocked.addSubnet(addr, prefix, "ipv6");

/** Extracts an embedded IPv4 from IPv4-mapped (::ffff:a.b.c.d / ::ffff:7f00:1) IPv6 addresses. */
function embeddedV4(ip: string): string | null {
  const v = ip.toLowerCase();
  const dotted = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return dotted[1];
  const hex = v.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const a = parseInt(hex[1], 16);
    const b = parseInt(hex[2], 16);
    return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;
  }
  return null;
}

export function isPrivateIp(ip: string): boolean {
  const v4 = net.isIPv4(ip) ? ip : embeddedV4(ip);
  if (v4) return blocked.check(v4, "ipv4");
  if (net.isIPv6(ip)) return blocked.check(ip, "ipv6");
  return true;
}

/**
 * DNS lookup used by the HTTP agent itself, so the address we validate is the address we connect to
 * (prevents DNS rebinding between a check and the connection).
 */
function safeLookup(
  hostname: string,
  options: dns.LookupOptions,
  cb: (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void,
): void {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return cb(err, "");
    const list = (addresses as dns.LookupAddress[]).filter((a) => allowPrivate() || !isPrivateIp(a.address));
    if (!list.length) return cb(Object.assign(new Error("blocked_host"), { code: "EBLOCKED" }), "");
    if (options.all) cb(null, list);
    else cb(null, list[0].address, list[0].family);
  });
}

const agent = new Agent({ connect: { lookup: safeLookup as never, timeout: 10_000 }, headersTimeout: 15_000, bodyTimeout: 15_000 });

function checkUrl(u: URL): void {
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("bad_protocol");
  if (allowPrivate()) return;
  if (u.port && u.port !== "80" && u.port !== "443") throw new Error("blocked_port");
  const literal = u.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(literal) && isPrivateIp(literal)) throw new Error("blocked_host");
}

function charsetOf(contentType: string, head: Uint8Array): string {
  const fromHeader = contentType.match(/charset=["']?([\w-]+)/i)?.[1];
  if (fromHeader) return fromHeader.toLowerCase();
  const sniff = Buffer.from(head.subarray(0, 2048)).toString("latin1");
  const fromMeta = sniff.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1];
  return (fromMeta || "utf-8").toLowerCase();
}

function decode(buf: Buffer, contentType: string): string {
  try {
    return new TextDecoder(charsetOf(contentType, buf), { fatal: false }).decode(buf);
  } catch {
    return new TextDecoder("utf-8", { fatal: false }).decode(buf);
  }
}

async function readLimited(res: Awaited<ReturnType<typeof undiciFetch>>, limit: number): Promise<{ buf: Buffer; bytes: number }> {
  if (!res.body) return { buf: Buffer.alloc(0), bytes: 0 };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > limit) {
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  return { buf: Buffer.concat(chunks), bytes };
}

/** GET a URL, following redirects manually so every hop is checked against private networks and ports. */
export async function safeFetch(url: string, timeoutMs = 12000, readBody = true): Promise<FetchResult> {
  const started = Date.now();
  let hopStart = started;
  const redirects: string[] = [];
  let current = url;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      checkUrl(new URL(current));
      hopStart = Date.now();
      const res = await undiciFetch(current, {
        redirect: "manual",
        signal: controller.signal,
        dispatcher: agent,
        headers: {
          "user-agent": USER_AGENT,
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "ar-SA,ar;q=0.9,en;q=0.8",
          "accept-encoding": "br, gzip, deflate",
        },
      });
      const loc = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && loc) {
        await res.body?.cancel();
        redirects.push(current);
        current = new URL(loc, current).toString();
        continue;
      }
      // Time of the final hop only, so redirect chains don't inflate the server response time.
      const ttfb = Date.now() - hopStart;
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => (headers[k] = v));
      let body = "";
      let bytes = 0;
      if (readBody) {
        const r = await readLimited(res, MAX_HTML_BYTES);
        bytes = r.bytes;
        body = decode(r.buf, headers["content-type"] || "");
      } else {
        await res.body?.cancel();
      }
      return { requestedUrl: url, finalUrl: current, status: res.status, ms: ttfb, bytes, body, headers, redirects };
    }
    throw new Error("too_many_redirects");
  } catch (e) {
    const err = e as Error & { cause?: { code?: string; message?: string } };
    const blockedHost = err.cause?.code === "EBLOCKED" || err.message === "blocked_host";
    const msg = err.name === "AbortError" ? "timeout" : blockedHost ? "blocked_host" : err.message;
    return { requestedUrl: url, finalUrl: current, status: 0, ms: Date.now() - started, bytes: 0, body: "", headers: {}, redirects, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

/** Cloudflare / WAF challenge pages served instead of the real site. */
export function isBotChallenge(r: FetchResult): boolean {
  if (![403, 429, 503].includes(r.status)) return false;
  return !!r.headers["cf-mitigated"] || /Just a moment|cf-chl|challenge-platform|Attention Required|captcha/i.test(r.body.slice(0, 20000));
}
