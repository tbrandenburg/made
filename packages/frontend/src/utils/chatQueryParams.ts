const SESSION_PARAM_KEYS = ["sessionId", "session", "sid"] as const;
const MESSAGE_PARAM_KEYS = [
  "userMessage",
  "message",
  "prompt",
  "chatMessage",
] as const;

const CONSUMED_PREFIX = "made-chat-bootstrap-consumed";

const getFirstValue = (
  searchParams: URLSearchParams,
  keys: readonly string[],
) => {
  for (const key of keys) {
    const value = searchParams.get(key)?.trim();
    if (value) return value;
  }
  return null;
};

export const getChatBootstrapParams = (searchParams: URLSearchParams) => ({
  sessionId: getFirstValue(searchParams, SESSION_PARAM_KEYS),
  message: getFirstValue(searchParams, MESSAGE_PARAM_KEYS),
});

export const stripChatBootstrapParams = (searchParams: URLSearchParams) => {
  const nextParams = new URLSearchParams(searchParams);
  const keys = [...SESSION_PARAM_KEYS, ...MESSAGE_PARAM_KEYS];
  let changed = false;

  keys.forEach((key) => {
    if (nextParams.has(key)) {
      nextParams.delete(key);
      changed = true;
    }
  });

  return { nextParams, changed };
};

const buildConsumedKey = (
  pathname: string,
  sessionId: string | null,
  message: string | null,
) => {
  const normalizedSession = sessionId || "";
  const normalizedMessage = message || "";
  return `${CONSUMED_PREFIX}:${pathname}:${normalizedSession}:${normalizedMessage}`;
};

export const hasConsumedChatBootstrap = (
  pathname: string,
  sessionId: string | null,
  message: string | null,
) => sessionStorage.getItem(buildConsumedKey(pathname, sessionId, message)) === "1";

export const markChatBootstrapConsumed = (
  pathname: string,
  sessionId: string | null,
  message: string | null,
) => {
  sessionStorage.setItem(buildConsumedKey(pathname, sessionId, message), "1");
};
