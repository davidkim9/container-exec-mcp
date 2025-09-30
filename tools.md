# Available Tools

## 1. `exec`
Execute a command in a Docker container.

**Parameters:**
- `container_id` (required): Container ID or name
- `command` (required): Command to execute in the container
- `stdin` (optional): Input to send to the command via stdin
- `working_dir` (optional): Working directory for the command (default: `/home/ubuntu/workspace`)
- `user` (optional): User to run the command as
- `env` (optional): Array of environment variables (format: `KEY=value`)
- `timeout` (optional): Command timeout in seconds (default: 30)

**Returns:**
- STDOUT output from the command
- STDERR output from the command
- Exit code

**Example:**
```javascript
exec({
  container_id: "my-container",
  command: "ls -la",
  working_dir: "/app"
})
```

## 2. `list_containers`
List Docker containers. By default shows only running containers.

**Parameters:**
- `all` (optional): Show all containers including stopped ones (default: `false`)

**Returns:**
- List of containers with:
  - Name
  - Container ID
  - Image
  - State
  - Status
  - Port mappings

**Example:**
```javascript
list_containers({ all: true })
```

## 3. `get_container_info`
Get detailed information about a specific Docker container.

**Parameters:**
- `container_id` (required): Container ID or name

**Returns:**
- Complete container information including:
  - Basic info (ID, name, image, created date)
  - State (status, running, paused, PID, exit code, start/finish times)
  - Network configuration (IP address, gateway, ports, networks)
  - Mounts/Volumes
  - Environment variables
  - Command and entrypoint
  - Working directory
  - Resource limits (memory, CPU)
  - Restart policy

**Example:**
```javascript
get_container_info({ container_id: "my-container" })
```
