const DEFAULT_REFRESH_SKEW_MS = 30_000;
const FAILED_EXCHANGE_BACKOFF_MS = 60_000;

/**
 * Keeps a short-lived MemoryStack session ticket in the MCP server process.
 * API-key auth remains the fallback, so older MemoryStack deployments and
 * transient ticket-exchange failures never prevent a coding task from running.
 */
export function createSessionAuthenticator({
  fetchImpl,
  baseUrl,
  apiKey,
  now = () => Date.now(),
  refreshSkewMs = DEFAULT_REFRESH_SKEW_MS,
}) {
  let accessToken = null;
  let expiresAt = 0;
  let nextExchangeAttemptAt = 0;
  let exchangeInFlight = null;

  function clearTicket() {
    accessToken = null;
    expiresAt = 0;
  }

  function hasFreshTicket() {
    return Boolean(accessToken) && now() < expiresAt - refreshSkewMs;
  }

  async function exchange() {
    if (exchangeInFlight) return exchangeInFlight;
    exchangeInFlight = (async () => {
      try {
        const response = await fetchImpl(`${baseUrl}/auth/session`, {
          signal: AbortSignal.timeout(3_000),
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
        });
        if (!response.ok) {
          nextExchangeAttemptAt = now() + FAILED_EXCHANGE_BACKOFF_MS;
          return null;
        }

        const data = await response.json().catch(() => null);
        const expiresIn = data?.expires_in;
        if (
          typeof data?.access_token !== "string"
          || !data.access_token.startsWith("msst_v1.")
          || !Number.isFinite(expiresIn)
          || expiresIn < 60
        ) {
          nextExchangeAttemptAt = now() + FAILED_EXCHANGE_BACKOFF_MS;
          return null;
        }

        accessToken = data.access_token;
        expiresAt = now() + Math.min(expiresIn, 15 * 60) * 1_000;
        nextExchangeAttemptAt = 0;
        return accessToken;
      } catch {
        nextExchangeAttemptAt = now() + FAILED_EXCHANGE_BACKOFF_MS;
        return null;
      } finally {
        exchangeInFlight = null;
      }
    })();
    return exchangeInFlight;
  }

  async function getCredential() {
    if (hasFreshTicket()) return { credential: accessToken, isSessionTicket: true };
    if (now() < nextExchangeAttemptAt) return { credential: apiKey, isSessionTicket: false };

    const ticket = await exchange();
    return ticket
      ? { credential: ticket, isSessionTicket: true }
      : { credential: apiKey, isSessionTicket: false };
  }

  return { clearTicket, getCredential, hasFreshTicket };
}

/**
 * Clerk may inspect arbitrary Bearer tokens before the public API route runs.
 * MemoryStack tickets therefore use the already-supported X-API-Key transport,
 * while opaque API keys retain their standard Bearer compatibility.
 */
export function getRequestAuthHeaders(credential, isSessionTicket) {
  return isSessionTicket
    ? { "X-API-Key": credential }
    : { Authorization: `Bearer ${credential}` };
}
