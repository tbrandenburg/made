// @vitest-environment jsdom

import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { MentionPathTextarea } from "./MentionPathTextarea";

describe("MentionPathTextarea", () => {
  it("notifies mention query changes while typing", async () => {
    const onMentionQueryChange = vi.fn();

    const Wrapper = () => {
      const [value, setValue] = useState("");
      return (
        <MentionPathTextarea
          value={value}
          onChange={setValue}
          suggestions={["src/components/Button.tsx"]}
          onMentionQueryChange={onMentionQueryChange}
        />
      );
    };

    render(<Wrapper />);

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "@src/comp" } });
    fireEvent.keyUp(textarea);

    await waitFor(() => {
      expect(onMentionQueryChange).toHaveBeenCalledWith("src/comp");
    });
  });
});
