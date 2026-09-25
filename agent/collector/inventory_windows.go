//go:build windows
// +build windows

package collector

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"golang.org/x/sys/windows/registry"
)

// Check if a Windows reboot is pending
func isWindowsRebootRequired() bool {
	// 1. Windows Update RebootRequired key
	if k, err := registry.OpenKey(registry.LOCAL_MACHINE, `SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired`, registry.QUERY_VALUE); err == nil {
		k.Close()
		return true
	}

	// 2. Component Based Servicing RebootPending key
	if k, err := registry.OpenKey(registry.LOCAL_MACHINE, `SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending`, registry.QUERY_VALUE); err == nil {
		k.Close()
		return true
	}

	// 3. PendingFileRenameOperations
	if k, err := registry.OpenKey(registry.LOCAL_MACHINE, `SYSTEM\CurrentControlSet\Control\Session Manager`, registry.QUERY_VALUE); err == nil {
		defer k.Close()
		if val, _, err := k.GetStringsValue("PendingFileRenameOperations"); err == nil && len(val) > 0 {
			return true
		}
	}

	return false
}

// Read software entries from a specific Windows Uninstall registry key
func scanUninstallKey(root registry.Key, path string, isPerUser bool, itemsMap map[string]SoftwareItem) {
	k, err := registry.OpenKey(root, path, registry.ENUMERATE_SUB_KEYS|registry.QUERY_VALUE)
	if err != nil {
		return
	}
	defer k.Close()

	subkeys, err := k.ReadSubKeyNames(-1)
	if err != nil {
		return
	}

	for _, sub := range subkeys {
		subKey, err := registry.OpenKey(root, path+`\`+sub, registry.QUERY_VALUE)
		if err != nil {
			continue
		}

		// 1. Exclude SystemComponent = 1
		if sysComp, _, err := subKey.GetIntegerValue("SystemComponent"); err == nil && sysComp == 1 {
			subKey.Close()
			continue
		}

		// 2. Exclude entries with ParentKeyName (sub-components/patches)
		if parentKey, _, err := subKey.GetStringValue("ParentKeyName"); err == nil && strings.TrimSpace(parentKey) != "" {
			subKey.Close()
			continue
		}

		// 3. Exclude Windows OS Updates / Hotfixes
		if relType, _, err := subKey.GetStringValue("ReleaseType"); err == nil {
			lowerRel := strings.ToLower(relType)
			if strings.Contains(lowerRel, "update") || strings.Contains(lowerRel, "hotfix") || strings.Contains(lowerRel, "security") {
				subKey.Close()
				continue
			}
		}

		displayName, _, _ := subKey.GetStringValue("DisplayName")
		displayName = strings.TrimSpace(displayName)
		if displayName == "" {
			subKey.Close()
			continue
		}

		displayVersion, _, _ := subKey.GetStringValue("DisplayVersion")
		publisher, _, _ := subKey.GetStringValue("Publisher")
		installDate, _, _ := subKey.GetStringValue("InstallDate")
		uninstallString, _, _ := subKey.GetStringValue("UninstallString")
		quietUninstallString, _, _ := subKey.GetStringValue("QuietUninstallString")
		winInstaller, _, _ := subKey.GetIntegerValue("WindowsInstaller")

		source := "exe"
		msiProductCode := ""

		// If WindowsInstaller is set or the key is a GUID, classify as MSI
		if winInstaller == 1 || (strings.HasPrefix(sub, "{") && strings.HasSuffix(sub, "}")) {
			source = "msi"
			msiProductCode = sub
			if quietUninstallString == "" {
				quietUninstallString = fmt.Sprintf("MsiExec.exe /X%s /qn /norestart", sub)
			}
		}

		subKey.Close()

		softwareKey := sub
		if isPerUser {
			softwareKey = "user_" + sub
		}

		itemsMap[softwareKey] = SoftwareItem{
			SoftwareKey:             softwareKey,
			Name:                    displayName,
			Version:                 strings.TrimSpace(displayVersion),
			Publisher:               strings.TrimSpace(publisher),
			InstallDate:             strings.TrimSpace(installDate),
			Arch:                    runtime.GOARCH,
			Source:                  source,
			UninstallString:         strings.TrimSpace(uninstallString),
			QuietUninstallString:    strings.TrimSpace(quietUninstallString),
			MSIProductCode:          msiProductCode,
			IsPerUser:               isPerUser,
			IsRemotelyUninstallable: !isPerUser,
		}
	}
}

// Get full Windows software inventory
func (c *WindowsCollector) GetSoftwareInventory() ([]SoftwareItem, bool, error) {
	itemsMap := make(map[string]SoftwareItem)

	// 1. 64-bit & native HKLM
	scanUninstallKey(registry.LOCAL_MACHINE, `SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall`, false, itemsMap)

	// 2. 32-bit WOW6432Node HKLM
	scanUninstallKey(registry.LOCAL_MACHINE, `SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall`, false, itemsMap)

	// 3. User hives under HKU
	if uKey, err := registry.OpenKey(registry.USERS, "", registry.ENUMERATE_SUB_KEYS); err == nil {
		userSIDs, _ := uKey.ReadSubKeyNames(-1)
		uKey.Close()
		for _, sid := range userSIDs {
			if strings.HasSuffix(sid, "_Classes") || strings.EqualFold(sid, ".DEFAULT") {
				continue
			}
			scanUninstallKey(registry.USERS, sid+`\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall`, true, itemsMap)
		}
	}

	result := make([]SoftwareItem, 0, len(itemsMap))
	for _, item := range itemsMap {
		result = append(result, item)
	}

	rebootReq := isWindowsRebootRequired()
	return result, rebootReq, nil
}

// Locate winget executable even under SYSTEM account
func findWingetPath() string {
	// 1. Check PATH first
	if p, err := exec.LookPath("winget.exe"); err == nil {
		return p
	}

	// 2. Check WindowsApps directory
	sysDrive := os.Getenv("SystemDrive")
	if sysDrive == "" {
		sysDrive = "C:"
	}
	pattern := filepath.Join(sysDrive, `Program Files\WindowsApps\Microsoft.DesktopAppInstaller_*_x64__8wekyb3d8bbwe\winget.exe`)
	matches, err := filepath.Glob(pattern)
	if err == nil && len(matches) > 0 {
		return matches[len(matches)-1]
	}

	// 3. Check LocalAppData AppExecutionAlias
	localAppData := os.Getenv("LOCALAPPDATA")
	if localAppData != "" {
		aliasPath := filepath.Join(localAppData, `Microsoft\WindowsApps\winget.exe`)
		if _, err := os.Stat(aliasPath); err == nil {
			return aliasPath
		}
	}

	return ""
}

// Detect available software updates on Windows using WinGet (Microsoft.WinGet.Client PowerShell module first, table fallback)
func (c *WindowsCollector) GetAvailableUpdates() ([]AvailableUpdateItem, error) {
	// 1. Try PowerShell Microsoft.WinGet.Client module first
	psScript := `
$ErrorActionPreference = "Stop"
try {
    Import-Module Microsoft.WinGet.Client -ErrorAction Stop
    $pkgs = Get-WinGetPackage -Scope Machine -Source winget | Where-Object { $_.IsUpdateAvailable }
    $res = @()
    foreach ($p in $pkgs) {
        $avail = ""
        if ($p.AvailableVersions -and $p.AvailableVersions.Count -gt 0) {
            $avail = [string]$p.AvailableVersions[0]
        }
        $res += [PSCustomObject]@{
            name = [string]$p.Name
            id = [string]$p.Id
            current = [string]$p.InstalledVersion
            available = $avail
        }
    }
    $res | ConvertTo-Json -Compress
} catch {
    exit 2
}
`
	psCmd := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", psScript)
	psOut, psErr := psCmd.CombinedOutput()
	if psErr == nil && len(strings.TrimSpace(string(psOut))) > 0 {
		var rawResults []struct {
			Name      string `json:"name"`
			ID        string `json:"id"`
			Current   string `json:"current"`
			Available string `json:"available"`
		}

		trimmed := strings.TrimSpace(string(psOut))
		// Check if single object or array
		if strings.HasPrefix(trimmed, "{") {
			var single struct {
				Name      string `json:"name"`
				ID        string `json:"id"`
				Current   string `json:"current"`
				Available string `json:"available"`
			}
			if err := json.Unmarshal([]byte(trimmed), &single); err == nil {
				rawResults = append(rawResults, single)
			}
		} else {
			_ = json.Unmarshal([]byte(trimmed), &rawResults)
		}

		if len(rawResults) > 0 {
			var updates []AvailableUpdateItem
			for _, r := range rawResults {
				name := r.Name
				if name == "" {
					name = r.ID
				}
				updates = append(updates, AvailableUpdateItem{
					Name:              name,
					PackageIdentifier: r.ID,
					CurrentVersion:    r.Current,
					AvailableVersion:  r.Available,
					Source:            "winget",
					IsSecurity:        false,
					RequiresReboot:    false,
				})
			}
			return updates, nil
		}
	}

	// 2. Fallback: table parsing via winget CLI with --disable-interactivity
	wingetPath := findWingetPath()
	if wingetPath == "" {
		return nil, fmt.Errorf("winget not available on this system")
	}

	cmd := exec.Command(wingetPath, "upgrade", "--scope", "machine", "--source", "winget", "--accept-source-agreements", "--disable-interactivity")
	out, err := cmd.CombinedOutput()
	if err != nil && len(out) == 0 {
		return nil, fmt.Errorf("failed to run winget upgrade: %w", err)
	}

	lines := strings.Split(string(out), "\n")
	var updates []AvailableUpdateItem
	inTable := false

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "---") {
			inTable = true
			continue
		}
		if !inTable || trimmed == "" {
			continue
		}

		fields := strings.Fields(trimmed)
		if len(fields) >= 4 {
			// Typical output format: Name Id Version Available Source
			// Key strictly on Id (package ID)
			availVer := fields[len(fields)-2]
			currVer := fields[len(fields)-3]
			pkgId := fields[len(fields)-4]
			name := strings.Join(fields[:len(fields)-4], " ")
			if name == "" {
				name = pkgId
			}

			updates = append(updates, AvailableUpdateItem{
				Name:              name,
				PackageIdentifier: pkgId,
				CurrentVersion:    currVer,
				AvailableVersion:  availVer,
				Source:            "winget",
				IsSecurity:        false,
				RequiresReboot:    false,
			})
		}
	}

	return updates, nil
}
