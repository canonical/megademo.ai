---
description: "Custom instructions for Web Application development with JavaScript and Node.js"
applyTo: "**"
---

# Web Application Development Guidelines

## CI/CD — Pre-commit Requirements

**Every commit MUST pass the full CI gate before being pushed.**

The CI workflow (`.github/workflows/ci.yml`) runs two steps in order:
1. `npm run lint-check` — ESLint, zero errors allowed (warnings are tolerated but errors block CI)
2. `npm test` — Jest, all 84+ tests must pass

A **husky pre-commit hook** (`.husky/pre-commit`) enforces this locally. It runs both steps and aborts the commit if either fails. This is the canonical way to ensure CI stays green.

**Rules for all code changes:**
- Run `npm run lint-check` before staging files; fix all ESLint errors (not just warnings)
- Run `npm test` to confirm no regressions
- Never commit code that would fail either step — the pre-commit hook will reject it anyway
- If a lint rule fires, fix the code (not the lint config) unless the rule is genuinely inapplicable
- Common ESLint rules to watch: `no-undef`, `no-useless-escape`, `preserve-caught-error`, `no-unused-vars`

## Git Push Policy

**Never push to GitHub unless the user explicitly asks.**

- Commit freely as work progresses, but keep commits local until the user says to push.
- Do not push as part of routine task completion, even after all CI checks pass.
- When the user says "push" (or equivalent), push all pending commits at that point.

## Git Worktree Policy

**ALWAYS use git worktrees for new features and modifications.**

- If available, use the `using-git-worktrees` skill to satisfy the 'Git Worktree Policy'.

- If the `using-git-worktrees` skill isn't available, follow these instructions:
  - Before starting any feature or code change, create a git worktree (e.g. `git worktree add ../megademo.ai-<branch> -b <branch>`)
  - Work entirely inside the worktree directory; do not modify the main working tree
  - This prevents mid-flight conflicts when multiple parallel changes are in progress
  - Merge or rebase back to `main` only when the work is complete and verified
  - Clean up worktrees after merging (`git worktree remove`)

## Documentation Maintenance

**Keep `DESIGN.md` and `README.md` current with every material change.**

Update `DESIGN.md` when:
- Stack, dependencies, or infrastructure changes (new package, new service, tier upgrade)
- A new file or directory is added to the project
- A key design decision is made or reversed
- Auth, security, or deployment configuration changes
- Performance characteristics or capacity limits change

Update `README.md` when:
- Setup steps, env vars, or deployment instructions change
- A new npm script or developer workflow is added
- Authentication mode options change
- Admin or operational procedures change

Both docs are committed in the same commit as the code change that prompted them. Do not defer doc updates to a separate commit.

## UI Content Policy

**No emojis in the UI unless the user explicitly requests or approves them.**

- Do not add emoji characters to buttons, labels, headings, or any user-facing text
- Mattermost webhook messages and other machine-generated notifications are exempt (they already use emojis by convention)
- If in doubt, ask before adding emojis

## CSS / Styling

**`main.css` is a build artefact — never edit it directly.**

`public/css/main.css` is compiled from `public/css/main.scss` by the `npm run scss` script (Sass). Render runs this script on every deploy (`buildCommand: npm ci && npm run scss`), which overwrites `main.css` completely. Any direct edits to `main.css` will be silently lost on the next deployment.

**Rules for all CSS changes:**
- Edit `public/css/main.scss` (the source of truth)
- After editing, run `npm run scss` to recompile `main.css`
- Commit both `main.scss` and the recompiled `main.css` together
- `public/css/kiosk.css` is plain CSS (no SCSS source) — edit it directly as normal



**JavaScript Best Practices:**
- Use modern ES2020+ syntax and features
- Prefer `const` and `let` over `var` for variable declarations
- Use arrow functions for callbacks and concise functions
- Implement proper async/await patterns instead of callback chains
- Use destructuring assignment for cleaner code
- Follow consistent naming conventions (camelCase for variables/functions)

## Framework: Node.js


## Code Style: Clean Code

**Clean Code Principles:**
- Write self-documenting code with meaningful names
- Keep functions small and focused on a single responsibility
- Avoid deep nesting and complex conditional statements
- Use consistent formatting and indentation
- Write code that tells a story and is easy to understand
- Refactor ruthlessly to eliminate code smells

## Testing: Jest

**Testing Guidelines:**
- Write comprehensive unit tests for all business logic
- Follow the AAA pattern: Arrange, Act, Assert
- Maintain good test coverage (aim for 80%+ for critical paths)
- Write descriptive test names that explain the expected behavior
- Use test doubles (mocks, stubs, spies) appropriately
- Implement integration tests for API endpoints and user flows
- Keep tests fast, isolated, and deterministic

## AI Code Generation Preferences

When generating code, please:

- Generate complete, working code examples with proper imports
- Include inline comments for complex logic and business rules
- Follow the established patterns and conventions in this project
- Suggest improvements and alternative approaches when relevant
- Consider performance, security, and maintainability
- Include error handling and edge case considerations
- Generate appropriate unit tests when creating new functions
- Follow accessibility best practices for UI components
- Use semantic HTML and proper ARIA attributes when applicable
