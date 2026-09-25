package jobs

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/tls"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"shoreline-agent/collector"
)

type JobRunner struct {
	hubURL      string
	token       string
	client      *http.Client
	col         collector.Collector
	runningChan chan struct{}
}

func NewJobRunner(hubURL, token string, insecureTLS bool, col collector.Collector) *JobRunner {
	tr := &http.Transport{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: insecureTLS},
	}
	return &JobRunner{
		hubURL:      hubURL,
		token:       token,
		client:      &http.Client{Transport: tr, Timeout: 30 * time.Second},
		col:         col,
		runningChan: make(chan struct{}, 1), // Concurrency limit 1 per agent
	}
}

// Report job execution progress/status back to Shoreline Connect hub
func (r *JobRunner) ReportStatus(jobID, status string, exitCode *int, stdout, stderr string, rebootReq bool, match *bool) {
	url := fmt.Sprintf("%s/api/updates/agent/jobs/%s/report", r.hubURL, jobID)

	payload := map[string]interface{}{
		"status":         status,
		"exitCode":       exitCode,
		"stdout":         stdout,
		"stderr":         stderr,
		"rebootRequired": rebootReq,
	}
	if match != nil {
		payload["detectionMatched"] = *match
	}

	data, err := json.Marshal(payload)
	if err != nil {
		log.Printf("[JobRunner] Error marshaling report payload: %v", err)
		return
	}

	req, err := http.NewRequest("POST", url, bytes.NewReader(data))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", r.token))

	resp, err := r.client.Do(req)
	if err != nil {
		log.Printf("[JobRunner] Failed to report job status: %v", err)
		return
	}
	defer resp.Body.Close()
}

