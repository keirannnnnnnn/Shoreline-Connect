//go:build windows
// +build windows

package collector

import (
	"fmt"
	"os"
	"runtime"
	"syscall"
	"time"
	"unsafe"
)

var (
	modkernel32 = syscall.NewLazyDLL("kernel32.dll")
	modiphlpapi = syscall.NewLazyDLL("iphlpapi.dll")

	procGetSystemTimes       = modkernel32.NewProc("GetSystemTimes")
	procGlobalMemoryStatusEx = modkernel32.NewProc("GlobalMemoryStatusEx")
	procGetDiskFreeSpaceExW  = modkernel32.NewProc("GetDiskFreeSpaceExW")
	procGetLogicalDriveStringsW = modkernel32.NewProc("GetLogicalDriveStringsW")
	procGetTickCount64       = modkernel32.NewProc("GetTickCount64")
	procGetIfTable           = modiphlpapi.NewProc("GetIfTable")
)

type memoryStatusEx struct {
	cbSize                  uint32
	dwMemoryLoad            uint32
	ullTotalPhys            uint64
	ullAvailPhys            uint64
	ullTotalPageFile        uint64
	ullAvailPageFile        uint64
	ullTotalVirtual         uint64
	ullAvailVirtual         uint64
	ullAvailExtendedVirtual uint64
}

type filetime struct {
	dwLowDateTime  uint32
	dwHighDateTime uint32
}

func (ft filetime) toUint64() uint64 {
	return uint64(ft.dwHighDateTime)<<32 | uint64(ft.dwLowDateTime)
}

type mibIfRow struct {
	wszName             [256]uint16
	dwIndex             uint32
	dwType              uint32
	dwMtu               uint32
	dwSpeed             uint32
	dwPhysAddrLen       uint32
	bPhysAddr           [8]byte
	dwAdminStatus       uint32
	dwOperStatus        uint32
	dwLastChange        uint32
	dwInOctets          uint32
	dwInUcastPkts       uint32
	dwInNUcastPkts      uint32
	dwInDiscards        uint32
	dwInErrors          uint32
	dwInUnknownProtos    uint32
	dwOutOctets         uint32
	dwOutUcastPkts      uint32
	dwOutNUcastPkts     uint32
	dwOutDiscards       uint32
	dwOutErrors         uint32
	dwOutQLen           uint32
	dwDescrLen          uint32
	bDescr              [256]byte
}

type WindowsCollector struct {
	BaseCollector
	prevIdleTime   uint64
	prevKernelTime uint64
	prevUserTime   uint64
}

func newPlatformCollector() Collector {
	return &WindowsCollector{
		BaseCollector: BaseCollector{
			LastCollectTime: time.Now(),
		},
	}
}

func (wc *WindowsCollector) GetSystemInfo() (*SystemInfo, error) {
	hostname, _ := os.Hostname()
	disks := wc.getDiskUsage()

	var totalDisk uint64
	for _, d := range disks {
		totalDisk += d.TotalBytes
	}

	var memStatus memoryStatusEx
	memStatus.cbSize = uint32(unsafe.Sizeof(memStatus))
	procGlobalMemoryStatusEx.Call(uintptr(unsafe.Pointer(&memStatus)))

	return &SystemInfo{
		Hostname:     hostname,
		OS:           "Windows",
		Platform:     "Windows",
		PlatformVer:  runtime.GOOS,
		Kernel:       runtime.Version(),
		Arch:         runtime.GOARCH,
		CPUModel:     fmt.Sprintf("%s (%d cores)", runtime.GOARCH, runtime.NumCPU()),
		CPUCores:     runtime.NumCPU(),
		TotalRAM:     memStatus.ullTotalPhys,
		TotalDisk:    totalDisk,
		AgentVersion: AgentVersion,
		Disks:        disks,
	}, nil
}

func (wc *WindowsCollector) Collect() (*MetricPayload, error) {
	now := time.Now()
	deltaSec := now.Sub(wc.LastCollectTime).Seconds()
	if deltaSec <= 0 {
		deltaSec = 1
	}

	// 1. CPU Usage
	cpuPct := wc.getCPUUsage()

	// 2. RAM & Swap (Pagefile)
	var memStatus memoryStatusEx
	memStatus.cbSize = uint32(unsafe.Sizeof(memStatus))
	procGlobalMemoryStatusEx.Call(uintptr(unsafe.Pointer(&memStatus)))

	ramTotal := memStatus.ullTotalPhys
	ramUsed := memStatus.ullTotalPhys - memStatus.ullAvailPhys
	var ramPct float64
	if ramTotal > 0 {
		ramPct = (float64(ramUsed) / float64(ramTotal)) * 100.0
	}

	swapTotal := memStatus.ullTotalPageFile
	swapUsed := memStatus.ullTotalPageFile - memStatus.ullAvailPageFile
	var swapPct float64
	if swapTotal > 0 {
		swapPct = (float64(swapUsed) / float64(swapTotal)) * 100.0
	}

	// 3. Network Throughput
	curNetRx, curNetTx := wc.getNetIO()
	var netRxRate, netTxRate float64
	if wc.HasPrevNet && curNetRx >= wc.LastNetRx && curNetTx >= wc.LastNetTx {
		netRxRate = float64(curNetRx-wc.LastNetRx) / deltaSec
		netTxRate = float64(curNetTx-wc.LastNetTx) / deltaSec
	}
	wc.LastNetRx = curNetRx
	wc.LastNetTx = curNetTx
	wc.HasPrevNet = true

	// 4. Uptime
	r, _, _ := procGetTickCount64.Call()
	uptimeSec := uint64(r / 1000)

	// 5. Disks
	disks := wc.getDiskUsage()

	wc.LastCollectTime = now

	return &MetricPayload{
		Timestamp:      now.Unix(),
		CPUUsage:       cpuPct,
		RAMUsed:        ramUsed,
		RAMTotal:       ramTotal,
		RAMPercent:     ramPct,
		SwapUsed:       swapUsed,
		SwapTotal:      swapTotal,
		SwapPercent:    swapPct,
		DiskReadBytes:  0, // Read from WMI/PerfMon in advanced setups
		DiskWriteBytes: 0,
		NetRxBytesSec:  netRxRate,
		NetTxBytesSec:  netTxRate,
		Uptime:         uptimeSec,
		Disks:          disks,
	}, nil
}

