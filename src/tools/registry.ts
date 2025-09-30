import type { ToolDefinition } from '../shared/types.js';

// Docker container management tools
import { execCommand } from './exec.js';
import { listContainers } from './list-containers.js';
import { getContainerInfo } from './get-container-info.js';

/**
 * Docker Container Tool Registry
 *
 * This toolkit provides Docker container management capabilities:
 * - exec: Execute commands in containers
 * - list_containers: List Docker containers
 * - get_container_info: Get detailed information about a container
 */
export const AVAILABLE_TOOLS: ToolDefinition[] = [
  execCommand,
  listContainers,
  getContainerInfo
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