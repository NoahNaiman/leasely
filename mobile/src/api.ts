import Constants from 'expo-constants';

export type LeaseTerm = {
  category: string;
  label: string;
  value: string;
  source_text: string;
};

export type LeaseExtraction = {
  is_lease_document: boolean;
  page_summary: string;
  terms: LeaseTerm[];
  warnings: string[];
};

const SERVER_PORT = 3001;

/**
 * Where the extraction server lives. Set EXPO_PUBLIC_API_URL to override;
 * otherwise reuse the dev machine's LAN address that Expo is already serving
 * the bundle from, so a physical phone on the same Wi-Fi can reach it.
 */
function resolveApiUrl(): string {
  const override = process.env.EXPO_PUBLIC_API_URL;
  if (override) return override.replace(/\/$/, '');

  const hostUri = Constants.expoConfig?.hostUri; // e.g. "192.168.1.20:8081"
  const host = hostUri?.split(':')[0] ?? 'localhost';
  return `http://${host}:${SERVER_PORT}`;
}

export const API_URL = resolveApiUrl();

export async function extractLeaseTerms(imageBase64: string): Promise<LeaseExtraction> {
  const res = await fetch(`${API_URL}/extract`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageBase64, mediaType: 'image/jpeg' }),
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return body as LeaseExtraction;
}
