const API_BASE =
  (import.meta.env?.VITE_API_BASE as string | undefined) || "/api";

const normalizePath = (path: string) =>
  path.startsWith("/") ? path : `/${path}`;

const normalizeBase = (base: string) =>
  base.endsWith("/") ? base.slice(0, -1) : base;

export const buildWebSocketUrl = (path: string, apiBase: string = API_BASE) => {
  const normalizedPath = normalizePath(path);

  if (apiBase.startsWith("http")) {
    const url = new URL(apiBase);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = `${normalizeBase(url.pathname)}${normalizedPath}`;
    return url.toString();
  }

  const origin = window.location.origin.replace(/^http/, "ws");
  const normalizedBase = apiBase ? normalizeBase(normalizePath(apiBase)) : "";
  return `${origin}${normalizedBase}${normalizedPath}`;
};
