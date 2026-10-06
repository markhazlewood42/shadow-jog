/**
 * Whether a file system error only says that the file or folder is not there, or is not what was
 * wanted (a folder where a file was expected). That is an answer ("not found"), not a failure of
 * the server, so a caller shows "not found" and does not report an error.
 */
export function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR';
}
