import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import cors from 'cors';
import express, { Request, Response } from 'express';
import Docker from 'dockerode';
import type { ToolContext } from './shared/types.js';
import { getAllTools } from './tools/registry.js';

/*
 * DOCKER CONTAINER MCP SERVER (HTTP)
 *
 * This is the HTTP version of the Docker Container MCP server.
 * It provides Docker container management and execution capabilities via HTTP transport.
 */

// Initialize Docker client
const docker = new Docker();

// Create tool context
const toolContext: ToolContext = {
  docker
};

// Authentication middleware
const authMiddleware = (req: Request, res: Response, next: () => void) => {
  const authToken = process.env.MCP_AUTH_TOKEN;
  
  // If no auth token is configured, skip authentication
  if (!authToken) {
    return next();
  }

  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    return res.status(401).json({
      jsonrpc: '2.0',
      error: {
        code: -32001,
        message: 'Authentication required. Please provide Authorization header.',
      },
      id: null,
    });
  }

  // Support both "Bearer <token>" and raw token formats
  const token = authHeader.startsWith('Bearer ') 
    ? authHeader.substring(7) 
    : authHeader;

  if (token !== authToken) {
    return res.status(403).json({
      jsonrpc: '2.0',
      error: {
        code: -32002,
        message: 'Invalid authentication token.',
      },
      id: null,
    });
  }

  next();
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

app.post('/mcp', authMiddleware, async (req: Request, res: Response) => {
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
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 4200;
app.listen(PORT, () => {
  console.log(`🐳 Docker Container MCP Server listening on port ${PORT}`);
  if (process.env.MCP_AUTH_TOKEN) {
    console.log('🔒 Authentication enabled');
  } else {
    console.log('⚠️  No MCP_AUTH_TOKEN set - running without authentication');
  }
});

// Handle server shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down Docker Container MCP server...');
  process.exit(0);
});