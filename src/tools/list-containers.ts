import { z } from 'zod';
import type { ToolDefinition, ToolContext } from '../shared/types.js';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const inputSchema = z.object({
  all: z.boolean().optional().default(false).describe('Show all containers (default shows just running)')
});

async function handler(params: z.infer<typeof inputSchema>, context: ToolContext): Promise<CallToolResult> {
  const { all } = params;
  const { docker } = context;

  try {
    const containers = await docker.listContainers({ all });

    if (containers.length === 0) {
      return {
        content: [{
          type: 'text',
          text: all ? 'No containers found.' : 'No running containers found. Use all=true to see all containers.'
        }]
      };
    }

    // Format container list
    let output = `${all ? 'All' : 'Running'} Containers:\n${'='.repeat(80)}\n\n`;

    for (const container of containers) {
      const name = container.Names.map(n => n.replace(/^\//, '')).join(', ');
      const image = container.Image;
      const status = container.Status;
      const state = container.State;
      const ports = container.Ports.map(p => {
        if (p.PublicPort) {
          return `${p.IP || '0.0.0.0'}:${p.PublicPort}->${p.PrivatePort}/${p.Type}`;
        }
        return `${p.PrivatePort}/${p.Type}`;
      }).join(', ') || 'none';

      output += `Name:    ${name}\n`;
      output += `ID:      ${container.Id.substring(0, 12)}\n`;
      output += `Image:   ${image}\n`;
      output += `State:   ${state}\n`;
      output += `Status:  ${status}\n`;
      output += `Ports:   ${ports}\n`;
      output += '-'.repeat(80) + '\n\n';
    }

    return {
      content: [{
        type: 'text',
        text: output.trim()
      }]
    };

  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: `Error listing containers: ${error instanceof Error ? error.message : 'Unknown error'}`
      }]
    };
  }
}

export const listContainers: ToolDefinition = {
  name: 'list_containers',
  description: 'List Docker containers. By default shows only running containers, use all=true to show all containers including stopped ones.',
  inputSchema,
  handler
};