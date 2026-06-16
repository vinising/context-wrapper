import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

export type SandboxContext = {
  fixtureType: string;
  path: string;
  cleanup: () => Promise<void>;
};

export async function createSandbox(fixtureType: string): Promise<SandboxContext> {
  const path = await mkdtemp(join(tmpdir(), `wrapper-eval-sandbox-${fixtureType}-`));

  // Initialize standard fixture skeletons based on type
  if (fixtureType === "empty-node-project" || fixtureType === "mini-mcp-stub") {
    await writeFile(
      join(path, "package.json"),
      JSON.stringify(
        {
          name: `fixture-${fixtureType}`,
          version: "1.0.0",
          private: true,
          type: "module",
          dependencies: {
            zod: "^3.0.0"
          }
        },
        null,
        2
      ),
      "utf8"
    );
    await mkdir(join(path, "src"), { recursive: true });
    await writeFile(
      join(path, "src/index.ts"),
      "console.log('hello from fixture');\n",
      "utf8"
    );
  } else if (fixtureType === "repo-with-drift") {
    await mkdir(join(path, "src"), { recursive: true });
    await writeFile(
      join(path, "src/index.ts"),
      "console.log('stale implementation');\n",
      "utf8"
    );
    await writeFile(
      join(path, "src/utils.ts"),
      "export function staleHelper() { return true; }\n",
      "utf8"
    );
  } else if (fixtureType === "autonomous-epic") {
    await mkdir(join(path, "src"), { recursive: true });
    await writeFile(
      join(path, "package.json"),
      JSON.stringify(
        {
          name: "autonomous-epic-emitter",
          version: "1.0.0",
          private: true,
          type: "module"
        },
        null,
        2
      ),
      "utf8"
    );
  }

  const cleanup = async () => {
    await rm(path, { recursive: true, force: true });
  };

  return {
    fixtureType,
    path,
    cleanup
  };
}
