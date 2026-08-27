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
	"os/signal"
	"runtime"
	"strings"
	"syscall"
	"time"

	"shoreline-agent/collector"
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
	tr := &http.Transport{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: insecureTLS},
	}
	client := &http.Client{
		Transport: tr,
		Timeout:   10 * time.Second,
	}

	col := collector.NewCollector()

	// Initial system info
	sysInfo, err := col.GetSystemInfo()
	if err != nil {
		log.Printf("Warning: Failed to gather initial system info: %v", err)
	} else {
		log.Printf("Host: %s | OS: %s %s | CPU: %s (%d cores)", sysInfo.Hostname, sysInfo.OS, sysInfo.PlatformVer, sysInfo.CPUModel, sysInfo.CPUCores)
	}

	reportURL := fmt.Sprintf("%s/api/monitoring/report", hubURL)

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	// Send initial baseline payload immediately
	sendPayload(client, reportURL, token, col, sysInfo)

	for {
		select {
		case <-stopChan:
			return
		case <-ticker.C:
			sendPayload(client, reportURL, token, col, sysInfo)
		}
	}
}

func sendPayload(client *http.Client, reportURL, token string, col collector.Collector, sysInfo *collector.SystemInfo) {
	metrics, err := col.Collect()
	if err != nil {
		log.Printf("Error collecting metrics: %v", err)
		return
	}

	// Attach full system info on each payload
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
	}
}
