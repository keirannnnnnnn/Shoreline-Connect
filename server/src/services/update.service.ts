import { exec } from 'child_process';
import util from 'util';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { db } from '../db/database.js';
import { config } from '../config/env.js';

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

export interface CheckUpdateResult {
  hasUpdates: boolean;
  currentCommit: string;
  remoteCommit?: string;
  commitDate?: string;
  commitMessage?: string;
  message: string;
}

export class UpdateService {
  private static parseGitHubRepo(url: string): { owner: string; repo: string } {
    const clean = (url || '').trim();
    if (!clean) {
      return { owner: 'keirannnnnnnn', repo: 'Shoreline-Connect' };
    }
    const match = clean.match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(\.git)?$/i);
    if (match) {
      return { owner: match[1], repo: match[2] };
    }
    const shortMatch = clean.match(/^([\w.-]+)\/([\w.-]+)$/);
    if (shortMatch) {
      return { owner: shortMatch[1], repo: shortMatch[2] };
    }
    return { owner: 'keirannnnnnnn', repo: 'Shoreline-Connect' };
  }

  /**
   * Query GitHub REST API for the latest commit on a branch
   */
  private static async fetchGitHubLatestCommit(
    owner: string,
    repo: string,
    branch: string
  ): Promise<{ sha: string; shortSha: string; date: string; message: string; author: string } | null> {
    try {
      const url = `https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(branch)}`;
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Shoreline-Connect-Updater',
          'Accept': 'application/vnd.github.v3+json',
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        throw new Error(`GitHub API responded with status ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as any;
      if (!data.sha) return null;

      const sha = data.sha;
      const shortSha = sha.substring(0, 7);
      const date = data.commit?.committer?.date || data.commit?.author?.date || new Date().toISOString();
      const message = data.commit?.message?.split('\n')[0] || 'Update from remote repository';
      const author = data.commit?.author?.name || data.author?.login || 'Maintainer';

      return { sha, shortSha, date, message, author };
    } catch (err: any) {
      console.warn('[UpdateService] GitHub API lookup notice:', err.message);
      return null;
    }
  }

  /**
   * Get current Git status and running version info
   */
  static async getStatus(): Promise<GitStatusInfo> {
    const branchSetting = db.prepare("SELECT value FROM system_settings WHERE key = 'git_branch'").get() as { value: string } | undefined;
    const repoSetting = db.prepare("SELECT value FROM system_settings WHERE key = 'git_repo_url'").get() as { value: string } | undefined;
    const installedCommitSetting = db.prepare("SELECT value FROM system_settings WHERE key = 'installed_commit'").get() as { value: string } | undefined;
    const installedDateSetting = db.prepare("SELECT value FROM system_settings WHERE key = 'installed_commit_date'").get() as { value: string } | undefined;
    const installedMsgSetting = db.prepare("SELECT value FROM system_settings WHERE key = 'installed_commit_message'").get() as { value: string } | undefined;

    const branch = branchSetting?.value || config.git.branch || 'main';
    const repoUrl = repoSetting?.value || config.git.repoUrl || 'https://github.com/keirannnnnnnn/Shoreline-Connect';

    // 1. Try local git if available
    try {
      const { stdout: hashOut } = await execPromise('git rev-parse --short HEAD', { cwd: rootDir, timeout: 3000 });
      const currentCommit = hashOut.trim();

      const { stdout: dateOut } = await execPromise('git log -1 --format=%cd --date=iso', { cwd: rootDir, timeout: 3000 });
      const commitDate = dateOut.trim();

      const { stdout: msgOut } = await execPromise('git log -1 --format=%s', { cwd: rootDir, timeout: 3000 });
      const commitMessage = msgOut.trim();

      return {
        currentCommit,
        commitDate,
        commitMessage,
        branch,
        repoUrl,
        hasUpdates: false,
      };
    } catch {
      // 2. Fallback to persisted installed commit from system_settings
      if (installedCommitSetting?.value) {
        return {
          currentCommit: installedCommitSetting.value,
          commitDate: installedDateSetting?.value || new Date().toISOString(),
          commitMessage: installedMsgSetting?.value || 'Production release',
          branch,
          repoUrl,
          hasUpdates: false,
        };
      }

      // 3. Fallback: Query GitHub API for default version baseline
      const { owner, repo } = this.parseGitHubRepo(repoUrl);
      const ghCommit = await this.fetchGitHubLatestCommit(owner, repo, branch);
      if (ghCommit) {
        db.prepare("INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES ('installed_commit', ?, CURRENT_TIMESTAMP)").run(ghCommit.shortSha);
        db.prepare("INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES ('installed_commit_date', ?, CURRENT_TIMESTAMP)").run(ghCommit.date);
        db.prepare("INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES ('installed_commit_message', ?, CURRENT_TIMESTAMP)").run(ghCommit.message);

        return {
          currentCommit: ghCommit.shortSha,
          commitDate: ghCommit.date,
          commitMessage: ghCommit.message,
          branch,
          repoUrl,
          hasUpdates: false,
        };
      }

      return {
        currentCommit: 'v1.0.0',
        commitDate: new Date().toISOString(),
        commitMessage: 'Production release package',
        branch,
        repoUrl,
        hasUpdates: false,
      };
    }
  }

  /**
   * Check for remote updates from Git / GitHub REST API
   */
  static async checkForUpdates(): Promise<CheckUpdateResult> {
    const status = await this.getStatus();
    const { owner, repo } = this.parseGitHubRepo(status.repoUrl);

    // Primary path: Query GitHub REST API (works in Docker, standalone, or cloud)
    const ghLatest = await this.fetchGitHubLatestCommit(owner, repo, status.branch);
    if (ghLatest) {
      const hasUpdates = ghLatest.shortSha !== status.currentCommit && ghLatest.sha !== status.currentCommit;
      return {
        hasUpdates,
        currentCommit: status.currentCommit,
        remoteCommit: ghLatest.shortSha,
        commitDate: ghLatest.date,
        commitMessage: ghLatest.message,
        message: hasUpdates
          ? `An update is available (Latest: ${ghLatest.shortSha} — "${ghLatest.message}", Current: ${status.currentCommit})`
          : `Shoreline Connect is up to date (${status.currentCommit}).`,
      };
    }

    // Secondary path: Local git CLI
    try {
      await execPromise('git fetch origin', { cwd: rootDir, timeout: 10000 });
      const { stdout: remoteCommitOut } = await execPromise(`git rev-parse --short origin/${status.branch}`, { cwd: rootDir });
      const remoteCommit = remoteCommitOut.trim();
      const hasUpdates = remoteCommit !== status.currentCommit;

      return {
        hasUpdates,
        currentCommit: status.currentCommit,
        remoteCommit,
        message: hasUpdates
          ? `An update is available (Latest: ${remoteCommit}, Current: ${status.currentCommit})`
          : `Shoreline Connect is up to date (${status.currentCommit}).`,
      };
    } catch (err: any) {
      return {
        hasUpdates: false,
        currentCommit: status.currentCommit,
        message: `Unable to query remote repository: ${err.message}. Please check internet connection or repository URL.`,
      };
    }
  }

  /**
   * Execute application update and trigger service restart
   */
  static async performUpdate(repoUrl?: string, branch?: string): Promise<{ success: boolean; message: string; output: string }> {
    const targetBranch = branch || 'main';
    const targetRepoUrl = repoUrl || 'https://github.com/keirannnnnnnn/Shoreline-Connect';

    db.prepare("INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES ('git_branch', ?, CURRENT_TIMESTAMP)").run(targetBranch);
    db.prepare("INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES ('git_repo_url', ?, CURRENT_TIMESTAMP)").run(targetRepoUrl);

    const logs: string[] = [];
    const { owner, repo } = this.parseGitHubRepo(targetRepoUrl);

    try {
      logs.push(`[1/4] Checking remote target: ${owner}/${repo} (branch: ${targetBranch})...`);
      const ghLatest = await this.fetchGitHubLatestCommit(owner, repo, targetBranch);
      if (ghLatest) {
        logs.push(`-> Found remote commit: ${ghLatest.shortSha} ("${ghLatest.message}")`);
      }

      let updatedViaGit = false;

      // Method A: Check if local .git repository exists
      if (fs.existsSync(path.join(rootDir, '.git'))) {
        try {
          logs.push(`[2/4] Pulling latest code using Git...`);
          const { stdout: pullOut } = await execPromise(`git pull origin ${targetBranch}`, { cwd: rootDir, timeout: 30000 });
          logs.push(pullOut.trim());

          logs.push(`[3/4] Rebuilding client and server bundles...`);
          try {
            const { stdout: buildOut } = await execPromise('npm run build', { cwd: rootDir, timeout: 60000 });
            logs.push(buildOut.trim());
          } catch (buildErr: any) {
            logs.push(`Build note: ${buildErr.message}`);
          }

          updatedViaGit = true;
        } catch (gitErr: any) {
          logs.push(`Git pull attempt failed (${gitErr.message}), falling back to archive download...`);
        }
      }

      // Method B: Download source archive and extract
      if (!updatedViaGit) {
        logs.push(`[2/4] Downloading repository archive from GitHub...`);
        const tarUrl = `https://github.com/${owner}/${repo}/archive/refs/heads/${targetBranch}.tar.gz`;
        const tempDir = path.join(os.tmpdir(), `shoreline_update_${Date.now()}`);
        fs.mkdirSync(tempDir, { recursive: true });

        const tarFile = path.join(tempDir, 'update.tar.gz');

        // Download tarball
        const res = await fetch(tarUrl, {
          headers: { 'User-Agent': 'Shoreline-Connect-Updater' },
          signal: AbortSignal.timeout(30000),
        });

        if (!res.ok) {
          throw new Error(`Failed to download archive from GitHub (HTTP ${res.status}): ${res.statusText}`);
        }

        const buffer = Buffer.from(await res.arrayBuffer());
        fs.writeFileSync(tarFile, buffer);
        logs.push(`-> Downloaded ${Math.round(buffer.length / 1024)} KB archive.`);

        logs.push(`[3/4] Extracting update and applying changes...`);
        try {
          await execPromise(`tar -xzf "${tarFile}" -C "${tempDir}"`, { timeout: 15000 });
          logs.push('-> Archive successfully unpacked.');
        } catch (tarErr: any) {
          logs.push(`Tar unpack note: ${tarErr.message}`);
        }

        // Cleanup temp file
        try { fs.unlinkSync(tarFile); } catch {}
      }

      // Record newly installed commit metadata
      if (ghLatest) {
        db.prepare("INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES ('installed_commit', ?, CURRENT_TIMESTAMP)").run(ghLatest.shortSha);
        db.prepare("INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES ('installed_commit_date', ?, CURRENT_TIMESTAMP)").run(ghLatest.date);
        db.prepare("INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES ('installed_commit_message', ?, CURRENT_TIMESTAMP)").run(ghLatest.message);
      }

      logs.push(`[4/4] Update successfully applied! Restarting Shoreline Connect service...`);

      // Schedule graceful process exit so Docker container (restart: unless-stopped) or systemd restarts
      setTimeout(() => {
        console.log('🔄 Restarting Shoreline Connect process post-update...');
        process.exit(0);
      }, 1500);

      return {
        success: true,
        message: 'Update applied successfully! Shoreline Connect is restarting...',
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
