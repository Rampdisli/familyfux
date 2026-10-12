/** What the footer shows; written into the image at build time (see Dockerfile). */
export interface BuildInfo {
  /** package.json version, e.g. "0.9.0"; "dev" under `ng serve`. */
  version: string;
  /** Short commit hash, or "" when the build had no git checkout. */
  commit: string;
  /** ISO timestamp of the build, or "". */
  builtAt: string;
}
