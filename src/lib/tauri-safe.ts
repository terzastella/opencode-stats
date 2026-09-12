import { invoke } from "@tauri-apps/api/core";

/**
 * Tauri invoke with a timeout. A never-settling IPC promise would otherwise
 * leave the refresh loop stuck (refreshingRef never resets) while the LIVE
 * badge stays on — this turns a silent freeze into a catchable error that
 * the existing error state already handles.
 */
export async function invokeWithTimeout<T>(
  cmd: string,
  args?: Record<string, unknown>,
  timeoutMs = 15000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      invoke<T>(cmd, args),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Tauri invoke timed out: ${cmd}`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
