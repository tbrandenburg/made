---
description: Scan dependencies using package manager security tools (npm audit, pip check, etc.) - creates GitHub issue only for critical/high severity vulnerabilities
---

# Security Vulnerability Check

## Your Mission

Analyze this repository's dependencies for security vulnerabilities using package managers' built-in security tools, and create a GitHub issue if any critical or high-severity vulnerabilities are found.

## Steps

1. **Run Package Manager Security Tools** (Only use pre-installed tools on ubuntu-latest):
   - For Node.js: `npm audit` (npm is pre-installed)
   - For Python: `pip check` (pip is pre-installed)
   - For Go: `go list -json -m all` then check for known vulnerabilities (go is pre-installed)
   
2. **Additional Tools** (Only if project files indicate they're needed AND can be quickly installed):
   - For Python: Try `pip install pip-audit --quiet` then `pip-audit` if pip-audit not available
   - For Rust: Only suggest `cargo audit` if Cargo.toml exists (don't install Rust)
   - For Java: Only suggest security checks if pom.xml/build.gradle exists (don't install Java tools)
   - For .NET: Only suggest if .csproj exists (don't install dotnet)
   - For Ruby: Only suggest if Gemfile exists (don't install Ruby)
   - For PHP: Only suggest if composer.json exists (don't install PHP)

3. **Parse Security Tool Output**: Extract vulnerability information including:
   - Package names and versions
   - Severity levels (focus on CRITICAL and HIGH)
   - CVE identifiers
   - Available patches/updates

4. **Fallback to Manual Analysis** (only if security tools unavailable):
   - Look for package files (package.json, requirements.txt, etc.)
   - Search for known vulnerabilities in major dependencies
   
5. **Check for Duplicate Issues**: Before creating a new issue, check recent GitHub issues to avoid duplicates:
   - List the latest 10-20 open issues using `gh issue list --limit 20`
   - Scan issue titles and descriptions for the same package names or CVE IDs found in your scan
   - If an issue already addresses the same vulnerability, add a comment with updated findings instead of creating a duplicate
   - If no matching issue exists, proceed to create a new one
   
6. **Create Issue if Needed**: If vulnerabilities are found and no duplicate exists, create a GitHub issue with:
   - Title: "🚨 Security Vulnerability: [Package Name] has [Severity] vulnerability ([CVE-ID])" 
   - For multiple vulnerabilities: "🚨 Security: [X] critical/high vulnerabilities found in dependencies"
   - Clear list of vulnerable packages and versions
   - Severity levels and CVE IDs
   - Recommended actions (update commands, patches, etc.)
   - Command output excerpts showing the vulnerabilities

## Important Notes

- Only create an issue if CRITICAL or HIGH severity vulnerabilities are found
- Include specific update commands (e.g., `npm update package-name`)
- If no vulnerabilities found, report "No critical security vulnerabilities detected by [tool-name]"
- If security tools fail, explain what was attempted and fallback results

**Repository Context**: Analyze the current repository using available package managers first