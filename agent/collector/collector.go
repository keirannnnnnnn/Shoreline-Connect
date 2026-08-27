package collector

import (
	"time"
)

const AgentVersion = "1.0.0"

type Collector interface {
	GetSystemInfo() (*SystemInfo, error)
	Collect() (*MetricPayload, error)
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
