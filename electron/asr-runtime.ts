import * as os from 'os';

import { Settings } from './types';

export type ProviderName = 'cpu' | 'coreml' | 'cuda' | 'directml';

// 识别线程数上限：旧值 6 对现在的多核本（如骁龙 X Elite 12 核、酷睿 H 系列）偏保守。
// 放宽到 8——推理吞吐仍有收益，再高则同步开销上升且会抢占前台响应。
export function getDefaultNumThreads(cpuCount: number = os.cpus().length): number {
  return Math.max(1, Math.min(cpuCount, 8));
}

export interface RuntimeArchInfo {
  /** 当前进程架构（打包时决定）。 */
  processArch: string;
  /** 是否为 x64 程序跑在 ARM64 机器上（Windows 模拟层）——性能会明显下降。 */
  emulated: boolean;
  archLabel: string;
}

// ARM 芯片特征串（模拟层下 process.arch 仍报 x64，只能从 CPU 型号识别真实硬件）。
const ARM_CPU_HINT_RE = /snapdragon|qualcomm|oryon|armv8|armv9|\barm\b/i;

export function getRuntimeArchInfo(
  processArch: string = process.arch,
  cpuModel = '',
  processorIdentifier: string = process.env.PROCESSOR_IDENTIFIER ?? ''
): RuntimeArchInfo {
  const hostLooksArm = ARM_CPU_HINT_RE.test(`${cpuModel} ${processorIdentifier}`);
  const emulated = processArch === 'x64' && hostLooksArm;

  if (processArch === 'arm64') {
    return { processArch, emulated: false, archLabel: 'ARM64 原生' };
  }
  if (emulated) {
    return { processArch, emulated: true, archLabel: 'x64（运行在 ARM64 设备的模拟层上）' };
  }
  return { processArch, emulated: false, archLabel: `${processArch} 原生` };
}

export function getProviderCandidates(
  computeBackend: Settings['compute_backend'],
  platform: NodeJS.Platform = process.platform
): ProviderName[] {
  const gpuCandidates: ProviderName[] =
    platform === 'darwin'
      ? ['coreml']
      : platform === 'win32'
        ? ['cuda', 'directml']
        : [];

  if (computeBackend === 'cpu') {
    return ['cpu'];
  }

  if (computeBackend === 'gpu') {
    return gpuCandidates;
  }

  return [...gpuCandidates, 'cpu'];
}
