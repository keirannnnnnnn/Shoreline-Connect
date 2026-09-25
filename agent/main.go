package main

import (
	"bytes"
	"crypto/tls"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"

	"shoreline-agent/collector"
	"shoreline-agent/jobs"
)

type HubReportResponse struct {
	Status  string                `json:"status"`
	NextJob *collector.JobPayload `json:"next_job,omitempty"`
}

var (
	watchdogTimer *time.Timer
	watchdogOnce  sync.Once
	isHealthyOnce sync.Once
)

func main() {
	hubURL := flag.String("hub", "", "Shoreline Connect Hub URL (e.g. http://100.99.99.176:3001)")
	token := flag.String("token", "", "Device Monitoring Bearer Token")
	interval := flag.Int("interval", 15, "Metrics collection interval in seconds (default 15)")
	insecureTLS := flag.Bool("insecure", false, "Allow insecure / self-signed TLS certificates (testing only)")
	installFlag := flag.Bool("install", false, "Install agent as a background system service")
	uninstallFlag := flag.Bool("uninstall", false, "Uninstall agent background system service")
	versionFlag := flag.Bool("version", false, "Print agent version")

	flag.Parse()

	// 1. If started by Windows Service Control Manager, run native service handler
	if isWindowsService() {
		if *hubURL == "" {
			*hubURL = os.Getenv("SHORELINE_HUB_URL")
		}
		if *token == "" {
			*token = os.Getenv("SHORELINE_AGENT_TOKEN")
		}
		if err := runWindowsService(*hubURL, *token, *interval, *insecureTLS); err != nil {
			log.Fatalf("Windows Service runtime failure: %v", err)
		}
		return
	}

	if *versionFlag {
		fmt.Printf("Shoreline Connect Monitoring Agent v%s (%s/%s)\n", collector.AgentVersion, runtime.GOOS, runtime.GOARCH)
		return
	}

	// Environment variable overrides
	if *hubURL == "" {
		*hubURL = os.Getenv("SHORELINE_HUB_URL")
	}
	if *token == "" {
		*token = os.Getenv("SHORELINE_AGENT_TOKEN")
	}

	if *installFlag {
		if *hubURL == "" || *token == "" {
			log.Fatalf("Error: -hub and -token are required to install the service.")
		}
		if err := installService(*hubURL, *token, *interval, *insecureTLS); err != nil {
			log.Fatalf("Service installation failed: %v", err)
		}
		fmt.Println("✅ Shoreline Monitoring Agent service installed and started successfully.")
		return
	}

	if *uninstallFlag {
		if err := uninstallService(); err != nil {
			log.Fatalf("Service uninstallation failed: %v", err)
		}
		fmt.Println("✅ Shoreline Monitoring Agent service uninstalled successfully.")
		return
	}

	if *hubURL == "" || *token == "" {
		fmt.Println("Shoreline Connect Monitoring Agent")
		fmt.Println("Usage: shoreline-agent -hub <url> -token <token> [-interval 15]")
		flag.PrintDefaults()
		os.Exit(1)
	}

	// Normalize Hub URL
	cleanHubURL := strings.TrimRight(*hubURL, "/")

	log.Printf("Starting Shoreline Monitoring Agent v%s", collector.AgentVersion)
	log.Printf("Target Hub: %s", cleanHubURL)
	log.Printf("Report Interval: %d seconds", *interval)

	// Handle graceful console shutdown signals
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)
	stopChan := make(chan struct{})

	go func() {
		<-sigChan
		log.Println("Received termination signal. Shutting down agent.")
		close(stopChan)
	}()

	runAgentLoop(cleanHubURL, *token, time.Duration(*interval)*time.Second, *insecureTLS, stopChan)
}

