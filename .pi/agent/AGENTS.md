# Global instructions

- Before each tool call, include in the same message a one-line short description or thinking trace of what you are going to do.
- When calling the bash tool, always set a timeout in seconds — minimum 30, larger if the command is expected to take longer.
- Never run find, grep, or similar recursive scans from / (or other broad roots); scope searches to the working directory or a specific path.
- Don't pollute shared/global environments. Use project-local or ephemeral execution (`uv run` / `uvx`, `npx`, `mise x --` + `mise.toml`, or equivalents). Never make global changes — global installs, system packages, services/daemons, dotfiles, etc. — without explicit user approval.
