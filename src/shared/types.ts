import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import Docker from 'dockerode';

export interface ToolFunction {
  (params: any, context: ToolContext): Promise<CallToolResult>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodObject<any>;
  handler: ToolFunction;
}

export interface ToolContext {
  docker: Docker;
}