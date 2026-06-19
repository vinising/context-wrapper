# Local Context Wrapper

Local Context Wrapper is a Cursor-native sidecar for MacBooks. It uses a local model path, starting with MLX on Apple Silicon, to refine rough prompts, maintain a rolling context handoff, and support spec-driven development without replacing Cursor's hosted working model.

## What v1 Does

- Maintains `.wrapper/context/current.yaml`, `.wrapper/context/handoff.md`, and `.wrapper/context/decisions.yaml`.
- Recommends an MLX model tier from Mac hardware.
- Exposes local tools for prompt refinement, prompt scoring, context handoff reads, and context handoff updates.
- Packages Cursor-facing rules, commands, and hook guidance.

For internal logic, data flow, configuration knobs, and tweak points, see [docs/technical-reference.md](docs/technical-reference.md).

## Global CLI Integration (Command: `lcw`)

The Local Context Wrapper can be installed globally as a command-line binary. This allows you to set up, explore, diagnose, and run autonomous agent epics on any project directory on your machine.

### 1. Register Global CLI
Run this one-time command from the cloned Wrapper repository root:
```bash
npm link
```

### 2. Available Global Commands (`lcw`)
Once linked, you can execute the global `lcw` command from any terminal session, inside any project:

```bash
# 1. Setup, explore, and seed context for a target project
lcw setup

# 2. Check the health and readiness of services (Ollama, models, venvs)
lcw diagnose

# 3. Launch the tiered multi-agent framework on an epic autonomously
lcw auto "Implement dark mode toggle settings"

# 4. Rebuild the codebase semantic/lexical search index
lcw index

# 5. Create a task-scoped briefing document locally under .wrapper/runs/
lcw brief "implement setting toggles"
```

---

## Cursor Limitation

Cursor does not currently document a public extension API for transparently rewriting built-in chat prompts or using an arbitrary local model as the main Agent/chat model. This project uses supported surfaces instead: local MCP tools, rules, commands, skills, and hooks.

**Refinement is opt-in.** Normal chat does not run through the local model. Invoke refinement when you want it (see below).

## Quick Start

For this wrapper repo:

```bash
npm install
npm run setup:workspace
npm test
npm run typecheck
```

### Cursor integration (this repo)

This project includes a committed `.cursor/` folder:

| File | Purpose |
|------|---------|
| `.cursor/mcp.json` | Registers the local MCP sidecar (`scripts/run-mcp.sh`) |
| `.cursor/rules/local-context-wrapper.mdc` | Tells the Agent **not** to auto-refine; use tools on request |
| `.cursor/commands/lcw-refine.md` | Slash command → `refine_prompt` MCP tool |
| `.cursor/commands/lcw-handoff.md` | Slash command → `update_context_handoff` MCP tool |
| `.cursor/commands/lcw-brief.md` | Slash command → `build_agent_brief` MCP tool |
| `.cursor/commands/lcw-index.md` | Slash command → `index_workspace` MCP tool |
| `.cursor/commands/lcw-auto.md` | Slash command → `local_draft_plan` to start granular hybrid loop |
| `.cursor/commands/lcw-diagnose.md` | Slash command → `diagnose_setup` MCP server diagnostics |
| `.cursor/commands/lcw-compact.md` | Slash command → MCP-gated `local_compact_conversation` (verify server availability first) |
| `.cursor/commands/lcw-map.md` | Slash command → `get_code_signature_map` to map file code signatures |
| `.cursor/commands/lcw-docs.md` | Slash command → `local_refresh_docs` for docs hygiene updates |
| `.cursor/commands/lcw-git.md` | Slash command → `local_git_hygiene` for safe stage/commit hygiene |
| `.cursor/commands/lcw-fileread.md` | Slash command → `local_file_read` for threshold-guarded reads + projection cache |

After opening this folder in Cursor, reload the window (or restart Cursor) so MCP picks up `.cursor/mcp.json`.

For `/lcw-compact`, check in this order:
1. MCP server connectivity (`local-context-wrapper` is enabled and tools are available)
2. Then runtime readiness (Ollama + required models) if needed

Do not run long debugging loops for compaction before confirming MCP connectivity.

### Cursor integration (another project)

From this wrapper repo, install MCP + rules into a target project:

```bash
npm run setup:cursor -- /path/to/your/project
```

That writes `.cursor/mcp.json` (with absolute path to `scripts/run-mcp.sh` and `WRAPPER_WORKSPACE_ROOT` set to your project), plus rules and slash commands. Also run workspace setup on the target:

```bash
npm --prefix /Users/vinising/Desktop/Projects/Wrapper run setup:workspace -- /path/to/your/project
```

## How to refine a prompt (on demand)

Choose one of these — none run automatically on every chat message.

### 1. Slash command in Cursor

