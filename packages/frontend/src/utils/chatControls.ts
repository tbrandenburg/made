// While the agent runs, typing turns Cancel into Send so the message is pushed
// to the running session. A chat without a session id cannot be addressed yet.
export function showCancel(
  processing: boolean,
  draft: string,
  sessionId: string | null | undefined,
): boolean {
  return processing && (!draft.trim() || !sessionId);
}
