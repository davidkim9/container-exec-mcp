import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import cors from 'cors';
import express, { Request, Response } from 'express';
import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';
import Docker from 'dockerode';
import { Readable } from 'stream';

/*
 * DOCKER CODE EDITING MCP SERVER
 * 
 * This MCP server combines Docker container execution with comprehensive code editing capabilities.
 * It allows you to execute commands and edit files directly inside a Docker container.
 * 
 * FEATURES:
 * 
 * 🐳 DOCKER OPERATIONS:
 * - Execute commands in a specific Docker container via Docker exec
 * - Interactive command execution with stdin support
 * - Better stdout/stderr handling and streaming
 * - Container information and status checking
 * - Environment variable configuration (DOCKER_CONTAINER_ID)
 * 
 * 📝 CODE EDITING (INSIDE CONTAINER):
 * - Read files from inside the container
 * - Write/create files inside the container
 * - Search and replace text in container files
 * - Multi-edit operations for atomic changes
 * - Directory listing inside container
 * - File search with glob patterns
 * - Grep/ripgrep search inside container
 * - File deletion inside container
 * 
 * USAGE:
 * Set DOCKER_CONTAINER_ID environment variable to target container ID/name
 * Example: DOCKER_CONTAINER_ID=my-container npm run start:docker-code
 * 
 * All file operations are performed inside the target container, making this ideal
 * for development workflows where you need to edit code running in Docker.
 */

// Get target container from environment variable
const TARGET_CONTAINER = process.env.DOCKER_CONTAINER_ID;

if (!TARGET_CONTAINER) {
  console.error('❌ DOCKER_CONTAINER_ID environment variable is required');
  console.error('   Example: DOCKER_CONTAINER_ID=my-container npm run start:docker-code');
  process.exit(1);
}

