---
description: Checking for stale pull requests and issues in this repository and commenting on them to notify the repository owner
---

# Stale PR and Issue Check

You are tasked with checking for stale pull requests and issues in this repository and commenting on them to notify the repository owner.

## Task 1: Get Repo Owner GitHub Username

- Use gh CLI to get the repo owner github user name: `gh repo view --json owner --jq '.owner.login'`
- Alternative if gh CLI fails: Extract from `GITHUB_REPOSITORY` env var: `echo "$GITHUB_REPOSITORY" | cut -d'/' -f1`
- Or use GitHub API directly: `curl -s -H "Authorization: token $GITHUB_TOKEN" "https://api.github.com/repos/$GITHUB_REPOSITORY" | jq -r '.owner.login'`

## Task 2: Check for Stale Pull Requests

- Find PRs that have been open for more than 3 days without any activity (no comments, commits, or updates)
- Ignore PRs that are marked as drafts or have "WIP" in the title
- For each stale PR found, add a comment using the template below

### Stale PR Comment Template
Use this exact template (replace `[REPO-OWNER]` with actual username):
```
🕰️ This pull request has been inactive for over 3 days. 

@[REPO-OWNER] - Could you please review this PR or provide an update on its status?

If this PR is no longer needed, please consider closing it to keep the repository clean.
```

## Task 3: Check for Stale Issues

- Find issues that have been open for more than 3 days without any activity (no comments or updates)
- Ignore issues that have labels like "enhancement", "long-term", "backlog", or "wontfix"
- For each stale issue found, add a comment using the template below

### Stale Issue Comment Template
Use this exact template (replace `[REPO-OWNER]` with actual username):
```
🕰️ This issue has been inactive for over 3 days.

@[REPO-OWNER] - Could you provide an update on this issue?

If this issue is resolved or no longer relevant, please consider closing it.
```

## Task 4: Generate Final Report

Format your final response using the exact template below. Replace all bracketed placeholders with actual values.

### Required Output Template
```markdown
# Stale Check Results

## Repository: [REPO-NAME]
**Owner:** @[REPO-OWNER]
**Date:** [CURRENT-DATE]

## Stale Pull Requests
- **Found:** [NUMBER] stale PRs
- **Commented on:** [NUMBER] PRs
- **Details:**
  [LIST EACH PR: #123 - "PR Title" - last activity: YYYY-MM-DD]

## Stale Issues  
- **Found:** [NUMBER] stale issues
- **Commented on:** [NUMBER] issues
- **Details:**
  [LIST EACH ISSUE: #456 - "Issue Title" - last activity: YYYY-MM-DD]

## Errors
[LIST ANY ERRORS OR "None"]

## Summary
[BRIEF SUMMARY OF ACTIONS TAKEN]
```

## Guidelines

### Template Guidelines:
- **USE ALL TEMPLATES EXACTLY** - Only replace bracketed placeholders with actual values
- Do not deviate from template language unless there's a technical error
- Use "None" in output template if no items found

### Execution Guidelines:
- Only comment once per stale item (check if you've already commented before)
- Use the GitHub CLI (`gh`) or GitHub API to interact with the repository