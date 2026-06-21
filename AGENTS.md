# Repository Guidelines

## Project Structure & Module Organization

- `src/`: React/TypeScript entry points, shared CSS, components, and feature modules.
- `src/features/`: domain logic grouped by concern, such as notes, Markdown, settings, windows, images, and updates.
- `src/locales/`: i18next resources and locale-specific JSON files.
- `src-tauri/src/`: Rust commands, services, desktop integration, and updater logic.
- `src-tauri/capabilities/` and `src-tauri/icons/`: Tauri permissions and packaged assets.
- `tests/`: repository-level frontend tests; most tests are colocated with their source.
- `Docs/`: translated guides, release notes, and screenshots.

## Build, Test, and Development Commands

Run `npm ci` first. Node.js 20.19+ or 22.12+ and stable Rust are required.

- `npm run tauri dev`: run the complete desktop app in development mode.
- `npm run dev`: run the Vite frontend only.
- `npm run build`: type-check and build the frontend.
- `npm run tauri build`: create platform-specific desktop bundles.
- `npm test`: run the Vitest suite once.
- `npm run lint`: run oxlint.
- `npm run fmt`: format supported frontend and documentation files.
- `cd src-tauri && cargo test`: run Rust unit tests.
- `cd src-tauri && cargo clippy --all-targets -- -D warnings`: enforce Rust linting.

## Coding Style & Naming Conventions

Use TypeScript strict mode and two-space formatting from oxfmt. React components and files use PascalCase (`SettingsPanel.tsx`); hooks begin with `use`; functions and feature files use camelCase. Rust follows `rustfmt` with snake_case modules and functions. Keep Tauri IPC wrappers in feature-level `api.ts` files.

## Testing Guidelines

Use Vitest for frontend tests and Rust's built-in test framework for backend code. Name frontend tests `*.test.ts` or `*.test.tsx` beside the implementation unless they validate repository-wide behavior. Add regression tests for fixes and cover platform-specific paths when relevant. There is no numeric coverage threshold; CI requires tests, formatting, and lint checks to pass.

## Commit & Pull Request Guidelines

Follow Conventional Commits: `feat: add note tagging`, `fix: prevent save race`, or `chore(deps): update vite`. Use matching branch names such as `feat/note-tagging`.

Target `main`, complete the PR template, link issues, identify tested platforms, and provide verification steps. Include screenshots or recordings for UI changes. Run the frontend and Rust checklists before review; CI must pass, and maintainers squash-merge approved PRs.

## Agent Memory Workflow

Project-specific agent memory is stored locally in `.agent-memory/MEMORY.md`. The directory is intentionally ignored by Git; use `Docs/agent-memory-template.md` to initialize it on a new machine.

- At the start of each task, read `.agent-memory/MEMORY.md` before planning or editing when the file exists.
- At the end of each completed task, append one concise entry using the shared template.
- Record one entry per complete task, not per file edit, command, or commit.
- Keep each entry to roughly 5–8 lines. Capture the goal, important outcomes, decisions or constraints, verification, and remaining work.
- Record why a change was made and its final result; do not duplicate Git diffs or full command output.
- Treat source code, configuration, tests, and Git history as authoritative. If memory conflicts with the repository, follow the repository and correct the memory entry.
- Never store passwords, API keys, tokens, private user data, or other secrets in agent memory.
- Move durable architectural decisions to an ADR or another tracked design document; memory may link to it but must not replace it.
