# Agent Rules

- Treat `AVOS_MASTER_BUILD_BRIEF.md` as the primary requirements source.
- Do not perform paid actions, deploy production, connect accounts, publish content, or send messages without explicit owner approval for the exact scope.
- Never put secrets in source control, logs, documentation, or chat.
- Never trust an API request body to prove that the caller is the owner.
- Enforce policy in code at the execution boundary, not only in prompts.
- Do not run Automaton bootstrap commands until side effects have been reviewed and separately approved.
- Use mocks/sandbox fixtures for tests.
- Keep status, tests, assumptions, risks, and costs updated.
- If blocked by credentials or cloud access, finish all independent local work and provide exact manual steps needed.
- Do not claim a task is verified without test output or other evidence.
