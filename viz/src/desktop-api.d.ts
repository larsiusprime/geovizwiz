export {};

declare global {
  interface Window {
    vizDesktop?: {
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
    };
  }
}
