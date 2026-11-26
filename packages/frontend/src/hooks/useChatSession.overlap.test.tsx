import { act } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { AgentReply } from "./useApi";
import {
  cleanupSessionTests,
  deferred,
  renderSnapshotSession,
  snapshotApi,
} from "./useChatSession.testSupport";

afterEach(cleanupSessionTests);

it("pushes a second message into the running session and settles when both replies arrive", async () => {
  const first = deferred<AgentReply>();
  const second = deferred<AgentReply>();
  const api = snapshotApi();
  api.sendMessage
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  const { result } = renderSnapshotSession(api, "A");
  let sendingFirst!: Promise<void>;
  let sendingSecond!: Promise<void>;

  act(() => {
    sendingFirst = result.current.handleSendMessage("slow task");
  });
  expect(result.current.agentState).toEqual({ status: "processing" });
  act(() => {
    sendingSecond = result.current.handleSendMessage("also this");
  });

  expect(api.sendMessage).toHaveBeenCalledTimes(2);
  expect(api.sendMessage).toHaveBeenNthCalledWith(
    2,
    "repo",
    "also this",
    "A",
    undefined,
    undefined,
  );
  expect(result.current.chat.map((entry) => entry.text)).toEqual([
    "slow task",
    "also this",
  ]);
  expect(api.cancelAgent).not.toHaveBeenCalled();

  await act(async () => {
    first.resolve({
      sessionId: "A",
      messageId: "1",
      sent: "now",
      response: "",
    });
    second.resolve({
      sessionId: "A",
      messageId: "2",
      sent: "now",
      response: "",
    });
    await Promise.all([sendingFirst, sendingSecond]);
  });

  expect(result.current.agentState).toEqual({ status: "idle" });
  expect(result.current.sessionId).toBe("A");
});
