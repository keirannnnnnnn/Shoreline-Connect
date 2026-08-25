import { exec } from 'child_process';
import util from 'util';
import path from 'path';
import { db } from '../db/database.js';

const execPromise = util.promisify(exec);
const rootDir = path.resolve(__dirname, '../../../');

export interface GitStatusInfo {
  currentCommit: string;
  commitDate: string;
  commitMessage: string;
  branch: string;
  repoUrl: string;
  hasUpdates: boolean;
  latestRemoteCommit?: string;
  error?: string;
}

export class UpdateService {
  /**
   * Get current Git status and commit information
   */
  static async getStatus(): Promise<GitStatusInfo> {
    const branchSetting = db.prepare("SELECT value FROM system_settings WHERE key = 'git_branch'").get() as { value: string } | undefined;
    const repoSetting = db.prepare("SELECT value FROM system_settings WHERE key = 'git_repo_url'").get() as { value: string } | undefined;

    let branch = branchSetting?.value || 'main';
    let repoUrl = repoSetting?.value || '';

    try {
      // Get current commit hash
      const { stdout: hashOut } = await execPromise('git rev-parse --short HEAD', { cwd: rootDir });
      const currentCommit = hashOut.trim();

      // Get commit date
      const { stdout: dateOut } = await execPromise('git log -1 --format=%cd --date=iso', { cwd: rootDir });
      const commitDate = dateOut.trim();

      // Get commit message
      const { stdout: msgOut } = await execPromise('git log -1 --format=%s', { cwd: rootDir });
      const commitMessage = msgOut.trim();

      // Get active branch
      try {
        const { stdout: branchOut } = await execPromise('git rev-parse --abbrev-ref HEAD', { cwd: rootDir });
        if (branchOut.trim() && branchOut.trim() !== 'HEAD') {
          branch = branchOut.trim();
        }
      } catch {}

      return {
        currentCommit,
        commitDate,
        commitMessage,
        branch,
        repoUrl,
        hasUpdates: false,
      };
    } catch (err: any) {
      return {
        currentCommit: 'unknown',
        commitDate: new Date().toISOString(),
        commitMessage: 'Running from production release package',
        branch,
        repoUrl,
        hasUpdates: false,
        error: err.message,
      };
    }
  }

  /**
   * Check for remote updates from Git
   */
  static async checkForUpdates(): Promise<{ hasUpdates: boolean; currentCommit: string; remoteCommit?: string; message: string }> {
    const status = await this.getStatus();
    try {
      // Fetch latest refs from remote
      await execPromise('git fetch origin', { cwd: rootDir });
      const { stdout: remoteCommitOut } = await execPromise(`git rev-parse --short origin/${status.branch}`, { cwd: rootDir });
      const remoteCommit = remoteCommitOut.trim();

      const hasUpdates = remoteCommit !== status.currentCommit;

      return {
        hasUpdates,
        currentCommit: status.currentCommit,
        remoteCommit,
        message: hasUpdates 
          ? `An update is available (Latest: ${remoteCommit}, Current: ${status.currentCommit})`
          : 'Application is up to date.'
      };
    } catch (err: any) {
      return {
        hasUpdates: false,
        currentCommit: status.currentCommit,
        message: `Unable to query remote: ${err.message}. Ensure git origin is configured.`
      };
    }
  }

  /**
   * Execute application update (Pull latest code, rebuild client & server, restart)
   */
  static async performUpdate(repoUrl?: string, branch?: string): Promise<{ success: boolean; message: string; output: string }> {
    if (branch) {
      db.prepare("INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES ('git_branch', ?, CURRENT_TIMESTAMP)").run(branch);
    }
    if (repoUrl) {
      db.prepare("INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES ('git_repo_url', ?, CURRENT_TIMESTAMP)").run(repoUrl);
    }

    const targetBranch = branch || 'main';
    const logs: string[] = [];

    try {
      logs.push(`[1/4] Pulling latest code from origin/${targetBranch}...`);
      const { stdout: pullOut } = await execPromise(`git pull origin ${targetBranch}`, { cwd: rootDir });
      logs.push(pullOut);

      logs.push('[2/4] Building frontend and backend assets...');
      const { stdout: buildOut } = await execPromise('npm run build', { cwd: rootDir });
      logs.push(buildOut);

      logs.push('[3/4] Rebuilding complete. Scheduling service restart in 2 seconds...');

      // Schedule process exit / restart so PM2 / systemd / Docker restarts the process
      setTimeout(() => {
        console.log('🔄 Restarting Shoreline Connect service post-update...');
        process.exit(0);
      }, 2000);

      return {
        success: true,
        message: 'Update applied successfully. Service is restarting...',
        output: logs.join('\n'),
      };
    } catch (err: any) {
      logs.push(`Update execution error: ${err.message}`);
      return {
        success: false,
        message: `Update failed: ${err.message}`,
        output: logs.join('\n'),
      };
    }
  }
}
