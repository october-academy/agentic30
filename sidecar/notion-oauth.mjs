import { auth } from "@modelcontextprotocol/sdk/client/auth.js";

const NOTION_MCP_URL = "https://mcp.notion.com/mcp";

// Custom scheme redirect_uri — ASWebAuthenticationSession intercepts the
// redirect before the system tries to open it, extracting the auth code.
const REDIRECT_URI = "agentic30://oauth/callback";

const log = (...args) => process.stderr.write(`[notion-oauth] ${args.join(" ")}\n`);

/**
 * In-memory OAuthClientProvider for the MCP SDK auth flow.
 * The redirect URI is a localhost URL that the WKWebView intercepts
 * before the browser navigates there (no HTTP server needed).
 */
class NotionOAuthProvider {
  constructor() {
    this._redirectUrl = new URL(REDIRECT_URI);
    this._clientInfo = undefined;
    this._tokens = undefined;
    this._codeVerifier = undefined;
    this._authUrl = null;
    this._discoveryState = undefined;
  }

  get redirectUrl() {
    return this._redirectUrl;
  }

  get clientMetadata() {
    return {
      redirect_uris: [REDIRECT_URI],
      client_name: "agentic30",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  clientInformation() {
    return this._clientInfo;
  }

  saveClientInformation(info) {
    log("Client registered:", info.client_id);
    this._clientInfo = info;
  }

  tokens() {
    return this._tokens;
  }

  saveTokens(tokens) {
    log("Tokens received, access_token length:", tokens?.access_token?.length || 0);
    this._tokens = tokens;
  }

  redirectToAuthorization(authorizationUrl) {
    log("Authorization URL:", authorizationUrl.toString().slice(0, 200));
    this._authUrl = authorizationUrl;
  }

  saveCodeVerifier(codeVerifier) {
    log("PKCE code verifier saved");
    this._codeVerifier = codeVerifier;
  }

  codeVerifier() {
    if (!this._codeVerifier) throw new Error("No PKCE code verifier saved");
    return this._codeVerifier;
  }

  saveDiscoveryState(discoveryState) {
    log("Discovery state saved");
    this._discoveryState = discoveryState;
  }

  discoveryState() {
    return this._discoveryState;
  }
}

// Module-level provider so exchangeOAuthCode can access the same state
let activeProvider = null;

/**
 * Initiate the Notion MCP OAuth flow.
 *
 * Uses the MCP SDK auth() function for discovery, registration, and PKCE.
 * Returns the authorization URL for the app to load in a WKWebView.
 * The WKWebView intercepts the callback redirect and extracts the code,
 * then the app calls exchangeOAuthCode() to complete the flow.
 *
 * @param {object} options
 * @param {(url: string) => void} [options.onAuthUrl] Called with the auth URL
 * @returns {Promise<object>} Result with authUrl or alreadyAuthorized flag
 */
export async function initiateNotionOAuth({ onAuthUrl } = {}) {
  const provider = new NotionOAuthProvider();

  log("Starting OAuth flow via MCP SDK auth()...");
  const result = await auth(provider, { serverUrl: new URL(NOTION_MCP_URL) });
  log("auth() returned:", result);

  if (result === "AUTHORIZED") {
    return { alreadyAuthorized: true, provider };
  }

  if (!provider._authUrl) {
    throw new Error("OAuth REDIRECT but no authorization URL was produced.");
  }

  // Store provider for the second phase (code exchange)
  activeProvider = provider;

  const authUrl = provider._authUrl.toString();
  log("Auth URL ready:", authUrl.slice(0, 120));
  onAuthUrl?.(authUrl);

  return { alreadyAuthorized: false, authUrl };
}

/**
 * Exchange the authorization code received from the native app's WKWebView.
 * This completes the OAuth flow started by initiateNotionOAuth().
 *
 * @param {string} code - Authorization code from the intercepted callback URL
 * @returns {Promise<object>} OAuth result with tokens
 */
export async function exchangeOAuthCode(code) {
  if (!activeProvider) {
    throw new Error("No active OAuth flow. Call initiateNotionOAuth() first.");
  }

  const provider = activeProvider;
  activeProvider = null;

  log("Exchanging authorization code for tokens...");
  const result = await auth(provider, {
    serverUrl: new URL(NOTION_MCP_URL),
    authorizationCode: code,
  });
  log("Token exchange auth() returned:", result);

  if (result !== "AUTHORIZED") {
    throw new Error(`Token exchange returned "${result}" instead of "AUTHORIZED".`);
  }

  return extractResult(provider);
}

function extractResult(provider) {
  const tokens = provider._tokens;
  if (!tokens?.access_token) {
    throw new Error("OAuth completed but no access token received.");
  }

  const asMeta = provider._discoveryState?.authorizationServerMetadata;
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || null,
    expiresIn: tokens.expires_in || null,
    expiresAt: tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      : null,
    clientId: provider._clientInfo?.client_id || null,
    clientSecret: provider._clientInfo?.client_secret || null,
    tokenEndpoint: asMeta?.token_endpoint || null,
  };
}

/**
 * Refresh an expired access token using a refresh token.
 */
export async function refreshAccessToken(tokenEndpoint, clientId, refreshToken) {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
  });

  const res = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Token refresh failed (${res.status}): ${errBody}`);
  }

  return await res.json();
}
