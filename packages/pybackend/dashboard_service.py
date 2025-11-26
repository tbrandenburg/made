from repository_service import list_repositories


def get_dashboard_summary():
    repositories = list_repositories()
    return {
        "projectCount": len(repositories),
        "agentConnection": True,
        "repositories": repositories,
    }
