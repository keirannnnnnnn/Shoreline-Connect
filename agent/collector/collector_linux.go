//go:build !windows
// +build !windows

package collector

import (
	"bufio"
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"
)

type cpuTimeStat struct {
	user   uint64
	nice   uint64
	system uint64
	idle   uint64
	iowait uint64
	irq    uint64
	softirq uint64
	steal  uint64
}

func (c cpuTimeStat) Total() uint64 {
	return c.user + c.nice + c.system + c.idle + c.iowait + c.irq + c.softirq + c.steal
}

func (c cpuTimeStat) Active() uint64 {
	return c.user + c.nice + c.system + c.irq + c.softirq + c.steal
}

type LinuxCollector struct {
	BaseCollector
	prevTotalCPU  cpuTimeStat
	prevCoreCPUs  []cpuTimeStat
}

func newLinuxCollector() Collector {
	return &LinuxCollector{
		BaseCollector: BaseCollector{
			LastCollectTime: time.Now(),
		},
	}
}

func (lc *LinuxCollector) GetSystemInfo() (*SystemInfo, error) {
	hostname, _ := os.Hostname()

	osName := "Linux"
	osVer := ""
	if data, err := os.ReadFile("/etc/os-release"); err == nil {
		lines := strings.Split(string(data), "\n")
		for _, line := range lines {
			if strings.HasPrefix(line, "PRETTY_NAME=") {
				osName = strings.Trim(strings.TrimPrefix(line, "PRETTY_NAME="), "\"")
			} else if strings.HasPrefix(line, "VERSION_ID=") {
				osVer = strings.Trim(strings.TrimPrefix(line, "VERSION_ID="), "\"")
			}
		}
	}

	kernel := ""
	var uname syscall.Utsname
	if err := syscall.Uname(&uname); err == nil {
		var release bytes.Buffer
		for _, b := range uname.Release {
			if b == 0 {
				break
			}
			release.WriteByte(byte(b))
		}
		kernel = release.String()
	}

	cpuModel, _ := lc.getCPUModel()
	disks := lc.getDiskUsage()

	var totalDisk uint64
	for _, d := range disks {
		totalDisk += d.TotalBytes
	}

	ramTotal, _, _, _ := lc.getMemInfo()

	return &SystemInfo{
		Hostname:     hostname,
		OS:           osName,
		Platform:     "Linux",
		PlatformVer:  osVer,
		Kernel:       kernel,
		Arch:         runtime.GOARCH,
		CPUModel:     cpuModel,
		CPUCores:     runtime.NumCPU(),
		TotalRAM:     ramTotal,
		TotalDisk:    totalDisk,
		AgentVersion: AgentVersion,
		Disks:        disks,
	}, nil
}