const getServer = () => {
  const server = new McpServer({
    name: 'docker-code-editing-mcp-server',
    version: '1.0.0',
  }, { capabilities: { logging: {} } });

  // Initialize Docker client
  const docker = new Docker();

  // Helper function to execute command with better stdio handling
  const executeDockerCommand = async (
    command: string, 
    stdin?: string, 
    workingDir?: string, 
    user?: string, 
    env?: string[]
  ): Promise<{ stdout: string; stderr: string; exitCode: number | null }> => {
    try {
      const container = docker.getContainer(TARGET_CONTAINER);
      
      // Check if container is running
      const info = await container.inspect();
      if (!info.State.Running) {
        throw new Error(`Container '${TARGET_CONTAINER}' is not running`);
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
  };

  // Helper function to escape shell arguments
  const escapeShellArg = (arg: string): string => {
    return `'${arg.replace(/'/g, "'\\''")}'`;
  };

  // DOCKER EXECUTION TOOLS

  // Tool: Execute command in target container
  server.tool(
    'exec',
    'Execute a command in the target Docker container',
    {
      command: z.string().describe('Command to execute in the container'),
      stdin: z.string().optional().describe('Input to send to the command via stdin'),
      working_dir: z.string().optional().describe('Working directory for the command'),
      user: z.string().optional().describe('User to run the command as'),
      env: z.array(z.string()).optional().describe('Environment variables (format: KEY=value)'),
      timeout: z.number().optional().default(30).describe('Command timeout in seconds')
    },
    async ({ command, stdin, working_dir, user, env, timeout }): Promise<CallToolResult> => {
      try {
        const result = await Promise.race([
          executeDockerCommand(command, stdin, working_dir, user, env),
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
  );

  // Tool: Get Docker Compose file
  server.tool(
    'get_compose_file',
    'Fetch and display the Docker Compose configuration file. This reads from the host filesystem where the MCP server is running, not from inside the container.',
    {
      compose_file: z.string().optional().default('docker/compose.yaml').describe('Path to the Docker Compose file relative to the MCP server working directory')
    },
    async ({ compose_file }): Promise<CallToolResult> => {
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
          // If not found, provide helpful information and container details
          const container = docker.getContainer(TARGET_CONTAINER);
          const info = await container.inspect();
          
          const output = `
Docker Compose file not found on host filesystem.

Container Information:
Target Container: ${TARGET_CONTAINER}
Name: ${info.Name}
ID: ${info.Id.substring(0, 12)}
Image: ${info.Config.Image}
State: ${info.State.Status}
Started: ${info.State.StartedAt}
Working Dir: ${info.Config.WorkingDir || '/'}
User: ${info.Config.User || 'root'}

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
Target Container: ${TARGET_CONTAINER}
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
  );

  // FILE EDITING TOOLS (INSIDE CONTAINER)

  // Tool: Read file from container
  server.tool(
    'read_file',
    'Reads a file from inside the Docker container. You can optionally specify a line offset and limit for large files. Lines in the output are numbered starting at 1.',
    {
      target_file: z.string().describe('The path of the file to read inside the container'),
      offset: z.number().optional().describe('The line number to start reading from. Only provide if the file is too large to read at once.'),
      limit: z.number().optional().describe('The number of lines to read. Only provide if the file is too large to read at once.')
    },
    async ({ target_file, offset, limit }): Promise<CallToolResult> => {
      try {
        // First check if file exists
        const checkResult = await executeDockerCommand(`test -f ${escapeShellArg(target_file)} && echo "exists" || echo "not found"`);
        if (checkResult.stdout.trim() !== 'exists') {
          return {
            content: [{
              type: 'text',
              text: `Error: File not found: ${target_file}`
            }]
          };
        }

        // Read the file
        const catResult = await executeDockerCommand(`cat ${escapeShellArg(target_file)}`);
        if (catResult.exitCode !== 0) {
          return {
            content: [{
              type: 'text',
              text: `Error reading file: ${catResult.stderr}`
            }]
          };
        }

        const content = catResult.stdout;
        
        if (content.length === 0) {
          return {
            content: [{
              type: 'text',
              text: 'File is empty.'
            }]
          };
        }

        const lines = content.split('\n');
        
        let startLine = 1;
        let endLine = lines.length;
        
        if (offset !== undefined) {
          startLine = Math.max(1, offset);
        }
        
        if (limit !== undefined) {
          endLine = Math.min(lines.length, startLine + limit - 1);
        }

        const selectedLines = lines.slice(startLine - 1, endLine);
        const numberedLines = selectedLines.map((line, index) => {
          const lineNumber = startLine + index;
          return `${lineNumber.toString().padStart(6)}|${line}`;
        });

        return {
          content: [{
            type: 'text',
            text: numberedLines.join('\n')
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`
          }]
        };
      }
    }
  );

  // Tool: Write file to container
  server.tool(
    'write_file',
    'Writes a file inside the Docker container. This tool will overwrite the existing file if there is one at the provided path.',
    {
      file_path: z.string().describe('The path to the file inside the container'),
      contents: z.string().describe('The contents of the file to write')
    },
    async ({ file_path, contents }): Promise<CallToolResult> => {
      try {
        // Create directory if it doesn't exist
        const dir = path.dirname(file_path);
        if (dir !== '.' && dir !== '/') {
          await executeDockerCommand(`mkdir -p ${escapeShellArg(dir)}`);
        }
        
        // Check if file already exists
        const checkResult = await executeDockerCommand(`test -f ${escapeShellArg(file_path)} && echo "exists" || echo "new"`);
        const exists = checkResult.stdout.trim() === 'exists';

        // Write the file using a here document to handle special characters properly
        const writeCommand = `cat > ${escapeShellArg(file_path)} << 'EOF_MARKER_UNIQUE'
${contents}
EOF_MARKER_UNIQUE`;
        
        const result = await executeDockerCommand(writeCommand);
        if (result.exitCode !== 0) {
          return {
            content: [{
              type: 'text',
              text: `Error writing file: ${result.stderr}`
            }]
          };
        }
        
        const action = exists ? 'Overwritten' : 'Created';
        return {
          content: [{
            type: 'text',
            text: `${action} file: ${file_path} (${contents.length} characters)`
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`
          }]
        };
      }
    }
  );

  // Tool: Search and replace in container files
  server.tool(
    'search_replace',
    'Performs exact string replacements in files inside the Docker container. The edit will FAIL if old_string is not unique in the file unless replace_all is true.',
    {
      file_path: z.string().describe('The path to the file inside the container to modify'),
      old_string: z.string().describe('The text to replace'),
      new_string: z.string().describe('The text to replace it with (must be different from old_string)'),
      replace_all: z.boolean().optional().default(false).describe('Replace all occurences of old_string (default false)')
    },
    async ({ file_path, old_string, new_string, replace_all }): Promise<CallToolResult> => {
      try {
        if (old_string === new_string) {
          return {
            content: [{
              type: 'text',
              text: 'Error: old_string and new_string must be different'
            }]
          };
        }

        // Check if file exists
        const checkResult = await executeDockerCommand(`test -f ${escapeShellArg(file_path)} && echo "exists" || echo "not found"`);
        if (checkResult.stdout.trim() !== 'exists') {
          return {
            content: [{
              type: 'text',
              text: `Error: File not found: ${file_path}`
            }]
          };
        }

        // Read file content
        const catResult = await executeDockerCommand(`cat ${escapeShellArg(file_path)}`);
        if (catResult.exitCode !== 0) {
          return {
            content: [{
              type: 'text',
              text: `Error reading file: ${catResult.stderr}`
            }]
          };
        }

        const content = catResult.stdout;
        
        if (!replace_all && content.split(old_string).length - 1 > 1) {
          return {
            content: [{
              type: 'text',
              text: `Error: old_string "${old_string}" is not unique in the file. Use replace_all=true or provide more context to make it unique.`
            }]
          };
        }

        if (!content.includes(old_string)) {
          return {
            content: [{
              type: 'text',
              text: `Error: old_string "${old_string}" not found in file`
            }]
          };
        }

        const newContent = replace_all 
          ? content.replaceAll(old_string, new_string)
          : content.replace(old_string, new_string);
        
        // Write the modified content back
        const writeCommand = `cat > ${escapeShellArg(file_path)} << 'EOF_MARKER_UNIQUE'
${newContent}
EOF_MARKER_UNIQUE`;
        
        const writeResult = await executeDockerCommand(writeCommand);
        if (writeResult.exitCode !== 0) {
          return {
            content: [{
              type: 'text',
              text: `Error writing file: ${writeResult.stderr}`
            }]
          };
        }
        
        const replacementCount = replace_all 
          ? content.split(old_string).length - 1
          : 1;

        return {
          content: [{
            type: 'text',
            text: `Successfully replaced ${replacementCount} occurrence(s) in ${file_path}`
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`
          }]
        };
      }
    }
  );

  // Tool: List directory contents in container
  server.tool(
    'list_dir',
    'Lists files and directories inside the Docker container. Does not display dot-files and dot-directories by default.',
    {
      target_directory: z.string().describe('Path to directory inside the container to list contents of.'),
      show_hidden: z.boolean().optional().default(false).describe('Show hidden files and directories (starting with .)')
    },
    async ({ target_directory, show_hidden }): Promise<CallToolResult> => {
      try {
        // Check if directory exists
        const checkResult = await executeDockerCommand(`test -d ${escapeShellArg(target_directory)} && echo "exists" || echo "not found"`);
        if (checkResult.stdout.trim() !== 'exists') {
          return {
            content: [{
              type: 'text',
              text: `Error: Directory not found: ${target_directory}`
            }]
          };
        }

        // List directory contents
        const lsCommand = show_hidden 
          ? `ls -la ${escapeShellArg(target_directory)}` 
          : `ls -l ${escapeShellArg(target_directory)}`;
        
        const result = await executeDockerCommand(lsCommand);
        if (result.exitCode !== 0) {
          return {
            content: [{
              type: 'text',
              text: `Error listing directory: ${result.stderr}`
            }]
          };
        }

        const output = result.stdout.trim();
        if (!output) {
          return {
            content: [{
              type: 'text',
              text: 'Directory is empty.'
            }]
          };
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
            text: `Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`
          }]
        };
      }
    }
  );

  // Tool: Search files with grep in container
  server.tool(
    'grep',
    'A powerful search tool for finding patterns in files inside the Docker container. Supports full regex syntax.',
    {
      pattern: z.string().describe('The regular expression pattern to search for in file contents'),
      path: z.string().optional().describe('File or directory to search in inside the container. Defaults to current working directory.'),
      type: z.string().optional().describe('File extension to search (js, py, ts, etc). Will be converted to a find pattern.'),
      case_insensitive: z.boolean().optional().default(false).describe('Case insensitive search'),
      context_before: z.number().optional().describe('Number of lines to show before each match'),
      context_after: z.number().optional().describe('Number of lines to show after each match'),
      context: z.number().optional().describe('Number of lines to show before and after each match'),
      head_limit: z.number().optional().describe('Limit output to first N lines')
    },
    async ({ 
      pattern, 
      path: searchPath = '.', 
      type, 
      case_insensitive = false,
      context_before,
      context_after,
      context,
      head_limit
    }): Promise<CallToolResult> => {
      try {
        // Build grep command
        let cmd = 'grep -r';
        
        if (case_insensitive) cmd += ' -i';
        cmd += ' -n'; // Show line numbers
        
        if (context !== undefined) {
          cmd += ` -C ${context}`;
        } else {
          if (context_before !== undefined) cmd += ` -B ${context_before}`;
          if (context_after !== undefined) cmd += ` -A ${context_after}`;
        }
        
        // Add file type filter if specified
        if (type) {
          cmd += ` --include="*.${type}"`;
        }
        
        cmd += ` ${escapeShellArg(pattern)} ${escapeShellArg(searchPath)}`;
        
        // Add head limit if specified
        if (head_limit) {
          cmd += ` | head -${head_limit}`;
        }

        const result = await executeDockerCommand(cmd);
        
        // grep returns exit code 1 when no matches found, which is normal
        if (result.exitCode === 1 && !result.stderr) {
          return {
            content: [{
              type: 'text',
              text: 'No matches found.'
            }]
          };
        }
        
        if (result.exitCode !== 0 && result.exitCode !== 1) {
          return {
            content: [{
              type: 'text',
              text: `Error: ${result.stderr || 'Search failed'}`
            }]
          };
        }

        const output = result.stdout.trim();
        return {
          content: [{
            type: 'text',
            text: output || 'No matches found.'
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : 'Search failed'}`
          }]
        };
      }
    }
  );

  // Tool: Find files in container
  server.tool(
    'find_files',
    'Find files matching a pattern inside the Docker container using find command.',
    {
      pattern: z.string().describe('The file name pattern to search for (supports wildcards like *.js)'),
      path: z.string().optional().default('.').describe('Directory to search in inside the container'),
      type: z.enum(['f', 'd', 'l']).optional().default('f').describe('Type of files to find: f=files, d=directories, l=links')
    },
    async ({ pattern, path: searchPath = '.', type = 'f' }): Promise<CallToolResult> => {
      try {
        const cmd = `find ${escapeShellArg(searchPath)} -type ${type} -name ${escapeShellArg(pattern)}`;
        
        const result = await executeDockerCommand(cmd);
        if (result.exitCode !== 0) {
          return {
            content: [{
              type: 'text',
              text: `Error: ${result.stderr || 'Find command failed'}`
            }]
          };
        }

        const output = result.stdout.trim();
        if (!output) {
          return {
            content: [{
              type: 'text',
              text: `No files found matching pattern: ${pattern}`
            }]
          };
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
            text: `Error: ${error instanceof Error ? error.message : 'File search failed'}`
          }]
        };
      }
    }
  );

  // Tool: Delete file in container
  server.tool(
    'delete_file',
    'Deletes a file inside the Docker container. The operation will fail gracefully if the file doesn\'t exist or cannot be deleted.',
    {
      target_file: z.string().describe('The path of the file to delete inside the container'),
      explanation: z.string().describe('One sentence explanation as to why this tool is being used, and how it contributes to the goal.')
    },
    async ({ target_file, explanation }): Promise<CallToolResult> => {
      try {
        // Check if file exists
        const checkResult = await executeDockerCommand(`test -f ${escapeShellArg(target_file)} && echo "exists" || echo "not found"`);
        if (checkResult.stdout.trim() !== 'exists') {
          return {
            content: [{
              type: 'text',
              text: `File does not exist: ${target_file}`
            }]
          };
        }

        // Check if it's actually a file (not a directory)
        const typeResult = await executeDockerCommand(`test -d ${escapeShellArg(target_file)} && echo "directory" || echo "file"`);
        if (typeResult.stdout.trim() === 'directory') {
          return {
            content: [{
              type: 'text',
              text: `Error: Cannot delete directory with delete_file tool: ${target_file}`
            }]
          };
        }

        // Delete the file
        const result = await executeDockerCommand(`rm ${escapeShellArg(target_file)}`);
        if (result.exitCode !== 0) {
          return {
            content: [{
              type: 'text',
              text: `Error deleting file: ${result.stderr}`
            }]
          };
        }
        
        return {
          content: [{
            type: 'text',
            text: `Successfully deleted file: ${target_file}\nReason: ${explanation}`
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: `Error deleting file: ${error instanceof Error ? error.message : 'Unknown error occurred'}`
          }]
        };
      }
    }
  );

  // Tool: Interactive shell helper
  server.tool(
    'shell',
    'Get instructions for starting an interactive shell session in the target container',
    {
      shell: z.string().optional().default('/bin/bash').describe('Shell to use (default: /bin/bash)'),
      user: z.string().optional().describe('User to run shell as'),
      working_dir: z.string().optional().describe('Working directory to start in')
    },
    async ({ shell, user, working_dir }): Promise<CallToolResult> => {
      try {
        const output = `
To start an interactive shell in container '${TARGET_CONTAINER}':

Direct Docker command:
docker exec -it ${user ? `-u ${user} ` : ''}${working_dir ? `-w ${working_dir} ` : ''}${TARGET_CONTAINER} ${shell}

Or use the 'exec' tool with commands like:
- "pwd" to see current directory
- "ls -la" to list files
- "whoami" to see current user
- "env" to see environment variables

💡 This server provides full code editing capabilities inside the container:
- read_file: Read files from the container
- write_file: Create/edit files in the container
- search_replace: Find and replace text in container files
- list_dir: Browse directories in the container
- grep: Search for patterns in container files
- find_files: Find files by name pattern
- delete_file: Remove files from the container
- get_compose_file: View the Docker Compose configuration
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
            text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
          }]
        };
      }
    }
  );

  return server;
};

