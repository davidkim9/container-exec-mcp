import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import cors from 'cors';
import express, { Request, Response } from 'express';
import Docker from 'dockerode';
import type { ToolContext } from './shared/types.js';
import { getAllTools } from './tools/registry.js';

/*
 * DOCKER CONTAINER MCP SERVER
 *
 * This MCP server provides Docker container management and execution capabilities.
 * It allows you to interact with Docker containers directly.
 *
 * FEATURES:
 *
 * 🐳 DOCKER OPERATIONS:
 * - List all containers (running and stopped)
 * - Inspect container details
 * - Execute commands in containers via Docker exec
 * - Interactive command execution with stdin support
 * - Better stdout/stderr handling and streaming
 * - Container information and status checking
 * - Start/stop containers
 * - View container logs
 *
 * USAGE:
 * Start the server and use the tools to manage Docker containers.
 * Example: npm run start
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

  console.log(`✅ Registered ${tools.length} tools:`);
  tools.forEach(tool => {
    console.log(`   • ${tool.name}: ${tool.description}`);
  });

  return server;
};

const app = express();
app.use(express.json({ limit: '50mb' }));

// Configure CORS
app.use(cors({
  origin: '*',
  exposedHeaders: ['Mcp-Session-Id']
}));

app.post('/mcp', async (req: Request, res: Response) => {
  const server = getServer();
  try {
    const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on('close', () => {
      console.log('Request closed');
      transport.close();
      server.close();
    });
  } catch (error) {
    console.error('Error handling MCP request:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal server error',
        },
        id: null,
      });
    }
  }
});

app.get('/mcp', async (req: Request, res: Response) => {
  console.log('Received GET MCP request');
  res.writeHead(405).end(JSON.stringify({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: "Method not allowed."
    },
    id: null
  }));
});

app.delete('/mcp', async (req: Request, res: Response) => {
  console.log('Received DELETE MCP request');
  res.writeHead(405).end(JSON.stringify({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: "Method not allowed."
    },
    id: null
  }));
});

// Start the server
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
app.listen(PORT, () => {
  console.log(`🐳 Docker Container MCP Server listening on port ${PORT}`);
  console.log('');
  console.log('🐳 DOCKER TOOLS:');
  console.log('- list_containers: List all containers (running and stopped)');
  console.log('- inspect_container: Get detailed container information');
  console.log('- exec: Execute commands in a container');
  console.log('- start_container: Start a stopped container');
  console.log('- stop_container: Stop a running container');
  console.log('- container_logs: Get container logs');
  console.log('- docker_info: Get Docker system information');
  console.log('');
  console.log('💡 USAGE EXAMPLES:');
  console.log('  list_containers: { "all": true }');
  console.log('  inspect_container: { "container_id": "my-container" }');
  console.log('  exec: { "container_id": "my-container", "command": "ls -la" }');
  console.log('  start_container: { "container_id": "my-container" }');
  console.log('');
});

// Handle server shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down Docker Container MCP server...');
  process.exit(0);
});