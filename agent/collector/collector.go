package collector

import (
	"time"
)

// AgentVersion is embedded at compile time via -ldflags "-X main.Version=..." or "-X shoreline-agent/collector.AgentVersion=..."
// Fallback default is 1.2.0
var AgentVersion = "1.2.0"

type Collector interface {
	GetSystemInfo() (*SystemInfo, error)
	Collect() (*MetricPayload, error)
	GetSoftwareInventory() ([]SoftwareItem, bool, error)
	GetAvailableUpdates() ([]AvailableUpdateItem, error)
}

type BaseCollector struct {
	LastCollectTime time.Time
	LastDiskRead    uint64
	LastDiskWrite   uint64
	LastNetRx       uint64
	LastNetTx       uint64
	HasPrevDisk     bool
	HasPrevNet      bool
	HasPrevCPU      bool
}

func NewCollector() Collector {
	return newPlatformCollector()
}
