import { Cpu, MemoryStick, HardDrive } from 'lucide-react';
import { useComputerStore } from '@/stores/agentStore';

/** Format bytes to a human-readable string (e.g. "384 MB", "1.2 GB") */
function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** Thin progress bar with color based on usage percentage */
function UsageBar({ percent, className }: { percent: number; className?: string }) {
  const clamped = Math.min(100, Math.max(0, percent));
  // Color transitions: green → yellow → red
  const color =
    clamped < 60
      ? 'bg-emerald-400/80'
      : clamped < 85
        ? 'bg-amber-400/80'
        : 'bg-red-400/80';

  return (
    <div className={`h-1.5 rounded-full bg-white/10 dark:bg-white/5 overflow-hidden ${className || ''}`}>
      <div
        className={`h-full rounded-full transition-all duration-700 ease-out ${color}`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

/** A single stat row: icon + label + value + bar */
function StatRow({
  icon,
  label,
  value,
  percent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  percent: number;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-white/40 dark:text-white/30">{icon}</span>
          <span className="text-[11px] font-medium text-black/50 dark:text-white/40 uppercase tracking-wider">
            {label}
          </span>
        </div>
        <span className="text-[11px] font-mono text-black/70 dark:text-white/70 tabular-nums">
          {value}
        </span>
      </div>
      <UsageBar percent={percent} />
    </div>
  );
}

export function SystemStatsWidget() {
  const systemStats = useComputerStore((s) => s.systemStats);

  if (!systemStats) return null;

  const { cpuPercent, cpuCount, memUsedBytes, memTotalBytes, diskUsedBytes, diskTotalBytes } =
    systemStats;

  const memPercent = memTotalBytes > 0 ? (memUsedBytes / memTotalBytes) * 100 : 0;
  const diskPercent = diskTotalBytes > 0 ? (diskUsedBytes / diskTotalBytes) * 100 : 0;

  return (
    <div
      className="w-[200px] rounded-xl overflow-hidden select-none pointer-events-auto
                 bg-white/40 dark:bg-black/50 backdrop-blur-2xl
                 border border-black/[0.08] dark:border-white/[0.12]
                 shadow-lg shadow-black/5 dark:shadow-black/40"
    >
      {/* Header */}
      <div className="px-3 pt-2.5 pb-1.5">
        <span className="text-[10px] font-semibold text-black/40 dark:text-white/30 uppercase tracking-widest">
          System
        </span>
      </div>

      {/* Stats */}
      <div className="px-3 pb-3 space-y-2.5">
        <StatRow
          icon={<Cpu className="w-3 h-3" />}
          label="CPU"
          value={`${cpuPercent.toFixed(0)}%  ·  ${cpuCount} vCPU`}
          percent={cpuPercent}
        />

        <StatRow
          icon={<MemoryStick className="w-3 h-3" />}
          label="RAM"
          value={`${formatBytes(memUsedBytes)} / ${formatBytes(memTotalBytes)}`}
          percent={memPercent}
        />

        <StatRow
          icon={<HardDrive className="w-3 h-3" />}
          label="Disk"
          value={`${formatBytes(diskUsedBytes)} / ${formatBytes(diskTotalBytes)}`}
          percent={diskPercent}
        />
      </div>
    </div>
  );
}
