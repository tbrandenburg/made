// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  WorkflowBuilderPanel,
  type WorkflowDefinition,
} from "./WorkflowBuilderPanel";

const workflows: WorkflowDefinition[] = [
  {
    id: "workflow-1",
    name: "Example workflow",
    enabled: true,
    schedule: null,
    steps: [
      { type: "agent", agent: "planner", prompt: "First step" },
      { type: "bash", run: "echo second" },
      {
        type: "vars",
        varName: "API_KEY",
        run: "secret",
        values: { API_KEY: "secret" },
      },
    ],
  },
];

describe("WorkflowBuilderPanel", () => {
  it("renders a remove button for each workflow step", async () => {
    render(
      <WorkflowBuilderPanel
        loadWorkflows={async () => ({ workflows })}
        saveWorkflows={vi.fn(async () => undefined)}
        listAgents={async () => ({ agents: [{ name: "planner" }] })}
        onRunWorkflow={vi.fn(async () => undefined)}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Remove step 1" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Remove step 2" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Remove step 3" }),
      ).toBeInTheDocument();
    });
  });

  it("removes a step, persists the updated workflow list, and closes the editor when needed", async () => {
    const saveWorkflows = vi.fn(async () => undefined);

    render(
      <WorkflowBuilderPanel
        loadWorkflows={async () => ({ workflows })}
        saveWorkflows={saveWorkflows}
        listAgents={async () => ({ agents: [{ name: "planner" }] })}
        onRunWorkflow={vi.fn(async () => undefined)}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Remove step 2" }),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "First step" }));
    expect(
      screen.getByRole("heading", { name: "Edit Step" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove step 1" }));

    await waitFor(() => {
      expect(saveWorkflows).toHaveBeenCalledTimes(1);
    });

    expect(saveWorkflows).toHaveBeenCalledWith({
      workflows: [
        {
          ...workflows[0],
          steps: [workflows[0].steps[1], workflows[0].steps[2]],
        },
      ],
    });
    expect(
      screen.queryByRole("heading", { name: "Edit Step" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Remove step 1" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Remove step 3" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the editor aligned when deleting a step before the active one", async () => {
    const saveWorkflows = vi.fn(async () => undefined);

    render(
      <WorkflowBuilderPanel
        loadWorkflows={async () => ({ workflows })}
        saveWorkflows={saveWorkflows}
        listAgents={async () => ({ agents: [{ name: "planner" }] })}
        onRunWorkflow={vi.fn(async () => undefined)}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Remove step 2" }),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "echo second" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove step 1" }));

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Edit Step" }),
      ).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("Command or Prompt"), {
      target: { value: "echo updated" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save step" }));

    await waitFor(() => {
      expect(saveWorkflows).toHaveBeenCalledTimes(2);
    });

    expect(saveWorkflows.mock.calls[1]?.[0]).toEqual({
      workflows: [
        {
          ...workflows[0],
          steps: [
            {
              ...workflows[0].steps[1],
              run: "echo updated",
            },
            {
              ...workflows[0].steps[2],
            },
          ],
        },
      ],
    });
  });

  it("adds a workflow parameter and persists it", async () => {
    const saveWorkflows = vi.fn(async () => undefined);

    render(
      <WorkflowBuilderPanel
        loadWorkflows={async () => ({ workflows })}
        saveWorkflows={saveWorkflows}
        listAgents={async () => ({ agents: [{ name: "planner" }] })}
        onRunWorkflow={vi.fn(async () => undefined)}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Edit workflow parameters" }),
      ).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Edit workflow parameters" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Add parameter" }));
    fireEvent.change(screen.getByLabelText("Parameter 1 name"), {
      target: { value: "release_branch" },
    });
    fireEvent.change(screen.getByLabelText("Parameter 1 description"), {
      target: { value: "Branch to release" },
    });
    fireEvent.click(screen.getByLabelText("Parameter 1 required"));
    fireEvent.click(screen.getByRole("button", { name: "Save parameters" }));

    await waitFor(() => {
      expect(saveWorkflows).toHaveBeenCalledTimes(1);
    });
    expect(saveWorkflows).toHaveBeenCalledWith({
      workflows: [
        {
          ...workflows[0],
          params: [
            {
              name: "release_branch",
              description: "Branch to release",
              required: true,
            },
          ],
        },
      ],
    });
  });

  it("removes a workflow parameter", async () => {
    const saveWorkflows = vi.fn(async () => undefined);
    const workflowsWithParams: WorkflowDefinition[] = [
      {
        ...workflows[0],
        params: [{ name: "release_branch", required: false }],
      },
    ];

    render(
      <WorkflowBuilderPanel
        loadWorkflows={async () => ({ workflows: workflowsWithParams })}
        saveWorkflows={saveWorkflows}
        listAgents={async () => ({ agents: [{ name: "planner" }] })}
        onRunWorkflow={vi.fn(async () => undefined)}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Edit workflow parameters" }),
      ).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Edit workflow parameters" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove parameter 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Save parameters" }));

    await waitFor(() => {
      expect(saveWorkflows).toHaveBeenCalledTimes(1);
    });
    expect(saveWorkflows).toHaveBeenCalledWith({
      workflows: [{ ...workflowsWithParams[0], params: undefined }],
    });
  });

  it("sets extended agent fields via the advanced agent options modal", async () => {
    const saveWorkflows = vi.fn(async () => undefined);

    render(
      <WorkflowBuilderPanel
        loadWorkflows={async () => ({ workflows })}
        saveWorkflows={saveWorkflows}
        listAgents={async () => ({ agents: [{ name: "planner" }] })}
        onRunWorkflow={vi.fn(async () => undefined)}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Advanced agent options" }),
      ).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Advanced agent options" }),
    );
    fireEvent.change(screen.getByLabelText("Model"), {
      target: { value: "claude-sonnet-4" },
    });
    fireEvent.change(screen.getByLabelText("Capture variable"), {
      target: { value: "plan_output" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Expand prompt" }));
    fireEvent.click(screen.getByRole("button", { name: "Expand fields" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: "Dangerously skip permissions",
      }),
    );

    await waitFor(() => {
      expect(saveWorkflows).toHaveBeenCalledTimes(5);
    });
    const lastCall = saveWorkflows.mock.calls[4]?.[0] as {
      workflows: WorkflowDefinition[];
    };
    expect(lastCall.workflows[0].steps[0]).toEqual({
      ...workflows[0].steps[0],
      model: "claude-sonnet-4",
      capture: "PLAN_OUTPUT",
      expandPrompt: true,
      expandFields: true,
      dangerouslySkipPermissions: true,
    });
  });
});
