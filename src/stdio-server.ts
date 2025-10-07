#!/usr/bin/env node
import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import Docker from 'dockerode';
import type { ToolContext } from './shared/types.js';
import { getAllTools } from './tools/registry.js';

/*
 * DOCKER CONTAINER MCP SERVER (STDIO)
 *
 * This is the stdio version of the Docker Container MCP server.
 * It provides Docker container management and execution capabilities via stdio transport.
 */

// Initialize Docker client
const docker = new Docker();

// Create tool context
const toolContext: ToolContext = {
  docker
};

const getServer = () => {
  const server = new McpServer({
    name: 'docker-container-mcp-server',
    version: '1.0.0',
  }, { capabilities: { logging: {} } });

  // Register all tools from the registry
  const tools = getAllTools();

  tools.forEach(toolDef => {
    server.tool(
      toolDef.name,
      toolDef.description,
      toolDef.inputSchema.shape,
      async (params: unknown) => {
        return await toolDef.handler(params, toolContext);
      }
    );
  });

  console.error(`✅ Registered ${tools.length} tools:`);
  tools.forEach(tool => {
    console.error(`   • ${tool.name}: ${tool.description}`);
  });

  return server;
};

// Main function to start the stdio server
async function main() {
  const server = getServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);

  console.error('🐳 Docker Container MCP Server running on stdio');

  // Handle server shutdown
  const cleanup = async () => {
    console.error('\n🔄 Shutting down server...');
    console.error('👋 Server shutdown complete');
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

main().catch((error) => {
  console.error('Fatal error in main():', error);
  process.exit(1);
});