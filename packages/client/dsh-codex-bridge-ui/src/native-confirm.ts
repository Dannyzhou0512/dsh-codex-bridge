import { execFile } from 'node:child_process';
import { win32 } from 'node:path';
import type { SourceDraft } from './shared.js';

// Constant system helper, with proposal text carried only over stdin.
const promptScript = Buffer.from(`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$inputBytes = [Console]::ReadLine()
$message = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($inputBytes))
$answer = [System.Windows.Forms.MessageBox]::Show($message, 'DSH Codex Bridge', 'YesNo', 'Warning', 'Button2', 'DefaultDesktopOnly')
if ($answer -eq 'Yes') { [Console]::Write('approved') }
`, 'utf16le').toString('base64');

export type SetupApproval = (action: 'test' | 'save' | 'enable-writes', paths: SourceDraft, signal: AbortSignal) => Promise<boolean>;

export function nativeSetupAvailable(): boolean {
  return process.platform === 'win32' && /^[a-z]:[\\/]/i.test(process.env.SystemRoot ?? '');
}

export const approveInWindows: SetupApproval = (action, paths, signal) => {
  if (!nativeSetupAvailable() || signal.aborted) return Promise.resolve(false);
  const systemPowerShell = win32.join(process.env.SystemRoot!, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const zh = Intl.DateTimeFormat().resolvedOptions().locale.startsWith('zh');
  const prompts = {
    test: zh ? '启动以下 Codex 程序并检查其公开历史？' : 'Start this Codex executable with app-server and check its public history?',
    save: zh ? '把这个 Codex 来源保存到当前 DSH profile，并保持导入写入关闭？' : 'Save this Codex source to the active DSH profile with import writes disabled?',
    'enable-writes': zh ? '允许将已审核的 Codex 会话写入当前 DSH profile？' : 'Allow reviewed imports from this Codex source into the active DSH profile?',
  };
  const message = [prompts[action], '', `${zh ? '程序' : 'Executable'}: ${paths.executable}`,
    `${zh ? '历史目录' : 'History directory'}: ${paths.codexHome}`, `${zh ? '启动目录' : 'Startup directory'}: ${paths.cwd}`].join('\n');
  return new Promise<boolean>(resolve => {
    const child = execFile(systemPowerShell,
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', promptScript],
      { signal, timeout: 90000, maxBuffer: 4096, windowsHide: true, shell: false },
      (error, stdout) => resolve(!error && stdout === 'approved'));
    child.stdin?.on('error', () => {});
    child.stdin?.end(Buffer.from(message, 'utf8').toString('base64') + '\n');
  });
};
