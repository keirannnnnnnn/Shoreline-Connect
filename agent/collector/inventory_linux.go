//go:build linux
// +build linux

package collector

import (
	"bufio"
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"
)

// Check if a Linux reboot is required
func isLinuxRebootRequired() bool {
	if _, err := os.Stat("/var/run/reboot-required"); err == nil {
		return true
	}
	if _, err := os.Stat("/run/reboot-required"); err == nil {
		return true
	}
	return false
}

// Get full Linux software inventory (dpkg, snap, flatpak)
func (c *LinuxCollector) GetSoftwareInventory() ([]SoftwareItem, bool, error) {
	var items []SoftwareItem
	seenKeys := make(map[string]bool)

	// 1. Query dpkg packages: Package \t Version \t Architecture \t Maintainer
	if _, err := exec.LookPath("dpkg-query"); err == nil {
		cmd := exec.Command("dpkg-query", "-W", "-f=${Package}\t${Version}\t${Architecture}\t${Maintainer}\n")
		out, err := cmd.Output()
		if err == nil {
			scanner := bufio.NewScanner(bytes.NewReader(out))
			for scanner.Scan() {
				line := scanner.Text()
				parts := strings.Split(line, "\t")
				if len(parts) >= 2 {
					pkg := strings.TrimSpace(parts[0])
					ver := strings.TrimSpace(parts[1])
					arch := ""
					if len(parts) >= 3 {
						arch = strings.TrimSpace(parts[2])
					}
					maintainer := ""
					if len(parts) >= 4 {
						maintainer = strings.TrimSpace(parts[3])
					}

					key := fmt.Sprintf("dpkg_%s_%s", pkg, arch)
					if seenKeys[key] {
						continue
					}
					seenKeys[key] = true

					items = append(items, SoftwareItem{
						SoftwareKey:             key,
						Name:                    pkg,
						Version:                 ver,
						Publisher:               maintainer,
						Arch:                    arch,
						Source:                  "dpkg",
						QuietUninstallString:    fmt.Sprintf("apt-get remove -y %s", pkg),
						IsPerUser:               false,
						IsRemotelyUninstallable: true,
					})
				}
			}
		}
	}

	// 2. Query snap packages
	if _, err := exec.LookPath("snap"); err == nil {
		cmd := exec.Command("snap", "list")
		out, err := cmd.Output()
		if err == nil {
			scanner := bufio.NewScanner(bytes.NewReader(out))
			first := true
			for scanner.Scan() {
				if first {
					first = false
					continue
				}
				fields := strings.Fields(scanner.Text())
				if len(fields) >= 3 {
					name := fields[0]
					ver := fields[1]
					key := fmt.Sprintf("snap_%s", name)
					if seenKeys[key] {
						continue
					}
					seenKeys[key] = true

					publisher := ""
					if len(fields) >= 5 {
						publisher = fields[4]
					}

					items = append(items, SoftwareItem{
						SoftwareKey:             key,
						Name:                    name,
						Version:                 ver,
						Publisher:               publisher,
						Arch:                    runtime.GOARCH,
						Source:                  "snap",
						QuietUninstallString:    fmt.Sprintf("snap remove %s", name),
						IsPerUser:               false,
						IsRemotelyUninstallable: true,
					})
				}
			}
		}
	}

	// 3. Query flatpak packages
	if _, err := exec.LookPath("flatpak"); err == nil {
		cmd := exec.Command("flatpak", "list", "--columns=application,name,version,arch,origin")
		out, err := cmd.Output()
		if err == nil {
			scanner := bufio.NewScanner(bytes.NewReader(out))
			for scanner.Scan() {
				fields := strings.Fields(scanner.Text())
				if len(fields) >= 2 {
					appId := fields[0]
					name := fields[1]
					ver := ""
					if len(fields) >= 3 {
						ver = fields[2]
					}
					key := fmt.Sprintf("flatpak_%s", appId)
					if seenKeys[key] {
						continue
					}
					seenKeys[key] = true

					items = append(items, SoftwareItem{
						SoftwareKey:             key,
						Name:                    name,
						Version:                 ver,
						Publisher:               appId,
						Arch:                    runtime.GOARCH,
						Source:                  "flatpak",
						QuietUninstallString:    fmt.Sprintf("flatpak uninstall -y %s", appId),
						IsPerUser:               false,
						IsRemotelyUninstallable: true,
					})
				}
			}
		}
	}

	rebootReq := isLinuxRebootRequired()
	return items, rebootReq, nil
}

// Detect available software updates on Linux (apt list --upgradable, snap refresh)
func (c *LinuxCollector) GetAvailableUpdates() ([]AvailableUpdateItem, error) {
	var updates []AvailableUpdateItem

	if _, err := exec.LookPath("apt"); err == nil {
		_ = exec.Command("apt-get", "update", "-qq").Run()
		cmd := exec.Command("apt", "list", "--upgradable")
		out, err := cmd.Output()
		if err == nil {
			scanner := bufio.NewScanner(bytes.NewReader(out))
			for scanner.Scan() {
				line := scanner.Text()
				if strings.HasPrefix(line, "Listing...") || strings.TrimSpace(line) == "" {
					continue
				}
				// Format: package/release version arch [upgradable from: current_version]
				parts := strings.Split(line, "/")
				if len(parts) >= 2 {
					pkgName := strings.TrimSpace(parts[0])
					rest := parts[1]
					fields := strings.Fields(rest)
					availVer := ""
					currVer := ""
					if len(fields) >= 2 {
						availVer = fields[1]
					}
					if idx := strings.Index(line, "upgradable from: "); idx != -1 {
						sub := line[idx+len("upgradable from: "):]
						currVer = strings.TrimRight(strings.TrimSpace(sub), "]")
					}

					isSecurity := strings.Contains(strings.ToLower(line), "-security")
					requiresReboot := strings.Contains(strings.ToLower(pkgName), "linux-image")

					updates = append(updates, AvailableUpdateItem{
						Name:             pkgName,
						CurrentVersion:   currVer,
						AvailableVersion: availVer,
						Source:           "apt",
						IsSecurity:       isSecurity,
						RequiresReboot:   requiresReboot,
					})
				}
			}
		}
	}

	return updates, nil
}
