//go:build !windows
// +build !windows

package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

func isWindowsService() bool {
	return false
}

func runWindowsService(hubURL, token string, interval int, insecure bool) error {
	return nil
}

func installService(hubURL, token string, interval int, insecure bool) error {
	exePath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("failed to get executable path: %w", err)
	}
	exePath, _ = filepath.Abs(exePath)

	insecFlag := ""
	if insecure {
		insecFlag = " -insecure"
	}

	unitContent := fmt.Sprintf(`[Unit]
Description=Shoreline Connect Monitoring Agent
After=network.target network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=%s -hub "%s" -token "%s" -interval %d%s
Restart=always
RestartSec=5s
KillMode=process
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
`, exePath, hubURL, token, interval, insecFlag)

	servicePath := "/etc/systemd/system/shoreline-agent.service"
	if err := os.WriteFile(servicePath, []byte(unitContent), 0644); err != nil {
		return fmt.Errorf("failed to write systemd unit: %w", err)
	}

	_ = exec.Command("systemctl", "daemon-reload").Run()
	if err := exec.Command("systemctl", "enable", "--now", "shoreline-agent").Run(); err != nil {
		return fmt.Errorf("failed to enable and start systemd service: %w", err)
	}
	return nil
}

func uninstallService() error {
	_ = exec.Command("systemctl", "stop", "shoreline-agent").Run()
	_ = exec.Command("systemctl", "disable", "shoreline-agent").Run()
	_ = os.Remove("/etc/systemd/system/shoreline-agent.service")
	_ = exec.Command("systemctl", "daemon-reload").Run()
	return nil
}