// Submit full inventory scan results
func (r *JobRunner) SubmitInventory(items []collector.SoftwareItem, rebootReq bool) error {
	url := fmt.Sprintf("%s/api/updates/agent/inventory", r.hubURL)
	payload := map[string]interface{}{
		"items":          items,
		"rebootRequired": rebootReq,
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	req, err := http.NewRequest("POST", url, bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", r.token))

	resp, err := r.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return nil
}

// Submit detected available updates
func (r *JobRunner) SubmitAvailableUpdates(updates []collector.AvailableUpdateItem) error {
	url := fmt.Sprintf("%s/api/updates/agent/updates", r.hubURL)
	payload := map[string]interface{}{
		"updates": updates,
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	req, err := http.NewRequest("POST", url, bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", r.token))

	resp, err := r.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return nil
}

// ExecuteJob runs a job in a background goroutine so metrics collection is NEVER blocked
func (r *JobRunner) ExecuteJob(job collector.JobPayload) {
	select {
	case r.runningChan <- struct{}{}:
		// Acquired lock, run in goroutine
		go func() {
			defer func() { <-r.runningChan }()
			r.runJob(job)
		}()
	default:
		log.Printf("[JobRunner] Job %s skipped because another job is already running on this agent", job.ID)
	}
}

func (r *JobRunner) runJob(job collector.JobPayload) {
	log.Printf("[JobRunner] Starting execution of job %s (type: %s)", job.ID, job.JobType)
	r.ReportStatus(job.ID, "running", nil, "", "", false, nil)

	switch job.JobType {
	case "inventory_scan":
		items, rebootReq, err := r.col.GetSoftwareInventory()
		if err != nil {
			ec := 1
			r.ReportStatus(job.ID, "failed", &ec, "", fmt.Sprintf("Inventory scan error: %v", err), rebootReq, nil)
			return
		}

		if err := r.SubmitInventory(items, rebootReq); err != nil {
			ec := 1
			r.ReportStatus(job.ID, "failed", &ec, "", fmt.Sprintf("Failed to submit inventory: %v", err), rebootReq, nil)
			return
		}

		ec := 0
		r.ReportStatus(job.ID, "succeeded", &ec, fmt.Sprintf("Scanned and synchronized %d software packages", len(items)), "", rebootReq, nil)

	case "check_updates":
		updates, err := r.col.GetAvailableUpdates()
		if err != nil {
			ec := 1
			r.ReportStatus(job.ID, "failed", &ec, "", fmt.Sprintf("Update check error: %v", err), false, nil)
			return
		}

		if err := r.SubmitAvailableUpdates(updates); err != nil {
			ec := 1
			r.ReportStatus(job.ID, "failed", &ec, "", fmt.Sprintf("Failed to submit updates: %v", err), false, nil)
			return
		}

		ec := 0
		r.ReportStatus(job.ID, "succeeded", &ec, fmt.Sprintf("Update scan completed: %d available updates detected", len(updates)), "", false, nil)

	case "agent_update":
		r.handleAgentSelfUpdate(job)

	case "run_script":
		r.handleRunScript(job)

	default:
		ec := 1
		r.ReportStatus(job.ID, "failed", &ec, "", fmt.Sprintf("Unknown or unsupported job type: %s", job.JobType), false, nil)
	}
}

// Execute saved script under SYSTEM / root with environment variables
func (r *JobRunner) handleRunScript(job collector.JobPayload) {
	var payload struct {
		ScriptID      string            `json:"script_id"`
		ScriptName    string            `json:"script_name"`
		ScriptType    string            `json:"script_type"` // 'powershell', 'batch', 'bash'
		TargetOS      string            `json:"target_os"`
		ScriptContent string            `json:"script_content"`
		Parameters    map[string]string `json:"parameters"`
	}

	if err := json.Unmarshal([]byte(job.PayloadJSON), &payload); err != nil {
		ec := 1
		r.ReportStatus(job.ID, "failed", &ec, "", fmt.Sprintf("Failed to parse script payload JSON: %v", err), false, nil)
		return
	}

	if payload.ScriptContent == "" {
		ec := 1
		r.ReportStatus(job.ID, "failed", &ec, "", "Script content is empty", false, nil)
		return
	}

	exePath, _ := os.Executable()
	exeDir := filepath.Dir(exePath)

	// Secure SYSTEM/root scripts directory
	var scriptsDir string
	if runtime.GOOS == "windows" {
		scriptsDir = filepath.Join(exeDir, "scripts")
		_ = os.MkdirAll(scriptsDir, 0700)
	} else {
		scriptsDir = "/root/.shoreline-agent/scripts"
		_ = os.MkdirAll(scriptsDir, 0700)
	}

	var ext string
	switch payload.ScriptType {
	case "powershell":
		ext = ".ps1"
	case "batch":
		ext = ".cmd"
	case "bash":
		ext = ".sh"
	default:
		if runtime.GOOS == "windows" {
			ext = ".ps1"
		} else {
			ext = ".sh"
		}
	}

	scriptFile := filepath.Join(scriptsDir, fmt.Sprintf("sh_job_%s%s", job.ID, ext))
	if err := os.WriteFile(scriptFile, []byte(payload.ScriptContent), 0700); err != nil {
		ec := 1
		r.ReportStatus(job.ID, "failed", &ec, "", fmt.Sprintf("Failed to write secure script file: %v", err), false, nil)
		return
	}
	defer os.Remove(scriptFile) // Immediate secure cleanup

	// Prepare execution command
	timeout := time.Duration(job.TimeoutSeconds) * time.Second
	if timeout <= 0 {
		timeout = 10 * time.Minute
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		if payload.ScriptType == "batch" || ext == ".cmd" {
			cmd = exec.CommandContext(ctx, "cmd.exe", "/c", scriptFile)
		} else {
			cmd = exec.CommandContext(ctx, "powershell.exe", "-NonInteractive", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptFile)
		}
	} else {
		cmd = exec.CommandContext(ctx, "/bin/bash", scriptFile)
	}

	// Pass parameters strictly as environment variables (no text substitution)
	env := os.Environ()
	env = append(env, fmt.Sprintf("SH_JOB_ID=%s", job.ID))
	env = append(env, fmt.Sprintf("SH_SCRIPT_NAME=%s", payload.ScriptName))
	for k, v := range payload.Parameters {
		cleanKey := strings.ToUpper(strings.ReplaceAll(k, " ", "_"))
		env = append(env, fmt.Sprintf("%s=%s", k, v))
		env = append(env, fmt.Sprintf("SH_PARAM_%s=%s", cleanKey, v))
	}
	cmd.Env = env

	var stdoutBuf, stderrBuf bytes.Buffer
	cmd.Stdout = &stdoutBuf
	cmd.Stderr = &stderrBuf

	log.Printf("[JobRunner] Executing script job %s (%s, type=%s)", job.ID, payload.ScriptName, payload.ScriptType)
	runErr := cmd.Run()

	stdoutStr := stdoutBuf.String()
	stderrStr := stderrBuf.String()

	var exitCode int
	if runErr != nil {
		if exitErr, ok := runErr.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		} else {
			exitCode = 1
			if stderrStr == "" {
				stderrStr = runErr.Error()
			}
		}
	}

	if ctx.Err() == context.DeadlineExceeded {
		ec := 124
		r.ReportStatus(job.ID, "timed_out", &ec, stdoutStr, fmt.Sprintf("Script execution timed out after %v\n%s", timeout, stderrStr), false, nil)
		return
	}

	if exitCode == 0 {
		r.ReportStatus(job.ID, "succeeded", &exitCode, stdoutStr, stderrStr, false, nil)
	} else {
		r.ReportStatus(job.ID, "failed", &exitCode, stdoutStr, stderrStr, false, nil)
	}
}

// Self-update agent binary with external continuous health supervisor
func (r *JobRunner) handleAgentSelfUpdate(job collector.JobPayload) {
	log.Printf("[JobRunner] Initiating agent self-update...")
	r.ReportStatus(job.ID, "downloading", nil, "Downloading new agent binary...", "", false, nil)

	exePath, err := os.Executable()
	if err != nil {
		ec := 1
		r.ReportStatus(job.ID, "failed", &ec, "", fmt.Sprintf("Failed to get executable path: %v", err), false, nil)
		return
	}
	exePath, _ = filepath.Abs(exePath)
	exeDir := filepath.Dir(exePath)

	var payload struct {
		BuildID      string `json:"build_id"`
		Version      string `json:"version"`
		SHA256       string `json:"sha256"`
		DownloadPath string `json:"download_path"`
	}
	_ = json.Unmarshal([]byte(job.PayloadJSON), &payload)

	var downloadURL string
	if payload.DownloadPath != "" {
		downloadURL = fmt.Sprintf("%s%s", r.hubURL, payload.DownloadPath)
	} else {
		binName := fmt.Sprintf("shoreline-agent-%s-%s", runtime.GOOS, runtime.GOARCH)
		if runtime.GOOS == "windows" {
			binName += ".exe"
		}
		downloadURL = fmt.Sprintf("%s/api/updates/agent/download/%s", r.hubURL, binName)
	}

	req, err := http.NewRequest("GET", downloadURL, nil)
	if err != nil {
		ec := 1
		r.ReportStatus(job.ID, "failed", &ec, "", fmt.Sprintf("Failed to create download request: %v", err), false, nil)
		return
	}
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", r.token))

	resp, err := r.client.Do(req)
	if err != nil || resp.StatusCode != http.StatusOK {
		ec := 1
		r.ReportStatus(job.ID, "failed", &ec, "", fmt.Sprintf("Failed to download binary from %s (HTTP %d)", downloadURL, resp.StatusCode), false, nil)
		return
	}
	defer resp.Body.Close()

	tempPath := exePath + ".new"
	bakPath := exePath + ".bak"
	markerPath := filepath.Join(exeDir, ".healthy")

	tmpFile, err := os.OpenFile(tempPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0755)
	if err != nil {
		ec := 1
		r.ReportStatus(job.ID, "failed", &ec, "", fmt.Sprintf("Failed to create temporary file: %v", err), false, nil)
		return
	}

	hasher := sha256.New()
	writer := io.MultiWriter(tmpFile, hasher)

	if _, err := io.Copy(writer, resp.Body); err != nil {
		tmpFile.Close()
		os.Remove(tempPath)
		ec := 1
		r.ReportStatus(job.ID, "failed", &ec, "", fmt.Sprintf("Failed to write downloaded binary: %v", err), false, nil)
		return
	}
	tmpFile.Close()

	calcHash := hex.EncodeToString(hasher.Sum(nil))
	log.Printf("[JobRunner] Downloaded agent binary SHA-256: %s", calcHash)

	// Validate expected hash if provided
	if payload.SHA256 != "" && !strings.EqualFold(calcHash, payload.SHA256) {
		os.Remove(tempPath)
		ec := 1
		r.ReportStatus(job.ID, "failed", &ec, "", fmt.Sprintf("Checksum verification failed: expected %s, got %s", payload.SHA256, calcHash), false, nil)
		return
	}

	// Remove any existing .healthy marker before restart
	_ = os.Remove(markerPath)
	_ = os.Remove(bakPath)

	if err := os.Rename(exePath, bakPath); err != nil {
		os.Remove(tempPath)
		ec := 1
		r.ReportStatus(job.ID, "failed", &ec, "", fmt.Sprintf("Failed to backup current binary: %v", err), false, nil)
		return
	}

	if err := os.Rename(tempPath, exePath); err != nil {
		_ = os.Rename(bakPath, exePath)
		ec := 1
		r.ReportStatus(job.ID, "failed", &ec, "", fmt.Sprintf("Failed to swap new binary: %v", err), false, nil)
		return
	}

	ec := 0
	r.ReportStatus(job.ID, "succeeded", &ec, "Agent binary swapped successfully. Triggering supervised service restart...", "", false, nil)
	log.Printf("[JobRunner] Agent binary updated. Launching supervisor & restarting...")

	// Launch supervisor & restart service safely
	go func() {
		time.Sleep(1 * time.Second)
		if runtime.GOOS == "windows" {
			// PowerShell supervisor: checks continuous service health & .healthy marker over 60s window
			script := fmt.Sprintf(`& {
				Start-Sleep -Seconds 3
				Restart-Service ShorelineAgent -Force -ErrorAction SilentlyContinue
				$healthy = $false
				$marker = '%s'
				for ($i = 0; $i -lt 12; $i++) {
					Start-Sleep -Seconds 5
					if (Test-Path $marker) { $healthy = $true; break }
					$svc = Get-Service ShorelineAgent -ErrorAction SilentlyContinue
					if (-not $svc -or $svc.Status -ne 'Running') { break }
				}
				if (-not $healthy -and (Test-Path '%s')) {
					Write-Output 'Rollback triggered by supervisor.'
					Stop-Service ShorelineAgent -Force -ErrorAction SilentlyContinue
					Copy-Item '%s' '%s' -Force
					Start-Service ShorelineAgent -ErrorAction SilentlyContinue
				}
			}`, markerPath, bakPath, bakPath, exePath)

			_ = exec.Command("powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script).Start()
		} else {
			// Linux: launch via systemd-run outside service cgroup so systemd doesn't terminate it
			supervisorCmd := fmt.Sprintf(`sleep 3
systemctl restart shoreline-agent || true
healthy=0
for i in {1..12}; do
    sleep 5
    if [ -f "%s" ] || [ -f "/etc/shoreline-agent/.healthy" ]; then
        healthy=1
        break
    fi
    if ! systemctl is-active --quiet shoreline-agent; then
        break
    fi
done
if [ $healthy -eq 0 ] && [ -f "%s" ]; then
    cp -f "%s" "%s"
    systemctl restart shoreline-agent
fi`, markerPath, bakPath, bakPath, exePath)

			_ = exec.Command("systemd-run", "--unit=shoreline-agent-supervisor-"+fmt.Sprint(time.Now().Unix()), "--no-block", "bash", "-c", supervisorCmd).Start()
		}
	}()
}