func (wc *WindowsCollector) getCPUUsage() float64 {
	var idleTime, kernelTime, userTime filetime
	r, _, _ := procGetSystemTimes.Call(
		uintptr(unsafe.Pointer(&idleTime)),
		uintptr(unsafe.Pointer(&kernelTime)),
		uintptr(unsafe.Pointer(&userTime)),
	)
	if r == 0 {
		return 0
	}

	curIdle := idleTime.toUint64()
	curKernel := kernelTime.toUint64()
	curUser := userTime.toUint64()

	if !wc.HasPrevCPU {
		wc.prevIdleTime = curIdle
		wc.prevKernelTime = curKernel
		wc.prevUserTime = curUser
		wc.HasPrevCPU = true
		return 0
	}

	idleDelta := curIdle - wc.prevIdleTime
	kernelDelta := curKernel - wc.prevKernelTime
	userDelta := curUser - wc.prevUserTime

	totalDelta := kernelDelta + userDelta

	wc.prevIdleTime = curIdle
	wc.prevKernelTime = curKernel
	wc.prevUserTime = curUser

	if totalDelta == 0 {
		return 0
	}

	busyDelta := totalDelta - idleDelta
	pct := (float64(busyDelta) / float64(totalDelta)) * 100.0
	if pct < 0 {
		pct = 0
	}
	if pct > 100 {
		pct = 100
	}
	return pct
}

func (wc *WindowsCollector) getNetIO() (rx uint64, tx uint64) {
	var bufSize uint32 = 15000
	buf := make([]byte, bufSize)

	r, _, _ := procGetIfTable.Call(
		uintptr(unsafe.Pointer(&buf[0])),
		uintptr(unsafe.Pointer(&bufSize)),
		1, // sorted
	)

	if r != 0 {
		return 0, 0
	}

	numEntries := *(*uint32)(unsafe.Pointer(&buf[0]))
	rowSize := unsafe.Sizeof(mibIfRow{})
	var offset uintptr = 4

	for i := uint32(0); i < numEntries; i++ {
		if offset+rowSize > uintptr(len(buf)) {
			break
		}
		row := (*mibIfRow)(unsafe.Pointer(&buf[offset]))
		// 6 = ethernet, 71 = 802.11 wireless, 23 = ppp
		if row.dwType == 6 || row.dwType == 71 {
			rx += uint64(row.dwInOctets)
			tx += uint64(row.dwOutOctets)
		}
		offset += rowSize
	}
	return
}

func (wc *WindowsCollector) getDiskUsage() []DiskInfo {
	var buf [512]uint16
	r, _, _ := procGetLogicalDriveStringsW.Call(uintptr(len(buf)), uintptr(unsafe.Pointer(&buf[0])))
	if r == 0 {
		return nil
	}

	var disks []DiskInfo
	var driveStart = 0
	for i := 0; i < int(r); i++ {
		if buf[i] == 0 {
			if i > driveStart {
				drive := syscall.UTF16ToString(buf[driveStart:i])
				drivePtr, _ := syscall.UTF16PtrFromString(drive)

				var freeBytesAvailable, totalBytes, totalFreeBytes uint64
				r2, _, _ := procGetDiskFreeSpaceExW.Call(
					uintptr(unsafe.Pointer(drivePtr)),
					uintptr(unsafe.Pointer(&freeBytesAvailable)),
					uintptr(unsafe.Pointer(&totalBytes)),
					uintptr(unsafe.Pointer(&totalFreeBytes)),
				)

				if r2 != 0 && totalBytes > 0 {
					usedBytes := totalBytes - totalFreeBytes
					usedPct := (float64(usedBytes) / float64(totalBytes)) * 100.0
					disks = append(disks, DiskInfo{
						MountPoint: drive,
						Device:     drive,
						FSType:     "NTFS",
						TotalBytes: totalBytes,
						UsedBytes:  usedBytes,
						FreeBytes:  totalFreeBytes,
						UsedPct:    usedPct,
					})
				}
			}
			driveStart = i + 1
		}
	}
	return disks
}
