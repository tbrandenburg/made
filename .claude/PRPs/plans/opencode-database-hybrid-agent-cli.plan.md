### Task 6: ADD unit tests for new CLI methods in `packages/pybackend/tests/unit/test_opencode_database_agent_cli.py`

- **ACTION**: ADD comprehensive unit tests for list_agents() and run_agent() methods
- **IMPLEMENT**: Mock subprocess calls, test success/failure cases, validate result structures
- **MIRROR**: `packages/pybackend/tests/unit/test_copilot_agent_cli.py:71-87` - copy test patterns
- **PATTERN**: @patch("subprocess.run") decorator, mock return values, assert on results
- **GOTCHA**: Mock both subprocess.run (for list_agents) and subprocess.Popen (for run_agent)
- **CURRENT**: Testing patterns follow current unittest.mock best practices
- **VALIDATE**: `python -m pytest packages/pybackend/tests/unit/test_opencode_database_agent_cli.py::TestCLIMethods -v` - all new tests pass

### Task 7: UPDATE configuration mapping in `packages/pybackend/agent_service.py`

- **ACTION**: RENAME configuration values for backward compatibility and user clarity
- **IMPLEMENT**: Change "opencode" → "opencode-legacy", "opencode-database" → "opencode" 
- **MIRROR**: `packages/pybackend/agent_service.py:32-42` - update elif conditions in get_agent_cli()
- **PATTERN**: Keep original CLI as "opencode-legacy", make hybrid the new default "opencode"
- **GOTCHA**: Update all string literals, maintain backward compatibility by supporting both old and new names temporarily
- **CURRENT**: Follows semantic versioning principles - hybrid becomes primary implementation
- **VALIDATE**: `python -c "from packages.pybackend.agent_service import get_agent_cli; print(type(get_agent_cli()).__name__)"` - returns OpenCodeDatabaseAgentCLI

### Task 8: UPDATE default configuration in `packages/pybackend/settings_service.py`

- **ACTION**: UPDATE default agentCli value to use hybrid implementation
- **IMPLEMENT**: Change default value from "opencode" to "opencode" (but now points to hybrid)
- **MIRROR**: `packages/pybackend/settings_service.py:17-20` - update defaults dictionary
- **PATTERN**: Keep same default key name but ensure it maps to hybrid implementation
- **GOTCHA**: Coordinate with agent_service.py changes - "opencode" should resolve to OpenCodeDatabaseAgentCLI
- **CURRENT**: Maintains existing configuration file format while upgrading implementation
- **VALIDATE**: `python -c "from packages.pybackend.settings_service import read_settings; print(read_settings()['agentCli'])"` - returns "opencode"

### Task 9: UPDATE frontend configuration options in `packages/frontend/src/pages/SettingsPage.tsx`

- **ACTION**: UPDATE agentCliOptions array to reflect new configuration mapping  
- **IMPLEMENT**: Replace array with `["opencode", "opencode-legacy", "kiro", "copilot", "codex"]`
- **MIRROR**: `packages/frontend/src/pages/SettingsPage.tsx:9` - update agentCliOptions constant
- **PATTERN**: Put hybrid implementation first as primary option, legacy as fallback
- **GOTCHA**: Ensure UI labels are user-friendly (may need to add display mapping)
- **CURRENT**: Follows UI/UX best practices - primary option listed first
- **VALIDATE**: Check SettingsPage renders with new options visible in dropdown

### Task 10: UPDATE frontend default configuration in `packages/frontend/src/hooks/useAgentCli.ts`

- **ACTION**: UPDATE DEFAULT_AGENT_CLI constant to match backend default
- **IMPLEMENT**: Ensure constant points to "opencode" (hybrid implementation)
- **MIRROR**: `packages/frontend/src/hooks/useAgentCli.ts:4` - update DEFAULT_AGENT_CLI value
- **PATTERN**: Frontend and backend defaults must stay synchronized
- **GOTCHA**: Verify the frontend properly handles the new configuration mapping
- **CURRENT**: Maintains consistent default experience across frontend and backend
- **VALIDATE**: `grep -n "DEFAULT_AGENT_CLI" packages/frontend/src/hooks/useAgentCli.ts` - shows correct value