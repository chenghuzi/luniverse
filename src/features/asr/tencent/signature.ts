function sortKeysAscii(keys: string[]) {
  return keys.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function toBase64(bytes: ArrayBuffer) {
  const view = new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < view.length; i++) binary += String.fromCharCode(view[i] ?? 0);
  return btoa(binary);
}

async function hmacSha1Base64(message: string, secretKey: string) {
  const enc = new TextEncoder();
  const keyData = enc.encode(secretKey);
  const key = await crypto.subtle.importKey("raw", keyData, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return toBase64(sig);
}

export type TencentAsrQueryParams = Record<string, string | number>;

export function buildTencentAsrCanonicalQuery(params: TencentAsrQueryParams) {
  const keys = sortKeysAscii(Object.keys(params));
  return keys.map((k) => `${k}=${String(params[k] ?? "")}`).join("&");
}

export async function buildTencentAsrWsUrl(appId: string, params: TencentAsrQueryParams, secretKey: string) {
  const query = buildTencentAsrCanonicalQuery(params);
  const signText = `asr.cloud.tencent.com/asr/v2/${appId}?${query}`;
  const signature = await hmacSha1Base64(signText, secretKey);
  const sigParam = encodeURIComponent(signature);
  return `wss://asr.cloud.tencent.com/asr/v2/${appId}?${query}&signature=${sigParam}`;
}

