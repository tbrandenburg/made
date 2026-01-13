import { useEffect, useState } from "react";
import { api } from "./useApi";

const DEFAULT_AGENT_CLI = "opencode";

export const useAgentCli = () => {
  const [agentCli, setAgentCli] = useState(DEFAULT_AGENT_CLI);

  useEffect(() => {
    let active = true;

    api
      .getSettings()
      .then((settings) => {
        if (!active) return;
        const cli =
          settings && typeof settings.agentCli === "string"
            ? settings.agentCli
            : DEFAULT_AGENT_CLI;
        setAgentCli(cli);
      })
      .catch((error) => {
        if (!active) return;
        console.error("Failed to load agent CLI settings", error);
        setAgentCli(DEFAULT_AGENT_CLI);
      });

    return () => {
      active = false;
    };
  }, []);

  return agentCli;
};