func runAgentLoop(hubURL, token string, interval time.Duration, insecureTLS bool, stopChan <-chan struct{}) {
	exePath, err := os.Executable()
	if err == nil {
		exePath, _ = filepath.Abs(exePath)
		bakPath := exePath + ".bak"

		// If a backup file exists, initialize the 2-minute rollback watchdog
		if _, err := os.Stat(bakPath); err == nil {
			log.Printf("[Watchdog] Backup binary detected at %s. Initializing 2-minute check-in health watchdog...", bakPath)
			watchdogTimer = time.AfterFunc(2*time.Minute, func() {
				watchdogOnce.Do(func() {
					log.Printf("[Watchdog] ⚠️ Failed to achieve successful check-in with hub within 2 minutes! Triggering rollback to %s...", bakPath)
					_ = os.Rename(bakPath, exePath)
					if runtime.GOOS == "windows" {
						_ = exec.Command("powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "Restart-Service ShorelineAgent -Force").Start()
					} else {
						_ = exec.Command("systemctl", "restart", "shoreline-agent").Start()
					}
					os.Exit(1)
				})
			})
		}
	}

	tr := &http.Transport{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: insecureTLS},
	}
	client := &http.Client{
		Transport: tr,
		Timeout:   10 * time.Second,
	}

	col := collector.NewCollector()
	jobRunner := jobs.NewJobRunner(hubURL, token, insecureTLS, col)

	// Initial system info
	sysInfo, err := col.GetSystemInfo()
	if err != nil {
		log.Printf("Warning: Failed to gather initial system info: %v", err)
	} else {
		log.Printf("Host: %s | OS: %s %s | CPU: %s (%d cores) | Agent: v%s", sysInfo.Hostname, sysInfo.OS, sysInfo.PlatformVer, sysInfo.CPUModel, sysInfo.CPUCores, collector.AgentVersion)
	}

	reportURL := fmt.Sprintf("%s/api/monitoring/report", hubURL)

	// Periodic Timers:
	// - Metric ticker (15s)
	// - Inventory scan (every 6 hours + initial on startup)
	// - Update check (every 24 hours)
	metricsTicker := time.NewTicker(interval)
	defer metricsTicker.Stop()

	inventoryTicker := time.NewTicker(6 * time.Hour)
	defer inventoryTicker.Stop()

	updatesTicker := time.NewTicker(24 * time.Hour)
	defer updatesTicker.Stop()

	// Initial background discovery scans (non-blocking)
	go func() {
		time.Sleep(3 * time.Second) // allow initial metrics handshake first
		jobRunner.ExecuteJob(collector.JobPayload{
			ID:          "startup_inventory",
			JobType:     "inventory_scan",
			PayloadJSON: "{}",
		})
	}()

	// Send initial metrics payload immediately
	sendPayload(client, reportURL, token, col, sysInfo, jobRunner, exePath)

	for {
		select {
		case <-stopChan:
			return
		case <-metricsTicker.C:
			sendPayload(client, reportURL, token, col, sysInfo, jobRunner, exePath)
		case <-inventoryTicker.C:
			jobRunner.ExecuteJob(collector.JobPayload{
				ID:          fmt.Sprintf("periodic_inv_%d", time.Now().Unix()),
				JobType:     "inventory_scan",
				PayloadJSON: "{}",
			})
		case <-updatesTicker.C:
			jobRunner.ExecuteJob(collector.JobPayload{
				ID:          fmt.Sprintf("periodic_upd_%d", time.Now().Unix()),
				JobType:     "check_updates",
				PayloadJSON: "{}",
			})
		}
	}
}

func sendPayload(client *http.Client, reportURL, token string, col collector.Collector, sysInfo *collector.SystemInfo, jobRunner *jobs.JobRunner, exePath string) {
	metrics, err := col.Collect()
	if err != nil {
		log.Printf("Error collecting metrics: %v", err)
		return
	}

	// Attach full system info and agent version on each payload
	metrics.AgentVersion = collector.AgentVersion
	metrics.SystemInfo = sysInfo

	data, err := json.Marshal(metrics)
	if err != nil {
		log.Printf("Error marshaling metrics JSON: %v", err)
		return
	}

	req, err := http.NewRequest("POST", reportURL, bytes.NewReader(data))
	if err != nil {
		log.Printf("Error creating HTTP request: %v", err)
		return
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", token))
	req.Header.Set("User-Agent", fmt.Sprintf("ShorelineAgent/%s (%s; %s)", collector.AgentVersion, runtime.GOOS, runtime.GOARCH))

	resp, err := client.Do(req)
	if err != nil {
		log.Printf("Failed to push metrics to hub: %v", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusAccepted {
		body, _ := io.ReadAll(resp.Body)
		log.Printf("Hub rejected metrics payload (HTTP %d): %s", resp.StatusCode, string(body))
		return
	}

	// Upon successful check-in, create .healthy marker and cancel rollback timer
	isHealthyOnce.Do(func() {
		if exePath != "" {
			markerPath := filepath.Join(filepath.Dir(exePath), ".healthy")
			_ = os.WriteFile(markerPath, []byte(time.Now().Format(time.RFC3339)), 0644)

			bakPath := exePath + ".bak"
			if _, err := os.Stat(bakPath); err == nil {
				if watchdogTimer != nil {
					watchdogTimer.Stop()
				}
				_ = os.Remove(bakPath)
				log.Printf("[Watchdog] ✅ First metrics report succeeded! Agent update confirmed healthy. Removed backup binary.")
			}
		}
	})

	// Read response body to check for piggybacked jobs
	var reportResp HubReportResponse
	if err := json.NewDecoder(resp.Body).Decode(&reportResp); err == nil {
		if reportResp.NextJob != nil && reportResp.NextJob.ID != "" {
			log.Printf("[CommandChannel] Received dispatched job %s (%s)", reportResp.NextJob.ID, reportResp.NextJob.JobType)
			jobRunner.ExecuteJob(*reportResp.NextJob)
		}
	}
}
