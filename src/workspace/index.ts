/** Independent lazy P5 face; importing/constructing never touches filesystem or profile state. */
export { WorkspaceMapper } from './mapper.js';
export { classifyWorkspacePath } from './paths.js';
export { WorkspaceMappingError } from './errors.js';
export type { WorkspaceMappingErrorCode } from './errors.js';
export type { MappingCapabilities, MappingOptions, MappingRequest, MappingOperationOptions, MappingOperationResult,
  WorkspaceMappingPlan, WorkspaceDescriptor, PathAnalysis, PathSyntax, PathState, PathStyle, DirectoryIdentity } from './types.js';
