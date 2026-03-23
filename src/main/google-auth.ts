import type { OAuth2Client, Credentials } from 'google-auth-library';
import { google } from 'googleapis';
import crypto from 'crypto';
import {
  getGoogleClientId,
  getGoogleClientSecret,
  getGoogleRedirectUri,
} from './google-secrets.ts';
import { getSetting, saveSetting } from '../core/database.ts';
import { GOOGLE_DRIVE_SCOPES, GOOGLE_TOKENS_KEY } from '../core/constants.ts';
import { encrypt, decrypt } from '../core/utils/encryption.ts';

let oauth2Client: OAuth2Client | null = null;
// Store the pending code verifier for PKCE flow.
// This assumes single-user context (local desktop app).
let pendingCodeVerifier: string | null = null;

export function initializeManualCredentials(credentials: Credentials): void {
  const client = getOAuth2Client();
  client.setCredentials(credentials);
}

export function getOAuth2Client(): OAuth2Client {
  if (!oauth2Client) {
    const clientId = getGoogleClientId();
    const clientSecret = getGoogleClientSecret();
    const redirectUri = getGoogleRedirectUri();

    if (!clientId || !clientSecret) {
      throw new Error(
        'Google OAuth credentials not configured. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in your .env file.',
      );
    }
    oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    const initializedClient = oauth2Client;

    // [PERSISTENCE] Automatically save tokens whenever they are refreshed
    const tokenEventsClient = oauth2Client as OAuth2Client & {
      on?: (event: 'tokens', listener: (tokens: Credentials) => void) => void;
    };

    tokenEventsClient.on?.('tokens', (tokens) => {
      // Merge tokens into current credentials to ensure we don't lose existing ones
      initializedClient.setCredentials({
        ...initializedClient.credentials,
        ...tokens,
      });
      saveCredentials(initializedClient).catch((err) => {
        console.error(
          '[GoogleAuth] Failed to auto-save refreshed tokens:',
          err,
        );
      });
    });
  }
  return oauth2Client;
}

export async function loadSavedCredentialsIfExist(): Promise<boolean> {
  try {
    const content = await getSetting(GOOGLE_TOKENS_KEY);
    if (!content) {
      return false;
    }

    // Attempt to decrypt. If it fails (legacy plaintext), it returns original content.
    // If it looks like encrypted data but decryption fails (wrong key), it returns null.
    const decrypted = decrypt(content);
    if (!decrypted) {
      console.warn(
        '[GoogleAuth] Failed to decrypt saved credentials. A re-authorization may be required.',
      );
      return false;
    }
    const credentials = JSON.parse(decrypted);

    const client = getOAuth2Client();
    client.setCredentials(credentials);
    console.log('[GoogleAuth] Successfully loaded saved credentials from DB.');
    return true;
  } catch (error) {
    console.error('[GoogleAuth] Failed to load credentials from DB:', error);
    return false;
  }
}

export async function checkGoogleDriveAuth(): Promise<boolean> {
  try {
    const auth = getOAuth2Client();
    if (auth.credentials && auth.credentials.refresh_token) {
      return true;
    }
    return await loadSavedCredentialsIfExist();
  } catch {
    return false;
  }
}

export async function saveCredentials(client: OAuth2Client): Promise<void> {
  try {
    const json = JSON.stringify(client.credentials);
    const encrypted = encrypt(json);
    await saveSetting(GOOGLE_TOKENS_KEY, encrypted);
  } catch (error: unknown) {
    console.error('Failed to save credentials to DB:', error);
    throw error;
  }
}

/**
 * Encodes a buffer to Base64URL format (no padding).
 */
function base64UrlEncode(str: Buffer): string {
  return str
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * Generates a random code verifier for PKCE.
 */
function generateCodeVerifier(): string {
  return base64UrlEncode(crypto.randomBytes(32));
}

/**
 * Generates a code challenge from the verifier (S256).
 */
function generateCodeChallenge(verifier: string): string {
  return base64UrlEncode(crypto.createHash('sha256').update(verifier).digest());
}

export function generateAuthUrl(): string {
  const client = getOAuth2Client();

  // [SECURITY] Implement PKCE (Proof Key for Code Exchange)
  // This mitigates authorization code interception attacks.
  const verifier = generateCodeVerifier();
  const challenge = generateCodeChallenge(verifier);

  // Store the verifier for the callback exchange step
  pendingCodeVerifier = verifier;

  return client.generateAuthUrl({
    access_type: 'offline',
    scope: GOOGLE_DRIVE_SCOPES,
    prompt: 'consent',
    code_challenge: challenge,
    // The library uses an enum for CodeChallengeMethod, but 'S256' as a string is the underlying value.
    // However, TypeScript requires the enum or a cast if strict.
    // We cast to any to avoid importing the enum from deep within google-auth-library which might be fragile.
    // @ts-expect-error - 'S256' is the correct string value for the enum expected by the library type definition
    code_challenge_method: 'S256',
  });
}

export async function authenticateWithCode(code: string): Promise<void> {
  const client = getOAuth2Client();

  try {
    const verifier = pendingCodeVerifier;

    if (!verifier) {
      throw new Error(
        'Code verifier not found. The authentication flow may have been interrupted. Please try again.',
      );
    }

    // Pass the stored verifier if available (it should be for this flow)
    const { tokens } = await client.getToken({
      code,
      codeVerifier: verifier,
    });

    client.setCredentials(tokens);
    await saveCredentials(client);
  } finally {
    // Clear the verifier after attempt (success or failure) to prevent reuse/leakage
    pendingCodeVerifier = null;
  }
}
