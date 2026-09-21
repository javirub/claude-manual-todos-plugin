/**
 * Signing this machine in, by the device grant (RFC 8628).
 *
 * The flow exists because the alternatives are worse here. A personal access
 * token means pasting a secret into a terminal and then into a file, tied to a
 * person rather than to a computer. Authorization code with PKCE needs a
 * loopback listener, which is awkward over SSH and collides with the port the
 * board already uses. This prints a short code, the person approves it in
 * whatever browser they have, and what comes back belongs to this device alone —
 * so losing a laptop costs one revocation rather than a password change.
 */
import { writeCredentials, type Credentials } from "./credentials";

const CLIENT_ID = "todos-cli";
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

export interface DeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string | null;
  expiresIn: number;
  interval: number;
}

export async function requestDeviceCode(api: string): Promise<DeviceCode> {
  const response = await fetch(`${api.replace(/\/+$/, "")}/oauth2/device_authorization`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID, scope: "tasks.read tasks.write" }),
  });
  if (!response.ok) throw new Error(`${api} did not offer a device code (${response.status}).`);

  const body = (await response.json()) as Record<string, unknown>;
  return {
    deviceCode: String(body.device_code),
    userCode: String(body.user_code),
    verificationUri: String(body.verification_uri),
    verificationUriComplete: body.verification_uri_complete ? String(body.verification_uri_complete) : null,
    expiresIn: Number(body.expires_in) || 300,
    // RFC 8628 says five seconds when the server does not say otherwise.
    interval: Number(body.interval) || 5,
  };
}

export interface PollOptions {
  onSlowDown?: (interval: number) => void;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Waits for the person to approve the code.
 *
 * `authorization_pending` is the normal answer and not an error; `slow_down`
 * means we are asking too often and the interval must go up, permanently, for
 * the rest of this attempt. Ignoring either is how a client gets itself
 * rate-limited out of its own login.
 */
export async function pollForToken(
  api: string,
  device: DeviceCode,
  options: PollOptions = {},
): Promise<Credentials> {
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  let interval = device.interval;
  const deadline = Date.now() + device.expiresIn * 1000;

  while (Date.now() < deadline) {
    await sleep(interval * 1000);

    const response = await fetch(`${api.replace(/\/+$/, "")}/oauth2/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        grant_type: DEVICE_GRANT,
        device_code: device.deviceCode,
      }),
    });
    const body = (await response.json()) as Record<string, unknown>;

    if (response.ok && body.access_token) {
      const credentials: Credentials = {
        api,
        accessToken: String(body.access_token),
        refreshToken: body.refresh_token ? String(body.refresh_token) : null,
        expiresAt: Date.now() + (Number(body.expires_in) || 3600) * 1000,
      };
      writeCredentials(credentials);
      return credentials;
    }

    const error = String(body.error ?? "");
    if (error === "authorization_pending") continue;
    if (error === "slow_down") {
      interval += 5;
      options.onSlowDown?.(interval);
      continue;
    }
    if (error === "access_denied") throw new Error("The request was declined in the browser.");
    if (error === "expired_token") break;
    throw new Error(`Sign-in failed: ${body.error_description ?? (error || response.status)}.`);
  }
  throw new Error("The code expired before it was approved. Run `todos login` again.");
}

/** Renews an access token, or returns null when the refresh token is spent too. */
export async function refreshAccessToken(credentials: Credentials): Promise<Credentials | null> {
  if (!credentials.refreshToken) return null;

  const response = await fetch(`${credentials.api.replace(/\/+$/, "")}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: credentials.refreshToken,
    }),
  });
  if (!response.ok) return null;

  const body = (await response.json()) as Record<string, unknown>;
  if (!body.access_token) return null;

  const next: Credentials = {
    api: credentials.api,
    accessToken: String(body.access_token),
    // Rotated on every use, so keeping the old one would sign us out next time.
    refreshToken: body.refresh_token ? String(body.refresh_token) : credentials.refreshToken,
    expiresAt: Date.now() + (Number(body.expires_in) || 3600) * 1000,
  };
  writeCredentials(next);
  return next;
}
