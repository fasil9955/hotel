import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { HttpError } from "./http.js";

const execFileAsync = promisify(execFile);

export async function installStartup(projectRoot: string): Promise<string> {
  if (process.platform !== "win32") {
    throw new HttpError("Start with Windows is only available on the hotel PC.", 400);
  }
  const bat = path.join(projectRoot, "start-hotel.bat");
  const command = `
$startup = [Environment]::GetFolderPath('Startup')
$shortcut = Join-Path $startup 'Hotel billing.lnk'
$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut($shortcut)
$link.TargetPath = ${psQuote(bat)}
$link.WorkingDirectory = ${psQuote(projectRoot)}
$link.WindowStyle = 7
$link.Save()
Write-Output $shortcut
`;
  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", command]);
    return stdout.trim();
  } catch {
    throw new HttpError("Could not add Hotel billing to Windows startup.", 500);
  }
}

function psQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
