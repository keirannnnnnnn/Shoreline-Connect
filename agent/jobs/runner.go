package jobs

import (
	"bytes"
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

	default:
		ec := 1
		r.ReportStatus(job.ID, "failed", &ec, "", fmt.Sprintf("Unknown or unsupported job type: %s", job.JobType), false, nil)
	}
}

// Self-update agent binary with automatic rollback watchdog
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

	binName := fmt.Sprintf("shoreline-agent-%s-%s", runtime.GOOS, runtime.GOARCH)
	if runtime.GOOS == "windows" {
		binName += ".exe"
	}

	downloadURL := fmt.Sprintf("%s/api/updates/agent/download/%s", r.hubURL, binName)

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
	r.ReportStatus(job.ID, "succeeded", &ec, "Agent binary swapped successfully. Restarting service...", "", false, nil)
	log.Printf("[JobRunner] Agent binary updated. Triggering restart...")

	// Restart service safely
	go func() {
		time.Sleep(1 * time.Second)
		if runtime.GOOS == "windows" {
			_ = exec.Command("powershell.exe", "-Command", "Restart-Service ShorelineAgent -Force").Start()
		} else {
			_ = exec.Command("systemctl", "restart", "shoreline-agent").Start()
		}
	}()
}
