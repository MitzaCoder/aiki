/** Only same-origin discovery opts in; required device sign-in precedes provider/project reads. */
export function needsWelcome(backend: {
 authMode?: string;
 authSessionId?: string;
 ready: boolean;
 modelsLoaded: boolean;
 projectsLoaded: boolean;
 projects: readonly unknown[];
} | undefined): boolean {
 if (backend === undefined) return false;
 if (backend.authMode === "required" && !backend.authSessionId) return true;
 return backend.ready && backend.modelsLoaded && backend.projectsLoaded && backend.projects.length === 0;
}
