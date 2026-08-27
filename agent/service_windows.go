//go:build windows
// +build windows

package main

import (
	"fmt"
	"os"
	"path/filepath"
	"time"

	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/mgr"
)

type shorelineWindowsService struct {
	hubURL   string
	token    string
	interval time.Duration
	insecure bool
}

func (s *shorelineWindowsService) Execute(args []string, r <-chan svc.ChangeRequest, changes chan<- svc.Status) (bool, uint32) {
	const cmdsAccepted = svc.AcceptStop | svc.AcceptShutdown
	changes <- svc.Status{State: svc.StartPending}

	stopChan := make(chan struct{})
	go func() {
		runAgentLoop(s.hubURL, s.token, s.interval, s.insecure, stopChan)
	}()

	changes <- svc.Status{State: svc.Running, Accepts: cmdsAccepted}

	for req := range r {
		switch req.Cmd {
		case svc.Interrogate:
			changes <- req.CurrentStatus
		case svc.Stop, svc.Shutdown:
			changes <- svc.Status{State: svc.StopPending}
			close(stopChan)
			return false, 0
		}
	}
	return false, 0
}

func isWindowsService() bool {
	isSvc, err := svc.IsWindowsService()
	if err != nil {
		return false
	}
	return isSvc
}

func runWindowsService(hubURL, token string, interval int, insecure bool) error {
	s := &shorelineWindowsService{
		hubURL:   hubURL,
		token:    token,
		interval: time.Duration(interval) * time.Second,
		insecure: insecure,
	}
	return svc.Run("ShorelineAgent", s)
}

func installService(hubURL, token string, interval int, insecure bool) error {
	exePath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("failed to get executable path: %w", err)
	}
	exePath, _ = filepath.Abs(exePath)

	m, err := mgr.Connect()
	if err != nil {
		return fmt.Errorf("failed to connect to Windows Service Control Manager: %w", err)
	}
	defer m.Disconnect()

	// If service exists, stop and delete it first
	s, err := m.OpenService("ShorelineAgent")
	if err == nil {
		_, _ = s.Control(svc.Stop)
		_ = s.Delete()
		_ = s.Close()
		time.Sleep(1 * time.Second)
	}

	cfg := mgr.Config{
		DisplayName:      "Shoreline Connect Monitoring Agent",
		Description:      "Shoreline Connect server resource telemetry and monitoring agent",
		StartType:        mgr.StartAutomatic,
		ServiceStartName: "LocalSystem",
	}

	args := []string{
		"-hub", hubURL,
		"-token", token,
		"-interval", fmt.Sprintf("%d", interval),
	}
	if insecure {
		args = append(args, "-insecure")
	}

	s, err = m.CreateService("ShorelineAgent", exePath, cfg, args...)
	if err != nil {
		return fmt.Errorf("failed to create Windows service: %w", err)
	}
	defer s.Close()

	// Configure recovery action on failure: restart service after 5s, 10s, 60s
	recoveryActions := []mgr.RecoveryAction{
		{Type: mgr.ServiceRestart, Delay: 5 * time.Second},
		{Type: mgr.ServiceRestart, Delay: 10 * time.Second},
		{Type: mgr.ServiceRestart, Delay: 60 * time.Second},
	}
	_ = s.SetRecoveryActions(recoveryActions, 86400)

	// Start the service
	if err := s.Start(); err != nil {
		return fmt.Errorf("failed to start Windows service: %w", err)
	}

	return nil
}

func uninstallService() error {
	m, err := mgr.Connect()
	if err != nil {
		return fmt.Errorf("failed to connect to Windows Service Control Manager: %w", err)
	}
	defer m.Disconnect()

	s, err := m.OpenService("ShorelineAgent")
	if err != nil {
		return fmt.Errorf("service is not installed: %w", err)
	}
	defer s.Close()

	_, _ = s.Control(svc.Stop)
	if err := s.Delete(); err != nil {
		return fmt.Errorf("failed to delete service: %w", err)
	}
	return nil
}
