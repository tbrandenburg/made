---
description: Perform a comprehensive maintainability review of the codebase to identify technical debt and improvement opportunities
---

# Maintainability Review Prompt

You are an expert in software maintainability. Perform a comprehensive maintainability review of this codebase.

## Analysis Areas

### Code Clarity & Readability

- Review naming conventions consistency
- Analyze code structure and organization
- Check comment quality and coverage
- Review coding style consistency

### Technical Debt

- Identify code smells and anti-patterns
- Analyze complex methods/functions
- Review duplicate code instances
- Check for outdated dependencies

### Refactoring Opportunities

- Identify large classes/functions
- Analyze cyclomatic complexity
- Review coupling between components
- Check for magic numbers/strings

### Documentation Quality

- Review inline documentation
- Check API documentation completeness
- Analyze architectural documentation
- Review change logs and versioning

### Testing Support

- Review test coverage and quality
- Check testability of components
- Analyze mock/stub usage
- Review test maintenance burden

### Configuration Management

- Review configuration externalization
- Check environment-specific settings
- Analyze deployment configurations
- Review feature flag implementations

## Output Format

Provide a detailed maintainability assessment with:

1. CRITICAL: Maintainability issues that severely impede development
2. HIGH: Significant maintainability problems requiring attention
3. MEDIUM: Maintainability improvements for easier maintenance
4. LOW: Minor maintainability enhancements
5. TECHNICAL_DEBT: Specific technical debt items to address
6. RECOMMENDATIONS: Actionable maintainability improvements

Focus on reducing future maintenance costs and improving developer productivity.

## Final action

Just for the critical, high and technical debt issues:

1. Check with `gh` CLI if there are already similar issues
2. Only if there are no similar issues, raise Github issues for the new ones