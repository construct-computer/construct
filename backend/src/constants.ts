/** Prefix for all Docker container names managed by the sandbox. */
export const CONTAINER_PREFIX = 'sandbox-'

/** Default workspace path inside each container. */
export const WORKSPACE_PATH = '/home/sandbox/workspace'

/** Docker image name for the sandbox environment */
export const SANDBOX_IMAGE = 'cloud-sandbox-env:latest'

/** Starting port for container port mappings */
export const PORT_RANGE_START = 10000
