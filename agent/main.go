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
	"syscall"
	"time"

	"shoreline-agent/collector"
)

func main() {
	hubURL := flag.String("hub", "", "Shoreline Connect Hub URL (e.g. https://connect.shoreline.icu)")
	token := flag.String("token", "", "Device Monitoring Bearer Token")
	interval := flag.Int("interval", 15, "Metrics collection interval in seconds (default 15)")
	insecureTLS := flag.Bool("insecure", false, "Allow insecure / self-signed TLS certificates (testing only)")
	installFlag := flag.Bool("install", false, "Install agent as a background system service")
	uninstallFlag := flag.Bool("uninstall", false, "Uninstall agent background system service")
	versionFlag := flag.Bool("version", false, "Print agent version")

	flag.Parse()

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
			log.Fatalf("Error: --hub and --token are required to install the service.")
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

	runAgentLoop(cleanHubURL, *token, time.Duration(*interval)*time.Second, *insecureTLS)
}

func runAgentLoop(hubURL, token string, interval time.Duration, insecureTLS bool) {
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

	// Handle graceful shutdown signals
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)

	// Send initial baseline payload immediately
	sendPayload(client, reportURL, token, col, sysInfo)

	for {
		select {
		case <-sigChan:
			log.Println("Received termination signal. Shutting down agent.")
			return
		case <-ticker.StopChan():
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

func installService(hubURL, token string, interval int, insecure bool) error {
	exePath, err := os.Executable()
	if err != nil {
		return err
	}
	exePath, _ = filepath.Abs(exePath)

	if runtime.GOOS == "linux" {
		unitContent := fmt.Sprintf(`[Unit]
Description=Shoreline Connect Monitoring Agent
After=network.target network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=%s -hub "%s" -token "%s" -interval %d %s
Restart=always
RestartSec=5s
KillMode=process
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
`, exePath, hubURL, token, interval, boolFlag(insecure, "-insecure"))

		servicePath := "/etc/systemd/system/shoreline-agent.service"
		if err := os.WriteFile(servicePath, []byte(unitContent), 0644); err != nil {
			return fmt.Errorf("failed to write systemd unit: %w", err)
		}

		_ = exec.Command("systemctl", "daemon-reload").Run()
		if err := exec.Command("systemctl", "enable", "--now", "shoreline-agent").Run(); err != nil {
			return fmt.Errorf("failed to enable and start systemd service: %w", err)
		}
		return nil
	} else if runtime.GOOS == "windows" {
		cmdStr := fmt.Sprintf(`sc.exe create ShorelineAgent binPath= "\"%s\" -hub \"%s\" -token \"%s\" -interval %d %s" start= auto DisplayName= "Shoreline Connect Monitoring Agent"`,
			exePath, hubURL, token, interval, boolFlag(insecure, "-insecure"))
		out, err := exec.Command("cmd.exe", "/C", cmdStr).CombinedOutput()
		if err != nil {
			return fmt.Errorf("failed to create Windows service: %s (%w)", string(out), err)
		}

		_ = exec.Command("sc.exe", "failure", "ShorelineAgent", "reset= 86400", "actions= restart/5000/restart/10000/restart/60000").Run()
		_ = exec.Command("net.exe", "start", "ShorelineAgent").Run()
		return nil
	}

	return fmt.Errorf("service installation not supported on %s", runtime.GOOS)
}

func uninstallService() error {
	if runtime.GOOS == "linux" {
		_ = exec.Command("systemctl", "stop", "shoreline-agent").Run()
		_ = exec.Command("systemctl", "disable", "shoreline-agent").Run()
		_ = os.Remove("/etc/systemd/system/shoreline-agent.service")
		_ = exec.Command("systemctl", "daemon-reload").Run()
		return nil
	} else if runtime.GOOS == "windows" {
		_ = exec.Command("net.exe", "stop", "ShorelineAgent").Run()
		out, err := exec.Command("sc.exe", "delete", "ShorelineAgent").CombinedOutput()
		if err != nil {
			return fmt.Errorf("failed to delete Windows service: %s (%w)", string(out), err)
		}
		return nil
	}
	return fmt.Errorf("service uninstallation not supported on %s", runtime.GOOS)
}

func boolFlag(b bool, flagName string) string {
	if b {
		return flagName
	}
	return ""
}
