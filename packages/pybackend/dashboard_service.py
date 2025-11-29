from repository_service import list_repositories
from config import get_made_directory, get_made_home, get_workspace_home


def get_dashboard_summary():
    repositories = list_repositories()
    return {
        "projectCount": len(repositories),
        "agentConnection": True,
        "repositories": repositories,
        "madeHome": str(get_made_home()),
        "workspaceHome": str(get_workspace_home()),
        "madeDirectory": str(get_made_directory()),
    }
