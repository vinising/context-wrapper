import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["packages/**/*.test.ts"]
  },
  resolve: {
    alias: {
      "@wrapper/schemas": new URL("./packages/schemas/src/index.ts", import.meta.url).pathname,
      "@wrapper/context-store": new URL("./packages/context-store/src/index.ts", import.meta.url).pathname,
      "@wrapper/model-router": new URL("./packages/model-router/src/index.ts", import.meta.url).pathname,
      "@wrapper/mcp-server": new URL("./packages/mcp-server/src/index.ts", import.meta.url).pathname,
      "@wrapper/mlx-runner": new URL("./packages/mlx-runner/src/index.ts", import.meta.url).pathname,
      "@wrapper/semantic-index": new URL("./packages/semantic-index/src/index.ts", import.meta.url).pathname,
      "@wrapper/eval-harness": new URL("./packages/eval-harness/src/index.ts", import.meta.url).pathname,
      "@wrapper/agent-framework": new URL("./packages/agent-framework/src/index.ts", import.meta.url).pathname
    }
  }
});