func (lc *LinuxCollector) Collect() (*MetricPayload, error) {
	now := time.Now()
	deltaSec := now.Sub(lc.LastCollectTime).Seconds()
	if deltaSec <= 0 {
		deltaSec = 1
	}

	// 1. CPU Usage
	totalPct, corePcts := lc.calculateCPUUsage()

	// 2. Memory & Swap
	ramTotal, ramUsed, swapTotal, swapUsed := lc.getMemInfo()
	var ramPct, swapPct float64
	if ramTotal > 0 {
		ramPct = (float64(ramUsed) / float64(ramTotal)) * 100.0
	}
	if swapTotal > 0 {
		swapPct = (float64(swapUsed) / float64(swapTotal)) * 100.0
	}

	// 3. Disk I/O
	curDiskRead, curDiskWrite := lc.getDiskIO()
	var diskReadRate, diskWriteRate float64
	if lc.HasPrevDisk && curDiskRead >= lc.LastDiskRead && curDiskWrite >= lc.LastDiskWrite {
		diskReadRate = float64(curDiskRead-lc.LastDiskRead) / deltaSec
		diskWriteRate = float64(curDiskWrite-lc.LastDiskWrite) / deltaSec
	}
	lc.LastDiskRead = curDiskRead
	lc.LastDiskWrite = curDiskWrite
	lc.HasPrevDisk = true

	// 4. Network Throughput
	curNetRx, curNetTx := lc.getNetIO()
	var netRxRate, netTxRate float64
	if lc.HasPrevNet && curNetRx >= lc.LastNetRx && curNetTx >= lc.LastNetTx {
		netRxRate = float64(curNetRx-lc.LastNetRx) / deltaSec
		netTxRate = float64(curNetTx-lc.LastNetTx) / deltaSec
	}
	lc.LastNetRx = curNetRx
	lc.LastNetTx = curNetTx
	lc.HasPrevNet = true

	// 5. CPU Temperature
	cpuTemp := lc.getCPUTemperature()

	// 6. System Load & Uptime
	l1, l5, l15 := lc.getLoadAvg()
	uptime := lc.getUptime()

	// 7. Disks
	disks := lc.getDiskUsage()

	lc.LastCollectTime = now

	return &MetricPayload{
		Timestamp:      now.Unix(),
		CPUUsage:       totalPct,
		CPUPerCore:     corePcts,
		RAMUsed:        ramUsed,
		RAMTotal:       ramTotal,
		RAMPercent:     ramPct,
		SwapUsed:       swapUsed,
		SwapTotal:      swapTotal,
		SwapPercent:    swapPct,
		DiskReadBytes:  diskReadRate,
		DiskWriteBytes: diskWriteRate,
		NetRxBytesSec:  netRxRate,
		NetTxBytesSec:  netTxRate,
		CPUTemp:        cpuTemp,
		Load1:          l1,
		Load5:          l5,
		Load15:         l15,
		Uptime:         uptime,
		Disks:          disks,
	}, nil
}

func (lc *LinuxCollector) calculateCPUUsage() (float64, []float64) {
	file, err := os.Open("/proc/stat")
	if err != nil {
		return 0, nil
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	var currentTotals cpuTimeStat
	var currentCores []cpuTimeStat

	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "cpu ") {
			fields := strings.Fields(line)
			if len(fields) >= 8 {
				currentTotals.user, _ = strconv.ParseUint(fields[1], 10, 64)
				currentTotals.nice, _ = strconv.ParseUint(fields[2], 10, 64)
				currentTotals.system, _ = strconv.ParseUint(fields[3], 10, 64)
				currentTotals.idle, _ = strconv.ParseUint(fields[4], 10, 64)
				currentTotals.iowait, _ = strconv.ParseUint(fields[5], 10, 64)
				currentTotals.irq, _ = strconv.ParseUint(fields[6], 10, 64)
				currentTotals.softirq, _ = strconv.ParseUint(fields[7], 10, 64)
				if len(fields) >= 9 {
					currentTotals.steal, _ = strconv.ParseUint(fields[8], 10, 64)
				}
			}
		} else if strings.HasPrefix(line, "cpu") && len(line) > 3 && line[3] >= '0' && line[3] <= '9' {
			fields := strings.Fields(line)
			if len(fields) >= 8 {
				var core cpuTimeStat
				core.user, _ = strconv.ParseUint(fields[1], 10, 64)
				core.nice, _ = strconv.ParseUint(fields[2], 10, 64)
				core.system, _ = strconv.ParseUint(fields[3], 10, 64)
				core.idle, _ = strconv.ParseUint(fields[4], 10, 64)
				core.iowait, _ = strconv.ParseUint(fields[5], 10, 64)
				core.irq, _ = strconv.ParseUint(fields[6], 10, 64)
				core.softirq, _ = strconv.ParseUint(fields[7], 10, 64)
				if len(fields) >= 9 {
					core.steal, _ = strconv.ParseUint(fields[8], 10, 64)
				}
				currentCores = append(currentCores, core)
			}
		}
	}

	if !lc.HasPrevCPU {
		lc.prevTotalCPU = currentTotals
		lc.prevCoreCPUs = currentCores
		lc.HasPrevCPU = true
		return 0, nil
	}

	totalDelta := currentTotals.Total() - lc.prevTotalCPU.Total()
	activeDelta := currentTotals.Active() - lc.prevTotalCPU.Active()
	var totalPct float64
	if totalDelta > 0 {
		totalPct = (float64(activeDelta) / float64(totalDelta)) * 100.0
	}

	var corePcts []float64
	for i, curCore := range currentCores {
		if i < len(lc.prevCoreCPUs) {
			cTotalDelta := curCore.Total() - lc.prevCoreCPUs[i].Total()
			cActiveDelta := curCore.Active() - lc.prevCoreCPUs[i].Active()
			if cTotalDelta > 0 {
				corePcts = append(corePcts, (float64(cActiveDelta)/float64(cTotalDelta))*100.0)
			} else {
				corePcts = append(corePcts, 0)
			}
		}
	}

	lc.prevTotalCPU = currentTotals
	lc.prevCoreCPUs = currentCores

	return totalPct, corePcts
}

