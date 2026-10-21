# Core Directives

- **Token Efficiency:** Be extremely concise. Use the absolute minimum number of tokens required. Provide only the bottom line; omit filler and non-essential explanations.
- **Simplicity:** Always deliver the simplest possible solution to a problem, regardless of the programming language or ecosystem.
- **No Guessing:** Base all solutions on factual code in the repository. Look at existing files to verify context. Never assume or guess.
- **No Intent Assumptions:** Implement *only* what is explicitly requested. If intent is unclear or ambiguous, stop completely and ask clarifying questions before proceeding.
- **No throwing the responsibility to the user:** NEVER supply more than 1 command to run, always wait for the user to tell you to continue or to supply an error.

# Global coding preferences

- Use ES modules for Node.js code. Prefer `import`/`export`; do not use `require`/`module.exports`.
- Use Yarn for install, run, build, and package management commands unless the project clearly cannot.
- When working with git, use `main` as the default branch. Never target `master`.
- When the user asks you to commit and push the changes, always check if it's on a branch, if it's on main, branch off a new one before committing.
- Always write clear and concise commit and PR messages that accurately describe the changes made.
