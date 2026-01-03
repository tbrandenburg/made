import React, { useEffect, useRef } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";

import "@xterm/xterm/css/xterm.css";
import "../styles/terminal.css";

import { buildWebSocketUrl } from "../utils/websocket";

type TerminalTabProps = {
  repositoryName?: string;
};

const getCssVariable = (name: string, fallback: string) => {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
};

export const TerminalTab: React.FC<TerminalTabProps> = ({ repositoryName }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!repositoryName || !containerRef.current) return;

    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      disableStdin: false,
      fontFamily: '"JetBrains Mono", "Fira Code", monospace',
      fontSize: 13,
      scrollback: 2000,
      theme: {
        background: getCssVariable("--surface-strong", "#0f172a"),
        foreground: getCssVariable("--text", "#f8fafc"),
        cursor: getCssVariable("--accent", "#60a5fa"),
        green: getCssVariable("--success", "#34d399"),
        blue: getCssVariable("--accent", "#60a5fa"),
        white: getCssVariable("--text", "#f8fafc"),
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    terminal.open(containerRef.current);
    fitAddon.fit();
    terminal.focus();

    const socket = new WebSocket(
      buildWebSocketUrl(`/repositories/${repositoryName}/terminal`),
    );

    const sendResize = () => {
      fitAddon.fit();
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(
          JSON.stringify({
            type: "resize",
            cols: terminal.cols,
            rows: terminal.rows,
          }),
        );
      }
    };

    const dataDisposable = terminal.onData((data) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "input", data }));
      }
    });

    socket.addEventListener("open", () => {
      terminal.writeln(`🖥️ Connected to ${repositoryName}`);
      sendResize();
    });

    socket.addEventListener("message", (event) => {
      const payload =
        typeof event.data === "string"
          ? event.data
          : new TextDecoder().decode(event.data);
      terminal.write(payload);
    });

    socket.addEventListener("close", () => {
      terminal.writeln("\r\nSession closed.");
    });

    socket.addEventListener("error", () => {
      terminal.writeln("\r\nConnection error.");
    });

    window.addEventListener("resize", sendResize);

    return () => {
      dataDisposable.dispose();
      window.removeEventListener("resize", sendResize);
      socket.close();
      terminal.dispose();
    };
  }, [repositoryName]);

  return (
    <div className="terminal-wrapper">
      <div
        ref={containerRef}
        className="terminal-surface"
        aria-label="Repository terminal"
      />
    </div>
  );
};
