type DashscopeConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

const DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const DEFAULT_MODEL = "qwen-plus";

export function getDashscopeConfig(): DashscopeConfig | null {
  const baseUrl = String(import.meta.env.VITE_DASHSCOPE_BASE_URL ?? DEFAULT_BASE_URL).trim();
  const apiKey = String(import.meta.env.VITE_DASHSCOPE_API_KEY ?? "").trim();
  const model = String(import.meta.env.VITE_DASHSCOPE_MODEL ?? DEFAULT_MODEL).trim();

  if (!apiKey) return null;
  if (!baseUrl) return null;
  if (!model) return null;

  return { baseUrl, apiKey, model };
}

