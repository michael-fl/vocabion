# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev:all      # start both backend (localhost:3000) and Vite frontend (localhost:5173)
npm run dev:server   # backend only — node --experimental-transform-types server/index.ts
npm run dev          # Vite frontend only (localhost:5173)
npm run build        # type-check with tsc, then Vite production build → dist/
npm run preview      # serve the production build locally
npm run lint         # ESLint with strict TypeScript rules
npm test             # run all tests once
npm run test:watch   # run tests in watch mode
npm run test:coverage  # run tests with V8 coverage report → coverage/index.html
```

Run a single test file:
```bash
npx vitest run src/screens/HomeScreen.test.tsx
```

## Vocabulary import

To import AI-generated word sets into the database, read **`scripts/IMPORT-VOCAB.md`** first — it contains the full workflow, file format, script usage, and retry logic.

## Architecture

Minimal Vite + React + TypeScript SPA. Entry point is `index.html` → `src/main.tsx` → `src/App.tsx`.

**TypeScript config** is split across three files:
- `tsconfig.json` — project references root (no compiler options of its own)
- `tsconfig.app.json` — applies to `src/`; strict mode + `noUnusedLocals`, `noUnusedParameters`, bundler module resolution
- `tsconfig.node.json` — applies to `vite.config.ts`

**ESLint** (`eslint.config.js`) uses flat config with `tseslint.configs.strictTypeChecked` + `stylisticTypeChecked`, React hooks rules, and `@typescript-eslint/consistent-type-imports`. Type-aware linting is enabled via `parserOptions.projectService`.

Key constraints enforced by the lint/TS config:
- No non-null assertions (`!`) — use explicit null checks instead
- No unused variables or imports
- Consistent `import type` for type-only imports

## General coding rules

**R1: Always use curly braces, even for single line conditions or loops**

Example:

Wrong:
```
if (a > 1)
    console.log("a is greater than 1");
```

Correct:
```
if (a > 1) {
    console.log("a is greater than 1");
}
```

**R2: Avoid code duplication if possible**

Refactor common code into own methods, except readability gets downgraded.

**R3: Use blank lines where useful to improve code readability**

Add a blank line before or after below's statements to improve readability of the code:
- Before Loops
- After local variable declarations
- Before return statement
- Before comments
- Before and after code blocks that span multiple lines.
- Before and after code that belongs semantically together.

**R4: Use latest TypeScript language features**
- Use latest TypeScript language features where appropriate

**R5: Add API doc**
- Add class/file documentation to all new classes/files. It should explain the purpose of the class/file, including usage code examples.
- Add documentation to all public/exported methods/functions of a public file
- Add documentation to (package) private methods/functions only if the method is complex and needs further explanation. Otherwise, don't add it.

**R6: Do not use Hungarian-style prefixes or suffixes on type names**
- Do not prefix interfaces with `I` (e.g. `IVocabRepository` → `VocabRepository`)
- Do not suffix types with their kind (e.g. `VocabRepositoryInterface`, `UserTypeType`)
- When a concrete class needs to be distinguished from its interface, describe what it *is*:
  `VocabRepository` (interface) + `SqliteVocabRepository` (concrete class)

**R7: Cover all new code with tests**
- Write tests for every new module, service, utility, and non-trivial component.
- The project targets **> 80% code coverage** overall; do not merge code that would drop it below that threshold.
- Test files live next to the code they test (e.g. `vocabService.test.ts` beside `vocabService.ts`).
- Prefer testing behaviour over implementation details.

**R8: Run unit tests after each task**
- Run unit tests at least once during your work.
- Run unit tests at the end of each task.
- Make sure all tests succeed to ensure that no regression was introduced.
- Never complete a task if the project does not yet compile or tests fail (except those errors existed before and are not related to your task).

**R9: Keep the linter clean**
- Run `npm run lint` on every file you create or modify as part of a task.
- Fix all lint errors introduced by your changes before considering the task done.
- Never complete a task if `npm run lint` reports errors in files you touched (pre-existing errors in unrelated files are acceptable, but do not add new ones).

**R10: Keep README and project plan up to date**
- If this repository contains a `README.md` or a project plan file (e.g. `PROJECT-PLAN.md`), they must always reflect the current state of the codebase.
- At the end of every task, check whether any changes you made affect content in those files (feature descriptions, session types, thresholds, eligibility rules, architecture notes, feature matrices, etc.) and apply the necessary updates before closing the task.
- Never consider a task complete without having checked both files.