#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

async function main() {
  if (process.stdin.isTTY || process.argv.length > 2) {
    // CLI mode — user is interacting directly
    const { runCli } = await import('./cli.js');
    await runCli();
  } else {
    // MCP mode — stdin is piped from MCP client
    const { createServer } = await import('./server.js');
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('Vault MCP server running on stdio');
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
