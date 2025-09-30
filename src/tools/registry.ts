import type { ToolDefinition } from '../shared/types.js';

// Docker container management tools
import { execCommand } from './exec.js';
import { getComposeFile } from './get-compose-file.js';

/**
 * Docker Container Tool Registry
 *
 * This toolkit provides Docker container management capabilities:
 * - exec: Execute commands in containers
 * - get_compose_file: View the Docker Compose configuration
 */
export const AVAILABLE_TOOLS: ToolDefinition[] = [
  execCommand,
  getComposeFile
];

/**
 * Get all registered tools
 */
export function getAllTools(): ToolDefinition[] {
  return AVAILABLE_TOOLS;
}

/**
 * Get a specific tool by name
 */
export function getToolByName(name: string): ToolDefinition | undefined {
  return AVAILABLE_TOOLS.find(tool => tool.name === name);
}