import React, { useEffect, useMemo, useState } from "react";
import { api, AvailableAgent } from "../hooks/useApi";

type AgentSelectorProps = {
  selectedAgent: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  selectId: string;
};

const DEFAULT_AGENT_VALUE = "default";

export const AgentSelector: React.FC<AgentSelectorProps> = ({
  selectedAgent,
  onChange,
  disabled = false,
  selectId,
}) => {
  const [agents, setAgents] = useState<AvailableAgent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const loadAgents = async () => {
      setLoading(true);
      try {
        const response = await api.getAgents();
        if (!active) return;
        setAgents(response.agents || []);
        setError(null);
      } catch (fetchError) {
        if (!active) return;
        console.error("Failed to load agents", fetchError);
        setError("Unable to load agents");
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    loadAgents();
    return () => {
      active = false;
    };
  }, []);

  const groupedAgents = useMemo(() => {
    const primary = agents.filter((agent) => agent.type === "primary");
    const subagent = agents.filter((agent) => agent.type === "subagent");
    const other = agents.filter(
      (agent) => agent.type !== "primary" && agent.type !== "subagent",
    );
    return { primary, subagent, other };
  }, [agents]);

  const renderAgentOption = (agent: AvailableAgent) => {
    const typeSuffix = agent.type ? ` (${agent.type})` : "";
    return (
      <option key={`${agent.name}-${agent.type || "unknown"}`} value={agent.name}>
        {`${agent.name}${typeSuffix}`}
      </option>
    );
  };

  return (
    <label className="model-select" htmlFor={selectId}>
      <select
        id={selectId}
        value={selectedAgent}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled || loading}
        aria-label="Agent"
      >
        <option value={DEFAULT_AGENT_VALUE}>Default</option>
        {groupedAgents.primary.length > 0 && (
          <option disabled value="">
            ------- primary -------
          </option>
        )}
        {groupedAgents.primary.map(renderAgentOption)}
        {groupedAgents.subagent.length > 0 && (
          <option disabled value="">
            ------ subagent ------
          </option>
        )}
        {groupedAgents.subagent.map(renderAgentOption)}
        {groupedAgents.other.length > 0 && (
          <option disabled value="">
            ------- other -------
          </option>
        )}
        {groupedAgents.other.map(renderAgentOption)}
      </select>
      {error && <span className="muted">{error}</span>}
    </label>
  );
};

export { DEFAULT_AGENT_VALUE };