const app = express();
app.use(express.json({ limit: '50mb' })); // Increase limit for large file contents

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
const PORT = 3003; // Different port from other servers
app.listen(PORT, () => {
  console.log(`🐳📝 Docker Code Editing MCP Server listening on port ${PORT}`);
  console.log(`📦 Target Container: ${TARGET_CONTAINER}`);
  console.log('');
  console.log('🐳 DOCKER TOOLS:');
  console.log('- exec: Execute commands in the target container');
  console.log('- get_compose_file: View the Docker Compose configuration');
  console.log('- shell: Get instructions for interactive shell access');
  console.log('');
  console.log('📝 CODE EDITING TOOLS (INSIDE CONTAINER):');
  console.log('- read_file: Read files from inside the container');
  console.log('- write_file: Create/edit files inside the container');
  console.log('- search_replace: Find and replace text in container files');
  console.log('- list_dir: Browse directories inside the container');
  console.log('- grep: Search for patterns in container files');
  console.log('- find_files: Find files by name pattern inside container');
  console.log('- delete_file: Remove files from inside the container');
  console.log('');
  console.log('💡 USAGE EXAMPLES:');
  console.log('  read_file: { "target_file": "/app/src/main.js" }');
  console.log('  write_file: { "file_path": "/app/config.json", "contents": "{...}" }');
  console.log('  exec: { "command": "npm install", "working_dir": "/app" }');
  console.log('  search_replace: { "file_path": "/app/package.json", "old_string": "1.0.0", "new_string": "1.1.0" }');
  console.log('');
});

// Handle server shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down Docker Code Editing MCP server...');
  process.exit(0);
});
