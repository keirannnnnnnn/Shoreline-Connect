package collector

type DiskInfo struct {
	MountPoint string  `json:"mount_point"`
	Device     string  `json:"device"`
	FSType     string  `json:"fs_type"`
	TotalBytes uint64  `json:"total_bytes"`
	UsedBytes  uint64  `json:"used_bytes"`
	FreeBytes  uint64  `json:"free_bytes"`
	UsedPct    float64 `json:"used_pct"`
}

type NetInterfaceStat struct {
	Name    string `json:"name"`
	RxBytes uint64 `json:"rx_bytes"`
	TxBytes uint64 `json:"tx_bytes"`
}

type SystemInfo struct {
	Hostname     string     `json:"hostname"`
	OS           string     `json:"os"`
	Platform     string     `json:"platform"`
	PlatformVer  string     `json:"platform_version"`
	Kernel       string     `json:"kernel"`
	Arch         string     `json:"arch"`
	CPUModel     string     `json:"cpu_model"`
	CPUCores     int        `json:"cpu_cores"`
	TotalRAM     uint64     `json:"total_ram"`
	TotalDisk    uint64     `json:"total_disk"`
	AgentVersion string     `json:"agent_version"`
	Disks        []DiskInfo `json:"disks"`
}

type MetricPayload struct {
	Timestamp      int64              `json:"timestamp"`
	CPUUsage       float64            `json:"cpu_usage"`
	CPUPerCore     []float64          `json:"cpu_per_core,omitempty"`
	RAMUsed        uint64             `json:"ram_used"`
	RAMTotal       uint64             `json:"ram_total"`
	RAMPercent     float64            `json:"ram_percent"`
	SwapUsed       uint64             `json:"swap_used"`
	SwapTotal      uint64             `json:"swap_total"`
	SwapPercent    float64            `json:"swap_percent"`
	DiskReadBytes  float64            `json:"disk_read_bytes_sec"`
	DiskWriteBytes float64            `json:"disk_write_bytes_sec"`
	NetRxBytesSec  float64            `json:"net_rx_bytes_sec"`
	NetTxBytesSec  float64            `json:"net_tx_bytes_sec"`
	CPUTemp        *float64           `json:"cpu_temp,omitempty"`
	Load1          *float64           `json:"load_1,omitempty"`
	Load5          *float64           `json:"load_5,omitempty"`
	Load15         *float64           `json:"load_15,omitempty"`
	Uptime         uint64             `json:"uptime"`
	Disks          []DiskInfo         `json:"disks"`
	SystemInfo     *SystemInfo        `json:"system_info,omitempty"`
}
