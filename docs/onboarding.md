# Onboarding

For architecture, scoring logic, runtime selection, and configuration reference, see [technical-reference.md](./technical-reference.md).

## 1. Global Setup (Recommended)

To install the Local Context Wrapper globally so you can use it in any directory on your computer:

```bash
# 1. Install dependencies
npm install

# 2. Register global 'lcw' CLI command
npm link
```

### Setup any project in 1 command
Once linked, navigate to **any project directory** on your machine and run:
```bash
lcw setup
```
This single command runs workspace setup, automated project exploration, copies slash commands, registers MCP inside `.cursor/mcp.json`, and downloads all needed models in the background.

To check setup health at any time, run:
```bash
lcw diagnose
```

---

## 2. Verify The Prototype

```bash
npm test
npm run typecheck
```

## 3. Start The Local Sidecar

```bash
npm run mcp
```

The MCP entrypoint initializes `.wrapper/` in the current workspace if no handoff exists.

For explicit setup output (recommended in each project root):

```bash
npm run setup:workspace
```

To initialize a different new or existing project from this wrapper repo:

```bash
npm --prefix /Users/vinising/Desktop/Projects/Wrapper run setup:workspace -- /path/to/project
```

This creates `.wrapper/` in the target project. Current context and policy files are meant to be reviewable. Generated prompt output lives in `.wrapper/prompts/` and is ignored by git.

## 4. Model Runtime

The first runtime target is Apple Silicon with MLX. The model router currently recommends tiers by platform, architecture, and unified memory:

- `base`: 8-15 GB Apple Silicon machines.
- `standard`: 16-31 GB Apple Silicon machines.
- `pro`: 32 GB+ Apple Silicon machines.
- `fallback`: non-Apple-Silicon machines.

### Recommended Path: Ollama + Gemma 4

If Hugging Face download/auth/TLS is blocked, run with Ollama first:

```bash
brew install ollama
ollama serve
ollama pull gemma4:e4b
ollama pull nomic-embed-text
```

Then run this project in Ollama mode:

```bash
WRAPPER_RUNTIME=ollama \
WRAPPER_OLLAMA_MODEL=gemma4:e4b \
npm run smoke:refine -- "Implement context-aware prompt refinement for this repo"
```

By default, the generator runs in deterministic fallback mode so the prototype is testable without downloading a model.

Install MLX runtime once:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r scripts/requirements-mlx.txt
```

To bridge real local inference, set:

```bash
export WRAPPER_MLX_COMMAND_JSON='["/absolute/path/to/project/.venv/bin/python","/absolute/path/to/project/scripts/mlx_generate.py"]'
```

The bridge command must read JSON from stdin and write refined text to stdout.
You can also set `WRAPPER_MODEL_ID_OVERRIDE` to force a specific MLX model.

If your environment blocks Hugging Face TLS verification, the bridge may fail to download the model and the wrapper will fall back automatically. In that case, either:

- configure your corporate CA trust for Python requests, or
- pre-download the model once and point `WRAPPER_MODEL_ID_OVERRIDE` to the local model directory.

### Recommended MLX Model IDs

- `base` (8-15 GB): `mlx-community/gemma-3-1b-it-4bit`
- `standard` (16-31 GB): `mlx-community/gemma-3-4b-it-4bit`
- `pro` (32+ GB): `mlx-community/gemma-3-12b-it-4bit`

For your current machine profile (24 GB Apple Silicon), start with:

- `mlx-community/gemma-3-4b-it-4bit`

### Manual Download Fallback

If TLS/auth issues block runtime download, fetch the model manually and use a local path:

```bash
source .venv/bin/activate
pip install "huggingface_hub[cli]"
hf download mlx-community/gemma-3-4b-it-4bit --local-dir ./models/gemma-3-4b-it-4bit
```

Then run with:

```bash
WRAPPER_MLX_COMMAND_JSON='["/absolute/path/to/project/.venv/bin/python","/absolute/path/to/project/scripts/mlx_generate.py"]' \
WRAPPER_MODEL_ID_OVERRIDE='/absolute/path/to/project/models/gemma-3-4b-it-4bit' \
npm run smoke:refine -- "Build robust prompt-refinement workflow with acceptance criteria and tests"
```

## 5. Cursor Workflow

Refinement is **opt-in**. Normal chat does not run through the local model.

This repo includes `.cursor/mcp.json`, rules, and slash commands. For another project:

```bash
npm run setup:cursor -- /path/to/your/project
```

Invoke refinement when you want it:

- `/refine-prompt` in Cursor (calls `refine_prompt` MCP tool)
- `/refresh-handoff` to update `.wrapper/context/`
- `npm run smoke:refine -- "..."` from the terminal

Reload Cursor after changing `.cursor/mcp.json`. See [README.md](../README.md) and [technical-reference.md](./technical-reference.md) for full configuration.

## 6. Local Smoke Test

```bash
npm run smoke:refine -- "Implement a local prompt refiner quickly"
```

This runs setup, executes refinement, and prints a JSON payload with score, missing context, recommended questions, and refined prompt.
It also writes a timestamped Markdown output under `.wrapper/prompts/`.
Retention is controlled by `.wrapper/policy.yaml`:

```yaml
promptHistory:
  enabled: true
  directory: .wrapper/prompts
  maxEntries: 20
```

Cursor can still see the latest output if you open it directly, but project-wide search should not pull prompt history into context because `.wrapper/prompts/` is git-ignored.

For real local generation:

```bash
WRAPPER_MLX_COMMAND_JSON='["/absolute/path/to/project/.venv/bin/python","/absolute/path/to/project/scripts/mlx_generate.py"]' \
WRAPPER_MODEL_ID_OVERRIDE='mlx-community/Qwen2.5-0.5B-Instruct-4bit' \
npm run smoke:refine -- "Build robust prompt-refinement workflow with acceptance criteria and tests"
```
