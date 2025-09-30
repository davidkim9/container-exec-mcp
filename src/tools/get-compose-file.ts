import { z } from 'zod';
import type { ToolDefinition, ToolContext } from '../shared/types.js';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs/promises';
import path from 'path';

const inputSchema = z.object({
  compose_file: z.string().optional().default('docker/compose.yaml').describe('Path to the Docker Compose file relative to the MCP server working directory')
});

async function handler(params: z.infer<typeof inputSchema>, context: ToolContext): Promise<CallToolResult> {
  const { compose_file } = params;
  const { docker } = context;

  try {
    // Read the compose file from the host filesystem (where the MCP server is running)
    const possiblePaths = [
      compose_file,
      'docker/compose.yaml',
      'docker/compose.yml',
      'docker-compose.yaml',
      'docker-compose.yml',
      'compose.yaml',
      'compose.yml'
    ];

    let foundPath = '';
    let composeContent = '';

    // Try each possible path on the host filesystem
    for (const testPath of possiblePaths) {
      try {
        const resolvedPath = path.isAbsolute(testPath) ? testPath : path.resolve(process.cwd(), testPath);
        const content = await fs.readFile(resolvedPath, 'utf8');
        foundPath = testPath;
        composeContent = content;
        break;
      } catch {
        // Continue to next path
      }
    }

    if (!composeContent) {
      const output = `
Docker Compose file not found on host filesystem.

Searched for compose file in:
${possiblePaths.map(p => `- ${path.resolve(process.cwd(), p)}`).join('\n')}

💡 To view the compose file:
1. Make sure it exists in one of the searched locations
2. Specify the correct path with the compose_file parameter
3. Use an absolute path if the file is elsewhere

MCP Server working directory: ${process.cwd()}
      `.trim();

      return {
        content: [{
          type: 'text',
          text: output
        }]
      };
    }

    const output = `
Docker Compose Configuration (${foundPath}):
${'='.repeat(60)}

${composeContent}

${'='.repeat(60)}
File Location: ${path.resolve(process.cwd(), foundPath)}
    `.trim();

    return {
      content: [{
        type: 'text',
        text: output
      }]
    };

  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: `Error getting compose file: ${error instanceof Error ? error.message : 'Unknown error'}`
      }]
    };
  }
}

export const getComposeFile: ToolDefinition = {
  name: 'get_compose_file',
  description: 'Fetch and display the Docker Compose configuration file. This reads from the host filesystem where the MCP server is running, not from inside the container.',
  inputSchema,
  handler
};