export type AsrProvider = "tencent" | "volcengine";

export type TencentAsrEnvConfig = {
  appId: string;
  secretId: string;
  secretKey: string;
  engineModelType: string;
};

export type VolcengineAsrEnvConfig = {
  wsPath: string;
};

function readEnvVar(name: string) {
  const v = (import.meta.env as unknown as Record<string, unknown>)[name];
  return typeof v === "string" ? v.trim() : "";
}

export function readAsrProvider(): AsrProvider {
  return readEnvVar("VITE_ASR_PROVIDER").toLowerCase() === "volcengine" ? "volcengine" : "tencent";
}

export function readTencentAsrEnvConfig(): TencentAsrEnvConfig | null {
  const appId = readEnvVar("VITE_TENCENT_ASR_APP_ID");
  const secretId = readEnvVar("VITE_TENCENT_ASR_SECRET_ID");
  const secretKey = readEnvVar("VITE_TENCENT_ASR_SECRET_KEY");
  const engineModelType = readEnvVar("VITE_TENCENT_ASR_ENGINE_MODEL_TYPE") || "16k_zh";

  if (!appId || !secretId || !secretKey) return null;
  return { appId, secretId, secretKey, engineModelType };
}

export function readVolcengineAsrEnvConfig(): VolcengineAsrEnvConfig {
  const wsPath = readEnvVar("VITE_VOLCENGINE_ASR_WS_PATH") || "/api/asr/volcengine/ws";
  return { wsPath: wsPath.startsWith("/") ? wsPath : "/api/asr/volcengine/ws" };
}
