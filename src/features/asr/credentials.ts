export type TencentAsrEnvConfig = {
  appId: string;
  secretId: string;
  secretKey: string;
  engineModelType: string;
};

function readEnvVar(name: string) {
  const v = (import.meta.env as unknown as Record<string, unknown>)[name];
  return typeof v === "string" ? v.trim() : "";
}

export function readTencentAsrEnvConfig(): TencentAsrEnvConfig | null {
  const appId = readEnvVar("VITE_TENCENT_ASR_APP_ID");
  const secretId = readEnvVar("VITE_TENCENT_ASR_SECRET_ID");
  const secretKey = readEnvVar("VITE_TENCENT_ASR_SECRET_KEY");
  const engineModelType = readEnvVar("VITE_TENCENT_ASR_ENGINE_MODEL_TYPE") || "16k_zh";

  if (!appId || !secretId || !secretKey) return null;
  return { appId, secretId, secretKey, engineModelType };
}

