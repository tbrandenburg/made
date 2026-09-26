// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SettingsPage } from "./SettingsPage";
import { api } from "../hooks/useApi";

describe("SettingsPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api, "getSettings").mockResolvedValue({ agentCli: "opencode" });
    vi.spyOn(api, "saveSettings").mockResolvedValue({
      agentCli: "opencode-v2",
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it("allows selecting and saving the OpenCode v2 adapter", async () => {
    render(<SettingsPage />);

    const selector = await screen.findByLabelText("agentCli");
    expect(
      screen.getByRole("option", { name: "opencode-v2" }),
    ).toBeInTheDocument();
    expect(selector).toHaveValue("opencode");

    fireEvent.change(selector, { target: { value: "opencode-v2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(api.saveSettings).toHaveBeenCalledWith({ agentCli: "opencode-v2" });
    expect(await screen.findByText("Settings saved")).toBeInTheDocument();
  });
});
