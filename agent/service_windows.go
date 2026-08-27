//go:build windows
// +build windows

package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"golang.org/x/sys/windows/svc"
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

	insecFlag := ""
	if insecure {
		insecFlag = " -insecure"
	}

	// sc.exe requires format: binPath= "<PathToExe> <args>" (space after key= is required by sc.exe)
	binPathArg := fmt.Sprintf(`"%s" -hub "%s" -token "%s" -interval %d%s`, exePath, hubURL, token, interval, insecFlag)

	// 1. Remove existing service instance if present
	_ = exec.Command("sc.exe", "stop", "ShorelineAgent").Run()
	_ = exec.Command("sc.exe", "delete", "ShorelineAgent").Run()
	time.Sleep(500 * time.Millisecond)

	// 2. Create service with sc.exe
	createOut, createErr := exec.Command(
		"sc.exe",
		"create",
		"ShorelineAgent",
		"binPath= "+binPathArg,
		"start= auto",
		"DisplayName= Shoreline Connect Monitoring Agent",
	).CombinedOutput()

	if createErr != nil {
		return fmt.Errorf("failed to create Windows service: %s (%w)", string(createOut), createErr)
	}

	// 3. Configure service failure recovery actions (restart after 5s, 10s, 60s)
	_ = exec.Command("sc.exe", "failure", "ShorelineAgent", "reset= 86400", "actions= restart/5000/restart/10000/restart/60000").Run()

	// 4. Start the service
	startOut, startErr := exec.Command("sc.exe", "start", "ShorelineAgent").CombinedOutput()
	if startErr != nil {
		return fmt.Errorf("failed to start Windows service: %s (%w)", string(startOut), startErr)
	}

	return nil
}

func uninstallService() error {
	_ = exec.Command("sc.exe", "stop", "ShorelineAgent").Run()
	out, err := exec.Command("sc.exe", "delete", "ShorelineAgent").CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to delete Windows service: %s (%w)", string(out), err)
	}
	return nil
}
