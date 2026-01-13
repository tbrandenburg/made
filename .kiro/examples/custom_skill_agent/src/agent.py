"""Main skill-based agent implementation with progressive disclosure."""

from pydantic_ai import Agent, RunContext
from pydantic import BaseModel
from typing import Optional

from src.providers import get_llm_model
from src.dependencies import AgentDependencies
from src.prompts import MAIN_SYSTEM_PROMPT
from src.skill_tools import load_skill, read_skill_file, list_skill_files
from src.http_tools import http_get, http_post


class AgentState(BaseModel):
    """Minimal shared state for the skill agent."""

    pass


# Create the skill-based agent
skill_agent = Agent(
    get_llm_model(),
    deps_type=AgentDependencies,
    system_prompt="",  # Will be set dynamically via decorator
)


@skill_agent.system_prompt
async def get_system_prompt(ctx: RunContext[AgentDependencies]) -> str:
    """
    Generate system prompt with skill metadata.

    This dynamically injects skill metadata into the system prompt,
    implementing Level 1 of progressive disclosure.

    Args:
        ctx: Agent runtime context with dependencies

    Returns:
        Complete system prompt with skill metadata injected
    """
    # Initialize dependencies (including skill loader)
    await ctx.deps.initialize()

    # Get skill metadata for prompt
    skill_metadata = ""
    if ctx.deps.skill_loader:
        skill_metadata = ctx.deps.skill_loader.get_skill_metadata_prompt()

    # Inject skill metadata into base prompt
    return MAIN_SYSTEM_PROMPT.format(skill_metadata=skill_metadata)


@skill_agent.tool
async def load_skill_tool(
    ctx: RunContext[AgentDependencies],
    skill_name: str,
) -> str:
    """
    Load the full instructions for a skill.

    Use this tool when you need to access the detailed instructions
    for a skill. Based on the skill descriptions in your system prompt,
    identify which skill is relevant and load its full instructions.

    Args:
        ctx: Agent runtime context with dependencies
        skill_name: Name of the skill to load (e.g., "weather", "code_review")

    Returns:
        Full skill instructions from SKILL.md
    """
    return await load_skill(ctx, skill_name)


@skill_agent.tool
async def read_skill_file_tool(
    ctx: RunContext[AgentDependencies],
    skill_name: str,
    file_path: str,
) -> str:
    """
    Read a file from a skill's directory.

    Use this tool when skill instructions reference a resource file
    (e.g., "See references/api_reference.md for API details").
    This loads the specific resource on-demand.

    Args:
        ctx: Agent runtime context with dependencies
        skill_name: Name of the skill containing the file
        file_path: Relative path to the file (e.g., "references/api_reference.md")

    Returns:
        Contents of the requested file
    """
    return await read_skill_file(ctx, skill_name, file_path)


@skill_agent.tool
async def list_skill_files_tool(
    ctx: RunContext[AgentDependencies],
    skill_name: str,
    directory: Optional[str] = None,
) -> str:
    """
    List files available in a skill's directory.

    Use this tool to discover what resources are available in a skill
    before loading them. Helpful when you need to explore what
    documentation, scripts, or other files a skill provides.

    Args:
        ctx: Agent runtime context with dependencies
        skill_name: Name of the skill to list files from
        directory: Optional subdirectory to list (e.g., "references", "scripts")

    Returns:
        Formatted list of available files
    """
    return await list_skill_files(ctx, skill_name, directory or "")


@skill_agent.tool
async def http_get_tool(
    ctx: RunContext[AgentDependencies],
    url: str,
) -> str:
    """
    Make an HTTP GET request to fetch data from a URL.

    Use this tool when you need to:
    - Fetch data from an API (like weather, stock prices, etc.)
    - Retrieve content from a web page
    - Make any GET request to an external service

    Args:
        ctx: Agent runtime context with dependencies
        url: The full URL to fetch (e.g., "https://api.example.com/data")

    Returns:
        Response body (JSON is formatted nicely), or error message if request fails
    """
    return await http_get(ctx, url)


@skill_agent.tool
async def http_post_tool(
    ctx: RunContext[AgentDependencies],
    url: str,
    body: Optional[str] = None,
) -> str:
    """
    Make an HTTP POST request to send data to a URL.

    Use this tool when you need to:
    - Send data to an API
    - Submit form data
    - Make any POST request to an external service

    Args:
        ctx: Agent runtime context with dependencies
        url: The full URL to post to
        body: Request body as a string (use JSON string for JSON APIs)

    Returns:
        Response body, or error message if request fails
    """
    return await http_post(ctx, url, body)