func (lc *LinuxCollector) getMemInfo() (total uint64, used uint64, swapTotal uint64, swapUsed uint64) {
	file, err := os.Open("/proc/meminfo")
	if err != nil {
		return
	}
	defer file.Close()

	var memTotal, memFree, memAvailable, buffers, cached, sTotal, sFree uint64
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := scanner.Text()
		parts := strings.Split(line, ":")
		if len(parts) != 2 {
			continue
		}
		key := strings.TrimSpace(parts[0])
		valFields := strings.Fields(parts[1])
		if len(valFields) == 0 {
			continue
		}
		valKb, _ := strconv.ParseUint(valFields[0], 10, 64)
		valBytes := valKb * 1024

		switch key {
		case "MemTotal":
			memTotal = valBytes
		case "MemFree":
			memFree = valBytes
		case "MemAvailable":
			memAvailable = valBytes
		case "Buffers":
			buffers = valBytes
		case "Cached":
			cached = valBytes
		case "SwapTotal":
			sTotal = valBytes
		case "SwapFree":
			sFree = valBytes
		}
	}

	total = memTotal
	if memAvailable > 0 {
		used = memTotal - memAvailable
	} else {
		used = memTotal - (memFree + buffers + cached)
	}

	swapTotal = sTotal
	if sTotal >= sFree {
		swapUsed = sTotal - sFree
	}
	return
}

func (lc *LinuxCollector) getDiskIO() (readBytes uint64, writeBytes uint64) {
	file, err := os.Open("/proc/diskstats")
	if err != nil {
		return 0, 0
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 14 {
			continue
		}
		devName := fields[2]
		// Filter out loop, ram, dm devices if desired or include sd/vd/nvme/mmc
		if strings.HasPrefix(devName, "loop") || strings.HasPrefix(devName, "ram") {
			continue
		}

		sectorsRead, _ := strconv.ParseUint(fields[5], 10, 64)
		sectorsWritten, _ := strconv.ParseUint(fields[9], 10, 64)

		// 1 sector = 512 bytes on Linux
		readBytes += sectorsRead * 512
		writeBytes += sectorsWritten * 512
	}
	return
}

func (lc *LinuxCollector) getNetIO() (rxBytes uint64, txBytes uint64) {
	file, err := os.Open("/proc/net/dev")
	if err != nil {
		return 0, 0
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.Contains(line, ":") {
			continue
		}
		parts := strings.Split(line, ":")
		if len(parts) != 2 {
			continue
		}
		iface := strings.TrimSpace(parts[0])
		if iface == "lo" {
			continue
		}

		fields := strings.Fields(parts[1])
		if len(fields) >= 9 {
			rx, _ := strconv.ParseUint(fields[0], 10, 64)
			tx, _ := strconv.ParseUint(fields[8], 10, 64)
			rxBytes += rx
			txBytes += tx
		}
	}
	return
}

