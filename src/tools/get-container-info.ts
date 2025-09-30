import { z } from 'zod';
import type { ToolDefinition, ToolContext } from '../shared/types.js';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const inputSchema = z.object({
  container_id: z.string().describe('Container ID or name')
});

async function handler(params: z.infer<typeof inputSchema>, context: ToolContext): Promise<CallToolResult> {
  const { container_id } = params;
  const { docker } = context;

  try {
    const container = docker.getContainer(container_id);
    const info = await container.inspect();

    // Format the output
    const name = info.Name.replace(/^\//, '');
    const state = info.State;
    const config = info.Config;
    const hostConfig = info.HostConfig;
    const networkSettings = info.NetworkSettings;

    let output = `Container Information: ${name}\n${'='.repeat(80)}\n\n`;

    // Basic Info
    output += `ID:      ${info.Id}\n`;
    output += `Name:    ${name}\n`;
    output += `Image:   ${config.Image}\n`;
    output += `Created: ${info.Created}\n\n`;

    // State
    output += `State:\n`;
    output += `  Status:     ${state.Status}\n`;
    output += `  Running:    ${state.Running}\n`;
    output += `  Paused:     ${state.Paused}\n`;
    output += `  Restarting: ${state.Restarting}\n`;
    output += `  Pid:        ${state.Pid}\n`;
    output += `  Exit Code:  ${state.ExitCode}\n`;
    if (state.StartedAt) output += `  Started:    ${state.StartedAt}\n`;
    if (state.FinishedAt && state.FinishedAt !== '0001-01-01T00:00:00Z') {
      output += `  Finished:   ${state.FinishedAt}\n`;
    }
    output += '\n';

    // Network
    output += `Network:\n`;
    output += `  IP Address: ${networkSettings.IPAddress || 'none'}\n`;
    output += `  Gateway:    ${networkSettings.Gateway || 'none'}\n`;

    if (networkSettings.Ports && Object.keys(networkSettings.Ports).length > 0) {
      output += `  Ports:\n`;
      for (const [containerPort, hostBindings] of Object.entries(networkSettings.Ports)) {
        if (hostBindings && Array.isArray(hostBindings)) {
          for (const binding of hostBindings) {
            output += `    ${binding.HostIp}:${binding.HostPort} -> ${containerPort}\n`;
          }
        } else {
          output += `    ${containerPort} (not published)\n`;
        }
      }
    }

    if (networkSettings.Networks && Object.keys(networkSettings.Networks).length > 0) {
      output += `  Networks:\n`;
      for (const [networkName, networkInfo] of Object.entries(networkSettings.Networks)) {
        output += `    ${networkName}: ${(networkInfo as any).IPAddress || 'no IP'}\n`;
      }
    }
    output += '\n';

    // Mounts/Volumes
    if (info.Mounts && info.Mounts.length > 0) {
      output += `Mounts:\n`;
      for (const mount of info.Mounts) {
        output += `  ${mount.Type}: ${mount.Source} -> ${mount.Destination}\n`;
        if (mount.Mode) output += `    Mode: ${mount.Mode}\n`;
      }
      output += '\n';
    }

    // Environment Variables
    if (config.Env && config.Env.length > 0) {
      output += `Environment:\n`;
      for (const env of config.Env) {
        output += `  ${env}\n`;
      }
      output += '\n';
    }

    // Command
    if (config.Cmd && Array.isArray(config.Cmd) && config.Cmd.length > 0) {
      output += `Command: ${config.Cmd.join(' ')}\n`;
    }
    if (config.Entrypoint && Array.isArray(config.Entrypoint) && config.Entrypoint.length > 0) {
      output += `Entrypoint: ${config.Entrypoint.join(' ')}\n`;
    }
    if (config.WorkingDir) {
      output += `Working Dir: ${config.WorkingDir}\n`;
    }
    output += '\n';

    // Resource Limits
    output += `Resources:\n`;
    if (hostConfig.Memory) output += `  Memory: ${(hostConfig.Memory / 1024 / 1024).toFixed(0)} MB\n`;
    if (hostConfig.CpuShares) output += `  CPU Shares: ${hostConfig.CpuShares}\n`;
    if (hostConfig.NanoCpus) output += `  CPU Limit: ${hostConfig.NanoCpus / 1000000000} cores\n`;

    output += `\nRestart Policy: ${hostConfig.RestartPolicy?.Name || 'no'}`;
    if (hostConfig.RestartPolicy?.MaximumRetryCount) {
      output += ` (max: ${hostConfig.RestartPolicy.MaximumRetryCount})`;
    }

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
        text: `Error getting container info: ${error instanceof Error ? error.message : 'Unknown error'}`
      }]
    };
  }
}

export const getContainerInfo: ToolDefinition = {
  name: 'get_container_info',
  description: 'Get detailed information about a specific Docker container including state, network, mounts, environment, and resource configuration.',
  inputSchema,
  handler
};