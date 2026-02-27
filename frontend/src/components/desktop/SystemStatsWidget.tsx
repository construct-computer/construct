import { useComputerStore } from '@/stores/agentStore';

/** Format bytes to human-readable with binary units */
function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KiB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MiB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GiB`;
}

/** Format bytes/sec to readable speed */
function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec < 1) return '0 B/s';
  if (bytesPerSec < 1024) return `${bytesPerSec.toFixed(0)} B/s`;
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
}

/** Format seconds to "Xh Ym Zs" */
function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** Thin Conky-style progress bar */
function Bar({ percent }: { percent: number }) {
  const clamped = Math.min(100, Math.max(0, percent));
  const color =
    clamped < 60
      ? 'rgba(74, 222, 128, 0.6)'
      : clamped < 85
        ? 'rgba(251, 191, 36, 0.6)'
        : 'rgba(248, 113, 113, 0.6)';

  return (
    <div
      className="h-[3px] rounded-sm overflow-hidden mt-0.5 mb-1"
      style={{ backgroundColor: 'rgba(255,255,255,0.1)', boxShadow: '0 0 3px rgba(0,0,0,0.2)' }}
    >
      <div
        className="h-full rounded-sm transition-all duration-700 ease-out"
        style={{ width: `${clamped}%`, backgroundColor: color }}
      />
    </div>
  );
}

/** Horizontal divider */
function Divider() {
  return (
    <div
      className="h-px my-1.5"
      style={{ backgroundColor: 'rgba(255,255,255,0.1)', boxShadow: '0 0 2px rgba(0,0,0,0.15)' }}
    />
  );
}

// Dark outline halo — keeps text readable on any wallpaper (light or dark)
const textShadow = [
  '0 0 4px rgba(0,0,0,0.4)',
  '0 0 8px rgba(0,0,0,0.2)',
  '0 1px 2px rgba(0,0,0,0.5)',
].join(', ');

export function SystemStatsWidget() {
  const systemStats = useComputerStore((s) => s.systemStats);

  if (!systemStats) return null;

  const {
    cpuPercent, cpuCount, memUsedBytes, memTotalBytes,
    pids, netInSpeed, netOutSpeed, uptime,
  } = systemStats;

  const memPercent = memTotalBytes > 0 ? (memUsedBytes / memTotalBytes) * 100 : 0;

  return (
    <div
      className="w-[220px] select-none pointer-events-auto font-mono text-[10px] leading-[1.7]"
      style={{ textShadow }}
    >
      {/* Header */}
      <div className="flex justify-between items-baseline">
        <span className="text-[9px] text-white/60 font-bold uppercase tracking-[0.15em]">
          System
        </span>
        <span className="text-[9px] text-white/35 tracking-wide">construct</span>
      </div>

      <Divider />

      {/* Uptime */}
      <div className="flex justify-between">
        <span className="text-white/55">Uptime:</span>
        <span className="text-white/80 tabular-nums">{formatUptime(uptime)}</span>
      </div>

      <Divider />

      {/* CPU */}
      <div className="flex justify-between">
        <span className="text-white/55">CPU Usage:</span>
        <span className="text-white/80">
          <span className="text-white font-semibold tabular-nums">
            {cpuPercent.toFixed(0)}%
          </span>
          <span className="text-white/30 mx-0.5">&middot;</span>
          <span className="tabular-nums">{cpuCount} vCPU</span>
        </span>
      </div>
      <Bar percent={cpuPercent} />

      {/* RAM */}
      <div className="flex justify-between">
        <span className="text-white/55">RAM:</span>
        <span className="text-white/80 tabular-nums">
          <span className="text-white font-semibold">{formatBytes(memUsedBytes)}</span>
          <span className="text-white/40">/{formatBytes(memTotalBytes)}</span>
          <span className="text-white/45 ml-1">{memPercent.toFixed(0)}%</span>
        </span>
      </div>
      <Bar percent={memPercent} />

      {/* Processes */}
      <div className="flex justify-between">
        <span className="text-white/55">Processes:</span>
        <span className="text-white/80 tabular-nums font-semibold">{pids}</span>
      </div>

      <Divider />

      {/* Network */}
      <div className="flex justify-between">
        <span className="text-white/55">Net:</span>
        <span className="text-white/65 tabular-nums">
          <span className="text-emerald-400/70">&#8593;</span>
          <span className="ml-0.5">{formatSpeed(netOutSpeed)}</span>
          <span className="text-white/20 mx-1">&middot;</span>
          <span className="text-sky-400/70">&#8595;</span>
          <span className="ml-0.5">{formatSpeed(netInSpeed)}</span>
        </span>
      </div>
    </div>
  );
}
