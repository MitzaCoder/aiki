/** No onboarding for independently hosted backends, disconnected clients or existing projects. */
export function needsWelcome(backend: {
 ready: boolean;
 modelsLoaded: boolean;
 projectsLoaded: boolean;
 projects: readonly unknown[];
} | undefined): boolean {
 return backend !== undefined && backend.ready && backend.modelsLoaded && backend.projectsLoaded && backend.projects.length === 0;
}
