# Index Workspace

The user wants to build or rebuild the local semantic and lexical index of workspace files. Call the `index_workspace` MCP tool.

Return:
- A summary of the indexing results (builtAt, mode, chunkCount, fileCount, etc.)
- Confirmation that the index was written to `.wrapper/index/`

Do not index again unless the user asks.
