export {};

/** A logical data source recorded in viz-project.json. */
export interface ProjectSourceRecord {
  id: string;
  name: string;
  table: string;
  rawFile: string;
  parcelIdField: string | null;
  hasGeometry: boolean;
  srid: string | null;
  featureCount: number;
  columns: Array<{ name: string; type: string }>;
  importedAt: string;
}

/** A recently-opened project (stored outside any project, in OS app-data). */
export interface RecentProject {
  path: string;
  name: string;
  lastOpenedAt: string;
}

/** viz-project.json contents. */
export interface ProjectMeta {
  projectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  schemaVersion: number;
  dbBinding: string;
  sources: ProjectSourceRecord[];
  app: unknown | null;
}

declare global {
  interface Window {
    vizDesktop?: {
      // Legacy folder/file helpers
      selectProjectFolder: () => Promise<{ canceled: boolean; projectRoot?: string }>;
      createProjectFolder: (parentDir: string, projectFolderName: string) => Promise<{ projectRoot: string }>;
      readTextFile: (relativePath: string) => Promise<{ content: string }>;
      writeTextFile: (relativePath: string, content: string) => Promise<{ ok: boolean }>;
      getAppConfig: () => Promise<{
        mode: 'desktop';
        platform: string;
        userDataDir: string;
        projectRoot: string | null;
      }>;

      /** Subscribe to native File-menu actions. Returns an unsubscribe fn. */
      onMenuAction: (cb: (action: string) => void) => () => void;

      /** Forward a perf line to the main-process terminal (desktop profiling). */
      perf: (line: string) => void;

      // Project lifecycle
      pickProjectDir: () => Promise<{ canceled: boolean; projectRoot?: string }>;
      project: {
        create: (projectRoot: string) => Promise<{ projectRoot: string; meta: ProjectMeta }>;
        open: (projectRoot?: string) => Promise<{ canceled?: boolean; projectRoot?: string; meta?: ProjectMeta }>;
        close: () => Promise<{ ok: boolean }>;
        recent: () => Promise<RecentProject[]>;
        delete: (projectRoot?: string) => Promise<{ ok: boolean }>;
        current: () => Promise<{ projectRoot: string | null; meta: ProjectMeta | null }>;
        saveAppState: (appBlock: unknown) => Promise<{ ok: boolean }>;
      };

      // Import + database
      pickSourceFile: () => Promise<{ canceled: boolean; sourcePath?: string }>;
      db: {
        importSource: (opts: {
          sourcePath: string;
          sourceName?: string;
          parcelIdField?: string | null;
        }) => Promise<ProjectSourceRecord>;
        query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
        exec: (sql: string, params?: unknown[]) => Promise<{ ok: boolean }>;
      };

      // Token exchange for OIDC (CORS bypass)
      exchangeToken: (tokenEndpoint: string, params: Record<string, string>) => Promise<any>;

      // Forward a log message to the main process terminal
      log: (level: 'info' | 'warn' | 'error' | 'debug', msg: string) => void;
    };
  }
}
