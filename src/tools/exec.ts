import { z } from 'zod';
import type { ToolDefinition, ToolContext } from '../shared/types.js';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Readable } from 'stream';

const inputSchema = z.object({
  container_id: z.string().describe('Container ID or name'),
  command: z.string().describe('Command to execute in the container'),
  stdin: z.string().optional().describe('Input to send to the command via stdin'),
  working_dir: z.string().optional().default('/home/ubuntu/workspace').describe('Working directory for the command'),
  user: z.string().optional().describe('User to run the command as'),
  env: z.array(z.string()).optional().describe('Environment variables (format: KEY=value)'),
  timeout: z.number().optional().default(30).describe('Command timeout in seconds')
});

// Helper function to execute command with better stdio handling
async function executeDockerCommand(
  docker: any,
  containerId: string,
  command: string,
  stdin?: string,
  workingDir?: string,
  user?: string,
  env?: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  try {
    const container = docker.getContainer(containerId);

    // Check if container is running
    const info = await container.inspect();
    if (!info.State.Running) {
      throw new Error(`Container '${containerId}' is not running`);
    }

    // Create exec instance
    const exec = await container.exec({
      Cmd: ['/bin/bash', '-c', command],
      AttachStdin: !!stdin,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
      WorkingDir: workingDir,
      User: user,
      Env: env
    });

    // Start execution
    const stream = await exec.start({
      Detach: false,
      Tty: false,
      stdin: !!stdin
    });

    let stdout = '';
    let stderr = '';

    // Handle stdin if provided
    if (stdin) {
      const stdinStream = new Readable();
      stdinStream.push(stdin);
      stdinStream.push(null); // End the stream
      stdinStream.pipe(stream);
    }

    // Docker multiplexes stdout/stderr in a special format
    const parseDockerStream = (data: Buffer): { stdout: string; stderr: string } => {
      let stdout = '';
      let stderr = '';
      let offset = 0;

      while (offset < data.length) {
        if (offset + 8 > data.length) break;

        const streamType = data[offset];
        const size = data.readUInt32BE(offset + 4);

        if (offset + 8 + size > data.length) break;

        const chunk = data.slice(offset + 8, offset + 8 + size).toString();

        if (streamType === 1) {
          stdout += chunk;
        } else if (streamType === 2) {
          stderr += chunk;
        }

        offset += 8 + size;
      }

      return { stdout, stderr };
    };

    // Collect all data
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    // Wait for completion
    await new Promise((resolve, reject) => {
      stream.on('end', resolve);
      stream.on('error', reject);
    });

    // Parse the collected data
    const allData = Buffer.concat(chunks);
    const parsed = parseDockerStream(allData);
    stdout = parsed.stdout;
    stderr = parsed.stderr;

    // Get exit code
    const execInfo = await exec.inspect();

    return {
      stdout,
      stderr,
      exitCode: execInfo.ExitCode
    };

  } catch (error) {
    throw error;
  }
}

async function handler(params: z.infer<typeof inputSchema>, context: ToolContext): Promise<CallToolResult> {
  const { container_id, command, stdin, working_dir, user, env, timeout } = params;
  const { docker } = context;

  try {
    const result = await Promise.race([
      executeDockerCommand(docker, container_id, command, stdin, working_dir, user, env),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Command timeout')), timeout * 1000)
      )
    ]);

    let output = '';
    if (result.stdout) {
      output += `STDOUT:\n${result.stdout}\n`;
    }
    if (result.stderr) {
      output += `STDERR:\n${result.stderr}\n`;
    }
    output += `Exit Code: ${result.exitCode}`;

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
        text: `Execution error: ${error instanceof Error ? error.message : 'Unknown error'}`
      }]
    };
  }
}

export const execCommand: ToolDefinition = {
  name: 'exec',
  description: 'Execute a command in a Docker container',
  inputSchema,
  handler
};