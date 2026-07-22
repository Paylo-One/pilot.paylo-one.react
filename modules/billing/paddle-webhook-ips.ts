const LIVE_PADDLE_IPS_URL = "https://api.paddle.com/ips";
const CACHE_TTL_MS = 60 * 60 * 1000;

interface PaddleIpResponse {
  readonly data?: {
    readonly ipv4_cidrs?: readonly string[];
  };
}

let cachedLiveIpv4: { readonly addresses: ReadonlySet<string>; readonly expiresAt: number } | null =
  null;

function ipv4AddressFromCidr(cidr: string): string | null {
  const match = cidr.match(/^(\d{1,3}(?:\.\d{1,3}){3})\/32$/);
  if (!match) return null;
  const octets = match[1]!.split(".").map(Number);
  return octets.every((octet) => octet >= 0 && octet <= 255) ? match[1]! : null;
}

/**
 * Resolve the public client address as forwarded by the hosting edge.
 * Vercel overwrites x-forwarded-for before a request reaches a Function.
 */
export function requestClientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",", 1)[0]?.trim() || null;
}

/**
 * Fetch Paddle's current live webhook addresses. Paddle is the source of truth;
 * the list is deliberately not embedded in the application or environment.
 */
export async function livePaddleWebhookIps(
  fetcher: typeof fetch = fetch,
  now = Date.now(),
): Promise<ReadonlySet<string>> {
  if (cachedLiveIpv4 && cachedLiveIpv4.expiresAt > now) return cachedLiveIpv4.addresses;

  const response = await fetcher(LIVE_PADDLE_IPS_URL, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(2_000),
  });
  if (!response.ok) throw new Error(`Paddle IP lookup failed with HTTP ${response.status}`);

  const payload = (await response.json()) as PaddleIpResponse;
  const addresses = new Set(
    (payload.data?.ipv4_cidrs ?? [])
      .map(ipv4AddressFromCidr)
      .filter((address): address is string => address !== null),
  );
  if (addresses.size === 0) throw new Error("Paddle IP lookup returned no valid /32 IPv4 CIDRs");

  cachedLiveIpv4 = { addresses, expiresAt: now + CACHE_TTL_MS };
  return addresses;
}

export async function isLivePaddleWebhookRequest(request: Request): Promise<boolean> {
  const clientIp = requestClientIp(request);
  if (!clientIp) return false;
  return (await livePaddleWebhookIps()).has(clientIp);
}

export function clearPaddleIpCacheForTests(): void {
  cachedLiveIpv4 = null;
}
