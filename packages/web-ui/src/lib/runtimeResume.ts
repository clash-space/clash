/** One resumable ACP session reported by a registered Clash runtime. */
export interface RuntimeResumeSession {
  id: string;
  title: string;
  cwd: string;
  /** Unix seconds, as reported by the runtime's session index. */
  modifiedAt: number;
}
