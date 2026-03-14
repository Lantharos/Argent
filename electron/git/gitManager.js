import { ipcMain } from 'electron';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execFileAsync = promisify(execFile);

export function setupGitHandlers() {
  ipcMain.handle('git:check-installed', async () => {
    try {
      const { stdout } = await execFileAsync('git', ['--version']);
      return { installed: true, version: stdout.trim() };
    } catch (e) {
      return { installed: false, error: e.message };
    }
  });

  ipcMain.handle('git:exec', async (_, { cwd, args }) => {
    try {
      // increase max buffer to handle large diffs
      const { stdout, stderr } = await execFileAsync('git', args, { cwd, maxBuffer: 1024 * 1024 * 10 });
      return { success: true, stdout, stderr };
    } catch (e) {
      return { success: false, error: e.message, stdout: e.stdout, stderr: e.stderr };
    }
  });
}