func (lc *LinuxCollector) getCPUTemperature() *float64 {
	// Try /sys/class/thermal/thermal_zone*/temp
	matches, _ := filepath.Glob("/sys/class/thermal/thermal_zone*/temp")
	for _, match := range matches {
		data, err := os.ReadFile(match)
		if err == nil {
			valStr := strings.TrimSpace(string(data))
			if milli, err := strconv.ParseFloat(valStr, 64); err == nil && milli > 0 {
				temp := milli / 1000.0
				if temp > 0 && temp < 150 {
					return &temp
				}
			}
		}
	}

	// Try /sys/class/hwmon/hwmon*/temp*_input
	hwmonMatches, _ := filepath.Glob("/sys/class/hwmon/hwmon*/temp*_input")
	for _, match := range hwmonMatches {
		data, err := os.ReadFile(match)
		if err == nil {
			valStr := strings.TrimSpace(string(data))
			if milli, err := strconv.ParseFloat(valStr, 64); err == nil && milli > 0 {
				temp := milli / 1000.0
				if temp > 0 && temp < 150 {
					return &temp
				}
			}
		}
	}

	return nil
}

func (lc *LinuxCollector) getLoadAvg() (*float64, *float64, *float64) {
	data, err := os.ReadFile("/proc/loadavg")
	if err != nil {
		return nil, nil, nil
	}
	fields := strings.Fields(string(data))
	if len(fields) >= 3 {
		l1, _ := strconv.ParseFloat(fields[0], 64)
		l5, _ := strconv.ParseFloat(fields[1], 64)
		l15, _ := strconv.ParseFloat(fields[2], 64)
		return &l1, &l5, &l15
	}
	return nil, nil, nil
}

func (lc *LinuxCollector) getUptime() uint64 {
	data, err := os.ReadFile("/proc/uptime")
	if err != nil {
		return 0
	}
	fields := strings.Fields(string(data))
	if len(fields) >= 1 {
		upSec, _ := strconv.ParseFloat(fields[0], 64)
		return uint64(upSec)
	}
	return 0
}

func (lc *LinuxCollector) getDiskUsage() []DiskInfo {
	file, err := os.Open("/proc/mounts")
	if err != nil {
		return nil
	}
	defer file.Close()

	var disks []DiskInfo
	seenMounts := make(map[string]bool)

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 3 {
			continue
		}
		dev := fields[0]
		mount := fields[1]
		fstype := fields[2]

		// Skip pseudo/virtual filesystems
		if !strings.HasPrefix(dev, "/dev/") {
			continue
		}
		if strings.HasPrefix(mount, "/var/lib/docker") || strings.HasPrefix(mount, "/var/lib/containerd") {
			continue
		}
		if seenMounts[mount] {
			continue
		}
		seenMounts[mount] = true

		var stat syscall.Statfs_t
		if err := syscall.Statfs(mount, &stat); err != nil {
			continue
		}

		total := stat.Blocks * uint64(stat.Bsize)
		free := stat.Bavail * uint64(stat.Bsize)
		if total == 0 {
			continue
		}
		used := total - (stat.Bfree * uint64(stat.Bsize))
		usedPct := (float64(used) / float64(total)) * 100.0

		disks = append(disks, DiskInfo{
			MountPoint: mount,
			Device:     dev,
			FSType:     fstype,
			TotalBytes: total,
			UsedBytes:  used,
			FreeBytes:  free,
			UsedPct:    usedPct,
		})
	}
	return disks
}

func (lc *LinuxCollector) getCPUModel() (string, error) {
	file, err := os.Open("/proc/cpuinfo")
	if err != nil {
		return "Unknown", err
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "model name") || strings.HasPrefix(line, "Model") || strings.HasPrefix(line, "Hardware") {
			parts := strings.Split(line, ":")
			if len(parts) == 2 {
				return strings.TrimSpace(parts[1]), nil
			}
		}
	}
	return fmt.Sprintf("%s (%d cores)", runtime.GOARCH, runtime.NumCPU()), nil
}