Type `/lcw-refine` and include your rough request. The Agent should call the `refine_prompt` MCP tool and return the refined text, `targetFiles` anchors, and `historyPath`.

### 2. CLI smoke test (no Cursor)

```bash
WRAPPER_RUNTIME=ollama WRAPPER_OLLAMA_MODEL=gemma4:12b-mlx \
npm run smoke:refine -- "Implement context handoff updates for planning tasks"
```

Output is JSON in the terminal and a Markdown file under `.wrapper/prompts/`. With Ollama configured, the score comes from the local model (`scoringMethod: "llm"`), not keyword heuristics.

### 3. MCP tool directly

With the sidecar connected, ask the Agent to call `refine_prompt` with your rough text and optional `intent`.

### Refresh handoff

Use `/lcw-handoff` after meaningful progress, or call `update_context_handoff` via MCP.

### Semantic Indexing & Agent Briefs

To save tokens and keep Cursor's hosted Agent highly focused, you can index your workspace locally and build task-scoped execution briefs.

#### 1. Index the workspace
Type `/lcw-index` in Cursor, or run the CLI smoke test:
```bash
npm run smoke:index
```
This walks your codebase, chunks files, and generates local embeddings using Ollama (defaulting to the `nomic-embed-text` model, and falling back to lexical term overlap if Ollama is offline). Chunks and manifest are saved under `.wrapper/index/` (which is git-ignored).

#### 2. Build a task brief
Type `/lcw-brief "implement feature X"` in Cursor, or run the CLI smoke test:
```bash
npm run smoke:brief -- "implement feature X"
```
This reads your project handoff, accepted decisions, retrieves the top-k relevant code snippets from your local index, and uses the local model to build a compact, structured brief under `.wrapper/runs/` (git-ignored).

#### 3. Use the brief
In a new chat or when creating a sub-agent, use `@` to reference the generated brief file (e.g. `@.wrapper/runs/2026-06-16T...-brief.md`). This gives the agent precise context, constraints, and acceptance criteria without bloating its context with full-file reads or unnecessary searches.

### Automation hygiene (`/lcw-docs`, `/lcw-git`)

When a plan finishes, LCW can run a hygiene pass based on `.wrapper/policy.yaml`:

- **Docs hygiene:** `local_refresh_docs` updates docs using `smart_touched` or `full` scope.
- **Git hygiene:** `local_git_hygiene` stages plan-scoped files and can create a commit.
- **Push policy:** pushes are never automatic; explicit user approval is still required.

You can also run these commands manually:

- `/lcw-docs` to preview/apply documentation refreshes.
- `/lcw-git` to preview/apply plan-scoped or all-tracked git hygiene.

## Workspace setup

For any new or existing project, run setup from this repo and pass the target project path:

```bash
npm --prefix /Users/vinising/Desktop/Projects/Wrapper run setup:workspace -- /path/to/project
```

That creates `.wrapper/` in the target project. Keep these files reviewable in git:

- `.wrapper/context/current.yaml`
- `.wrapper/context/handoff.md`
- `.wrapper/context/decisions.yaml`
- `.wrapper/context/runtime-profile.yaml`
- `.wrapper/policy.yaml`

Generated prompt outputs are written to `.wrapper/prompts/` and ignored by git. The default policy keeps only the latest 20 prompt files, configurable in `.wrapper/policy.yaml`.

## Local model runtime

Recommended production path: **Ollama + Gemma 4** (`gemma4:12b-mlx`). The MCP launcher (`scripts/run-mcp.sh`) defaults to this when env vars are unset.

```bash
brew install ollama
ollama serve
ollama pull gemma4:12b-mlx
```

Manual MCP (without Cursor):

```bash
npm run mcp
```

## Privacy Defaults

The default workspace policy disables raw prompt logs, enables secret redaction, keeps `.wrapper/index/`, `.wrapper/runs/`, and `.wrapper/prompts/` out of git, and stores current context as human-readable YAML/Markdown.

### Optional: MLX bridge

To use a real MLX subprocess bridge instead of Ollama, set `WRAPPER_MLX_COMMAND_JSON` to a JSON array command that reads stdin JSON and returns refined text on stdout.

Example:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r scripts/requirements-mlx.txt
export WRAPPER_MLX_COMMAND_JSON='["/absolute/path/to/project/.venv/bin/python","/absolute/path/to/project/scripts/mlx_generate.py"]'
export WRAPPER_MODEL_ID_OVERRIDE="mlx-community/Qwen2.5-1.5B-Instruct-4bit"
npm run smoke:refine -- "Refine this rough implementation request"
```

If model download fails because of network TLS/certificate policies, keep using the same bridge command but set `WRAPPER_MODEL_ID_OVERRIDE` to a local model path after downloading in an allowed environment.

Recommended model for 24 GB Apple Silicon (MLX tier): `mlx-community/gemma-3-4b-it-4bit`.
