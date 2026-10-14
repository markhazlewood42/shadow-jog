# The tray app of the Shadow Jog Command Center (Windows PowerShell 5.1, System.Windows.Forms; no other dependency).
# Start it with a desktop shortcut (README.md, "The local reporter (step 5)"). It shows one icon in the notification area and starts two hidden services:
#   1. the reporter: `node reporter-launch.mjs --manual` (the launcher with the pinned copy, the lock and the protection check; no idle exit),
#   2. the local Command Center on port 3009 (from the pinned copy, with the docs of the real checkout), after `reporter-launch.mjs --prepare-local`.
# The icon is green when both ports answer, amber when one does, gray when none does. A right click opens the menu.
#
# Rules of this file:
#   - It keeps the process ids of its children (and their logs) in `.cc-reporter/` and stops them by those ids only. Never by name or by port.
#   - Every child (and every process that a child starts) lives in a Windows job object with KILL_ON_JOB_CLOSE. If this tray dies without Quit
#     (a crash, End task in Task Manager), the system ends the whole job, so the reporter and the local server never run on without a tray.
#   - Quit and Restart always run `reporter-launch.mjs --stop` (the verified stop of the design; it also stops a reporter that an older tray or
#     the hook left), then end the process trees of the kept ids, then end the job. The wait runs on a timer: the icon and the menu stay alive.
#   - A child that ends by itself gives a balloon tip and changes the icon. Nothing is restarted in a loop. "Restart services" is the way to try again.
#   - The settings file `~/.shadow-jog-cc/upstash.env` is read only for the key CC_HOSTED_URL, on a click. Its content is never logged.
#   - A named mutex keeps one tray at a time.
# ASCII only: Windows PowerShell 5.1 reads a file without a byte order mark as the system code page.

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
[System.Windows.Forms.Application]::SetUnhandledExceptionMode([System.Windows.Forms.UnhandledExceptionMode]::CatchException)

$ReporterPort = 29417
$LocalPort = 3009
$PollMs = 3000
$MutexName = 'Local\ShadowJogCommandCenterTray'

# ---- the paths ----

$ScriptDir = $PSScriptRoot
$AppDir = Split-Path $ScriptDir -Parent
$RepoDir = Split-Path (Split-Path $AppDir -Parent) -Parent
$LauncherJs = Join-Path $ScriptDir 'reporter-launch.mjs'

# The main checkout owns `.cc-reporter/`. In the pinned copy (`<main>/.cc-reporter/pinned`) it is two folders up. In a normal checkout or worktree, ask git.
$MainCheckout = $RepoDir
if (((Split-Path $RepoDir -Leaf) -eq 'pinned') -and ((Split-Path (Split-Path $RepoDir -Parent) -Leaf) -eq '.cc-reporter')) {
    $MainCheckout = Split-Path (Split-Path $RepoDir -Parent) -Parent
} else {
    try {
        $listed = & git -C $RepoDir worktree list --porcelain 2>$null | Where-Object { $_ -like 'worktree *' } | Select-Object -First 1
        if ($listed) { $MainCheckout = ([string]$listed).Substring('worktree '.Length).Trim() }
    } catch { }
}
$StateDir = Join-Path $MainCheckout '.cc-reporter'
$PinnedApp = Join-Path $StateDir 'pinned\tools\command-center'
$ReadyMarker = Join-Path $StateDir 'pinned\.cc-ready'
$ReporterLog = Join-Path $StateDir 'reporter.log'
$TrayLog = Join-Path $StateDir 'tray.log'
$LocalLog = Join-Path $StateDir 'local-server.out.log'
$LocalErrLog = Join-Path $StateDir 'local-server.err.log'
$PidFile = Join-Path $StateDir 'tray.pids.json'
$LocalConfig = Join-Path $StateDir 'local.config.json'
New-Item -ItemType Directory -Force -Path $StateDir | Out-Null

function Write-TrayLog([string]$Message) {
    try {
        if ((Test-Path $TrayLog) -and ((Get-Item $TrayLog).Length -gt 1000000)) { Move-Item -Force $TrayLog "$TrayLog.old" }
        Add-Content -Path $TrayLog -Value ("{0} tray: {1}" -f (Get-Date).ToString('o'), $Message)
    } catch { }
}

# ---- one tray at a time ----

$createdMutex = $false
$Mutex = New-Object System.Threading.Mutex($true, $MutexName, [ref]$createdMutex)
if (-not $createdMutex) {
    $other = New-Object System.Windows.Forms.NotifyIcon
    $other.Icon = [System.Drawing.SystemIcons]::Information
    $other.Visible = $true
    $other.ShowBalloonTip(4000, 'Shadow Jog Command Center', 'It already runs. Look for its icon in the notification area.', [System.Windows.Forms.ToolTipIcon]::Info)
    $until = (Get-Date).AddSeconds(5)
    while ((Get-Date) -lt $until) { [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 100 }
    $other.Visible = $false
    $other.Dispose()
    exit 0
}

# ---- the job object ----
# A job with KILL_ON_JOB_CLOSE: when the last handle of the job closes (this process ends, in any way), the system ends every process in the job.
# A process that is not started with CREATE_BREAKAWAY_FROM_JOB stays in the job with all of its children. Node's spawn does not ask for a breakaway
# (reporter-launch.mjs starts its server with spawn and no `detached`), so the server and `npm ci` stay in the job too.
# JOBOBJECT BEGIN
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace ShadowJog {
    public static class ChildJob {
        [StructLayout(LayoutKind.Sequential)]
        private struct BasicLimits {
            public long PerProcessUserTimeLimit;
            public long PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize;
            public UIntPtr MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass;
            public uint SchedulingClass;
        }
        [StructLayout(LayoutKind.Sequential)]
        private struct IoCounters {
            public ulong ReadOperationCount;
            public ulong WriteOperationCount;
            public ulong OtherOperationCount;
            public ulong ReadTransferCount;
            public ulong WriteTransferCount;
            public ulong OtherTransferCount;
        }
        [StructLayout(LayoutKind.Sequential)]
        private struct ExtendedLimits {
            public BasicLimits Basic;
            public IoCounters Io;
            public UIntPtr ProcessMemoryLimit;
            public UIntPtr JobMemoryLimit;
            public UIntPtr PeakProcessMemoryUsed;
            public UIntPtr PeakJobMemoryUsed;
        }
        private const int ExtendedLimitInformation = 9;
        private const uint KillOnJobClose = 0x2000;

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr CreateJobObject(IntPtr attributes, string name);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint length);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool TerminateJobObject(IntPtr job, uint exitCode);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool CloseHandle(IntPtr handle);

        public static IntPtr Create() {
            IntPtr job = CreateJobObject(IntPtr.Zero, null);
            if (job == IntPtr.Zero) throw new InvalidOperationException("CreateJobObject failed: " + Marshal.GetLastWin32Error());
            ExtendedLimits limits = new ExtendedLimits();
            limits.Basic.LimitFlags = KillOnJobClose;
            int size = Marshal.SizeOf(typeof(ExtendedLimits));
            IntPtr buffer = Marshal.AllocHGlobal(size);
            try {
                Marshal.StructureToPtr(limits, buffer, false);
                if (!SetInformationJobObject(job, ExtendedLimitInformation, buffer, (uint)size)) {
                    int error = Marshal.GetLastWin32Error();
                    CloseHandle(job);
                    throw new InvalidOperationException("SetInformationJobObject failed: " + error);
                }
            } finally {
                Marshal.FreeHGlobal(buffer);
            }
            return job;
        }
        public static void Add(IntPtr job, IntPtr process) {
            if (!AssignProcessToJobObject(job, process)) throw new InvalidOperationException("AssignProcessToJobObject failed: " + Marshal.GetLastWin32Error());
        }
        public static void Terminate(IntPtr job) { TerminateJobObject(job, 1); }
        public static void Close(IntPtr job) { CloseHandle(job); }
    }
}
'@
# JOBOBJECT END

$script:Job = [System.IntPtr]::Zero
$script:JobWarned = $false

# A fresh job. The old one (if any) is ended first: its processes die with it.
function Reset-Job {
    if ($script:Job -ne [System.IntPtr]::Zero) {
        [ShadowJog.ChildJob]::Terminate($script:Job)
        [ShadowJog.ChildJob]::Close($script:Job)
        $script:Job = [System.IntPtr]::Zero
    }
    try {
        $script:Job = [ShadowJog.ChildJob]::Create()
    } catch {
        Write-TrayLog ("no job object: {0}" -f $_.Exception.Message)
    }
}

# ---- the icons ----

Add-Type -Namespace ShadowJog -Name NativeIcon -MemberDefinition '[System.Runtime.InteropServices.DllImport("user32.dll", SetLastError = true)] public static extern bool DestroyIcon(System.IntPtr handle);'

function New-StateIcon([System.Drawing.Color]$Color) {
    $bitmap = New-Object System.Drawing.Bitmap 16, 16
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $brush = New-Object System.Drawing.SolidBrush $Color
    $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(70, 70, 70)), 1
    $graphics.FillEllipse($brush, 1, 1, 13, 13)
    $graphics.DrawEllipse($pen, 1, 1, 13, 13)
    $handle = $bitmap.GetHicon()
    $icon = [System.Drawing.Icon]::FromHandle($handle).Clone()
    [ShadowJog.NativeIcon]::DestroyIcon($handle) | Out-Null
    $pen.Dispose(); $brush.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
    return $icon
}

$Icons = @{
    running = New-StateIcon ([System.Drawing.Color]::FromArgb(46, 158, 79))
    partial = New-StateIcon ([System.Drawing.Color]::FromArgb(240, 160, 32))
    stopped = New-StateIcon ([System.Drawing.Color]::FromArgb(128, 128, 128))
}

# ---- node ----

$Node = $null
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if ($nodeCommand) { $Node = $nodeCommand.Source }

# ---- the children ----
# A child is a hashtable: Name, Proc (a Process, or $null) and Reported (true once a balloon tip was shown for its end).
# Holding the Process object keeps its handle open, so the process id cannot be given to another program while we use it.

$script:Launcher = $null
$script:Prepare = $null
$script:Server = $null
$script:Phase = 'idle'          # idle, waitCopy, preparing, serving, failed
$script:Stopping = $false
$script:LastState = ''

function Test-Port([int]$Port) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $pending = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
        if ($pending.AsyncWaitHandle.WaitOne(250)) {
            $client.EndConnect($pending)
            return $true
        }
        return $false
    } catch {
        return $false
    } finally {
        $client.Close()
    }
}

function Start-Child([string]$Name, [string]$Arguments, [string]$WorkDir, [string]$OutFile, [string]$ErrFile) {
    $process = Start-Process -FilePath $Node -ArgumentList $Arguments -WorkingDirectory $WorkDir -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput $OutFile -RedirectStandardError $ErrFile
    $null = $process.Handle   # keeps the handle, so ExitCode can be read after the process ended
    Write-TrayLog ("started {0} (process {1})" -f $Name, $process.Id)
    # Into the job, so that the system ends it (and its children) if this tray dies. A process that starts a child in the first milliseconds, before
    # this call, would leave that child outside the job; node needs far longer than that to start.
    if ($script:Job -ne [System.IntPtr]::Zero) {
        try { [ShadowJog.ChildJob]::Add($script:Job, $process.Handle) } catch { Write-TrayLog ("{0} is not in the job: {1}" -f $Name, $_.Exception.Message); $script:JobWarned = $true }
    } else {
        $script:JobWarned = $true
    }
    return @{ Name = $Name; Proc = $process; Reported = $false }
}

function Test-Alive($Child) {
    return ($null -ne $Child) -and ($null -ne $Child.Proc) -and (-not $Child.Proc.HasExited)
}

function Save-Pids {
    $record = [ordered]@{ tray = $PID }
    foreach ($pair in @(@('launcher', $script:Launcher), @('prepare', $script:Prepare), @('server', $script:Server))) {
        if (Test-Alive $pair[1]) { $record[$pair[0]] = $pair[1].Proc.Id }
    }
    try { ($record | ConvertTo-Json -Compress) | Set-Content -Path $PidFile -Encoding ASCII } catch { }
}

# Ends a process and its children, by the id that this script kept. Never by name or by port. It does not wait: the stop timer waits.
function Stop-Tree($Child) {
    if (-not (Test-Alive $Child)) { return }
    $id = $Child.Proc.Id
    # taskkill writes to stderr when the process is already gone (exit code 128). Under 'Stop' that text would throw, so judge by the exit code.
    $ErrorActionPreference = 'Continue'
    try {
        & taskkill.exe /PID $id /T /F 2>&1 | Out-Null
        $code = $LASTEXITCODE
    } catch {
        $code = -1
    }
    if (($code -eq 0) -or ($code -eq 128)) {
        Write-TrayLog ("ended {0} (process {1}) and its tree (taskkill code {2})" -f $Child.Name, $id, $code)
    } else {
        Write-TrayLog ("could not end {0} (process {1}): taskkill code {2}" -f $Child.Name, $id, $code)
    }
}

function Start-Services {
    if (-not $Node) { throw 'node.exe was not found on the PATH.' }
    if ($script:Job -eq [System.IntPtr]::Zero) { Reset-Job }
    $env:CC_NO_OPEN = '1'
    if (Test-Port $ReporterPort) { Write-TrayLog ("port {0} answers before the start: a reporter that this tray did not start runs" -f $ReporterPort) }
    if (Test-Port $LocalPort) { Write-TrayLog ("port {0} answers before the start: a server that this tray did not start runs" -f $LocalPort) }
    $script:Launcher = Start-Child 'reporter launcher' ('"{0}" --repo "{1}" --manual' -f $LauncherJs, $MainCheckout) $AppDir (Join-Path $StateDir 'tray-launcher.out.log') (Join-Path $StateDir 'tray-launcher.err.log')
    $script:Prepare = $null
    $script:Server = $null
    $script:Phase = 'waitCopy'
    Save-Pids
    if ($script:JobWarned) {
        $script:JobWarned = $false
        Show-Balloon 'The services are not tied to this tray: if the tray is killed, they keep running. See the log.' ([System.Windows.Forms.ToolTipIcon]::Warning)
    }
}

# ---- the stop (Quit and Restart) ----
# It runs on a timer, so the icon and the menu stay alive while it waits. Stages:
#   cmd:  `reporter-launch.mjs --stop` runs ALWAYS (not only when this tray's own launcher is alive), so that a reporter from before (an older tray
#         that was killed, or the hook) is stopped too. It checks each process by id and start time in the lock and says "not running" otherwise.
#   dead: taskkill /T of the kept ids, then wait up to 5 s for them to end.
#   Then the job ends (any process that is still in it dies), the state is cleared, and the action that was asked for runs (start again, or exit).

$script:StopThen = $null
$script:StopStage = ''
$script:StopProc = $null
$script:StopDeadline = [DateTime]::MinValue

function Begin-Stop([scriptblock]$Then) {
    if ($script:Stopping) {
        $script:StopThen = $Then   # a second request while the stop runs (Quit after Quit, or Quit during Restart): the last action wins
        return
    }
    $script:Stopping = $true
    $script:StopThen = $Then
    $Timer.Stop()
    $Notify.Icon = $Icons.stopped
    $script:LastState = 'stopped'
    $Notify.Text = 'Shadow Jog CC: stopping...'
    $script:StopProc = $null
    try {
        if ($Node) {
            $script:StopProc = Start-Process -FilePath $Node -ArgumentList ('"{0}" --stop --repo "{1}"' -f $LauncherJs, $MainCheckout) -WindowStyle Hidden -PassThru `
                -RedirectStandardOutput (Join-Path $StateDir 'tray-stop.out.log') -RedirectStandardError (Join-Path $StateDir 'tray-stop.err.log')
        }
    } catch {
        Write-TrayLog ("could not run the stop command: {0}" -f $_.Exception.Message)
    }
    $script:StopStage = 'cmd'
    $script:StopDeadline = (Get-Date).AddSeconds(35)
    $StopTimer.Start()
}

function Step-Stop {
    if ($script:StopStage -eq 'cmd') {
        $finished = ($null -eq $script:StopProc) -or $script:StopProc.HasExited
        if ($finished -or ((Get-Date) -gt $script:StopDeadline)) {
            if (-not $finished) { Write-TrayLog 'the stop command took more than 35 seconds' }
            foreach ($child in @($script:Server, $script:Prepare, $script:Launcher)) { Stop-Tree $child }
            $script:StopStage = 'dead'
            $script:StopDeadline = (Get-Date).AddSeconds(5)
        }
        return
    }
    $alive = 0
    foreach ($child in @($script:Server, $script:Prepare, $script:Launcher)) { if (Test-Alive $child) { $alive++ } }
    if (($alive -eq 0) -or ((Get-Date) -gt $script:StopDeadline)) {
        if ($alive -gt 0) { Write-TrayLog ("{0} child process(es) did not end in 5 seconds; the job ends them" -f $alive) }
        Finish-Stop
    }
}

function Finish-Stop {
    $StopTimer.Stop()
    try { Reset-Job } catch { Write-TrayLog ("could not end the job: {0}" -f $_.Exception.Message) }
    $script:Launcher = $null
    $script:Prepare = $null
    $script:Server = $null
    $script:Phase = 'idle'
    $script:StopStage = ''
    $script:StopProc = $null
    $then = $script:StopThen
    $script:StopThen = $null
    $script:Stopping = $false
    Remove-Item -Path $PidFile -Force -ErrorAction SilentlyContinue
    if ($then) { & $then }
}

# ---- the icon and the menu ----

$Notify = New-Object System.Windows.Forms.NotifyIcon
$Notify.Icon = $Icons.stopped
$Notify.Text = 'Shadow Jog Command Center: starting'
$Notify.Visible = $true

function Show-Balloon([string]$Text, [System.Windows.Forms.ToolTipIcon]$Kind = [System.Windows.Forms.ToolTipIcon]::Info) {
    try { $Notify.ShowBalloonTip(6000, 'Shadow Jog Command Center', $Text, $Kind) } catch { }
}

function Open-Url([string]$Url) {
    try {
        Start-Process $Url
    } catch {
        Write-TrayLog ("could not open a page: {0}" -f $_.Exception.Message)
        Show-Balloon ("The page could not be opened: {0}" -f $_.Exception.Message) ([System.Windows.Forms.ToolTipIcon]::Error)
    }
}

# Reads only the key CC_HOSTED_URL. The other lines (the token) are never kept, shown or logged.
function Get-HostedUrl {
    $file = Join-Path $HOME '.shadow-jog-cc\upstash.env'
    if (-not (Test-Path $file)) { return $null }
    foreach ($line in [System.IO.File]::ReadAllLines($file)) {
        # The key is matched case-sensitively. A repeated key with an invalid value is skipped; the first valid one wins.
        if ($line -cmatch '^\s*CC_HOSTED_URL\s*=\s*(.+?)\s*$') {
            $value = $Matches[1].Trim('"').Trim("'")
            if ($value -match '^https://\S+$') { return $value }
        }
    }
    return $null
}

$Menu = New-Object System.Windows.Forms.ContextMenuStrip
$ItemOpen = $Menu.Items.Add('Open Command Center')
$ItemHosted = $Menu.Items.Add('Open hosted page')
$ItemLog = $Menu.Items.Add('Show log')
[void]$Menu.Items.Add('-')
$ItemRestart = $Menu.Items.Add('Restart services')
$ItemQuit = $Menu.Items.Add('Quit')
$Notify.ContextMenuStrip = $Menu

$ItemOpen.Add_Click({ Open-Url "http://localhost:$LocalPort" })
$Notify.Add_DoubleClick({ Open-Url "http://localhost:$LocalPort" })
$ItemHosted.Add_Click({
    $url = Get-HostedUrl
    if ($url) {
        Open-Url $url
    } else {
        Show-Balloon 'CC_HOSTED_URL is not set in ~/.shadow-jog-cc/upstash.env, or it is not an https address.' ([System.Windows.Forms.ToolTipIcon]::Warning)
    }
})
$ItemLog.Add_Click({
    $opened = 0
    foreach ($file in @($ReporterLog, $TrayLog, $LocalLog, $LocalErrLog)) {
        if (Test-Path $file) {
            try {
                Start-Process -FilePath 'notepad.exe' -ArgumentList ('"{0}"' -f $file)
                $opened++
            } catch {
                Write-TrayLog ("could not open a log in Notepad: {0}" -f $_.Exception.Message)
                Show-Balloon ("Notepad could not open a log file: {0}" -f $_.Exception.Message) ([System.Windows.Forms.ToolTipIcon]::Error)
            }
        }
    }
    if ($opened -eq 0) { Show-Balloon 'There is no log file yet.' ([System.Windows.Forms.ToolTipIcon]::Warning) }
})

$Context = New-Object System.Windows.Forms.ApplicationContext

# The two timers are made here, before the functions that use them. $Timer polls the ports. $StopTimer drives the stop (Begin-Stop, Step-Stop).
# The tick handlers call functions that are defined further down; they are looked up when a tick happens, not now.
$script:LastPollBalloon = [DateTime]::MinValue
$Timer = New-Object System.Windows.Forms.Timer
$Timer.Interval = $PollMs
$Timer.Add_Tick({
    try {
        Update-Tray
    } catch {
        Write-TrayLog ("poll failed: {0}" -f $_.Exception.Message)
        # One balloon tip each 10 minutes at most, so a poll that fails every 3 seconds does not flood the screen.
        if (((Get-Date) - $script:LastPollBalloon).TotalMinutes -ge 10) {
            $script:LastPollBalloon = Get-Date
            Show-Balloon ("The status check failed: {0}. See the log." -f $_.Exception.Message) ([System.Windows.Forms.ToolTipIcon]::Error)
        }
    }
})
$StopTimer = New-Object System.Windows.Forms.Timer
$StopTimer.Interval = 250
$StopTimer.Add_Tick({
    try {
        Step-Stop
    } catch {
        Write-TrayLog ("stop step failed: {0}" -f $_.Exception.Message)
        try { Finish-Stop } catch { Write-TrayLog ("stop could not finish: {0}" -f $_.Exception.Message); Exit-Tray }
    }
})

# Quit: the stop runs on the stop timer (the icon says "stopping"), and the tray exits only when the children have ended.
function Exit-Tray {
    $Timer.Dispose()
    $StopTimer.Dispose()
    $Notify.Visible = $false
    $Notify.Dispose()
    try { $Mutex.ReleaseMutex() } catch { }
    $Context.ExitThread()
}

function Close-Tray {
    try {
        Begin-Stop { Exit-Tray }
    } catch {
        Write-TrayLog ("stop failed: {0}" -f $_.Exception.Message)
        Exit-Tray
    }
}

$ItemQuit.Add_Click({ Close-Tray })
$ItemRestart.Add_Click({
    if ($script:Stopping) { return }
    try {
        Begin-Stop {
            try {
                Start-Services
            } catch {
                Write-TrayLog ("restart failed: {0}" -f $_.Exception.Message)
                Show-Balloon ("The services could not start: {0}" -f $_.Exception.Message) ([System.Windows.Forms.ToolTipIcon]::Error)
            } finally {
                $Timer.Start()
            }
        }
    } catch {
        Write-TrayLog ("restart failed: {0}" -f $_.Exception.Message)
        Show-Balloon ("The services could not restart: {0}" -f $_.Exception.Message) ([System.Windows.Forms.ToolTipIcon]::Error)
        $script:Stopping = $false
        $Timer.Start()
    }
})

# ---- the poll ----

# One balloon tip per child that ended by itself. The child is not started again.
function Report-End($Child, [string]$Label, [bool]$PortUp) {
    if ($null -eq $Child -or $Child.Reported -or $null -eq $Child.Proc -or -not $Child.Proc.HasExited) { return }
    $Child.Reported = $true
    $code = $Child.Proc.ExitCode
    Write-TrayLog ("{0} ended by itself with code {1}" -f $Label, $code)
    if ($code -eq 0 -and $PortUp) {
        # The port answers, but the answering copy is not one of this tray's children: it may be a leftover (an older tray that was killed) or the hook's.
        Show-Balloon ("{0}: a copy that this tray did not start already runs, so this one ended. Use Restart services to stop that copy and start a new one." -f $Label) ([System.Windows.Forms.ToolTipIcon]::Warning)
    } elseif ($code -eq 4) {
        Show-Balloon ("{0} ended: there is no settings file (~/.shadow-jog-cc/upstash.env). See the log." -f $Label) ([System.Windows.Forms.ToolTipIcon]::Warning)
    } else {
        Show-Balloon ("{0} ended by itself (code {1}). Use Restart services to try again. See the log." -f $Label, $code) ([System.Windows.Forms.ToolTipIcon]::Error)
    }
}

function Update-Tray {
    if ($script:Stopping) { return }
    $reporterUp = Test-Port $ReporterPort
    $localUp = Test-Port $LocalPort

    # The local server starts when the pinned copy is ready: prepare (config and page build), then serve.
    if ($script:Phase -eq 'waitCopy') {
        if (Test-Path $ReadyMarker) {
            $script:Prepare = Start-Child 'local prepare' ('"{0}" --repo "{1}" --prepare-local' -f $LauncherJs, $MainCheckout) $AppDir (Join-Path $StateDir 'tray-prepare.out.log') (Join-Path $StateDir 'tray-prepare.err.log')
            $script:Phase = 'preparing'
            Save-Pids
        } elseif ($script:Launcher -and $script:Launcher.Proc.HasExited) {
            $script:Phase = 'failed'   # the launcher ended before the copy was ready; Report-End below says why
        }
    } elseif ($script:Phase -eq 'preparing' -and $script:Prepare.Proc.HasExited) {
        if ($script:Prepare.Proc.ExitCode -eq 0) {
            if ($localUp) {
                Write-TrayLog ("port {0} is in use by a program that this tray did not start; the local server was not started" -f $LocalPort)
                Show-Balloon ("Port {0} is used by a program that this tray did not start (maybe a server left after a crash). End it in Task Manager, then use Restart services." -f $LocalPort) ([System.Windows.Forms.ToolTipIcon]::Warning)
                $script:Phase = 'failed'
            } else {
                $script:Server = Start-Child 'local server' ('--import tsx src/server/main.ts --config "{0}"' -f $LocalConfig) $PinnedApp $LocalLog $LocalErrLog
                $script:Phase = 'serving'
                Save-Pids
            }
        } else {
            Write-TrayLog ("prepare ended with code {0}" -f $script:Prepare.Proc.ExitCode)
            Show-Balloon ("The local server could not be prepared (code {0}). See the log." -f $script:Prepare.Proc.ExitCode) ([System.Windows.Forms.ToolTipIcon]::Error)
            $script:Phase = 'failed'
        }
    }

    Report-End $script:Launcher 'The reporter' $reporterUp
    Report-End $script:Server 'The local server' $localUp

    if ($reporterUp -and $localUp) { $state = 'running' } elseif ($reporterUp -or $localUp) { $state = 'partial' } else { $state = 'stopped' }
    $text = 'Shadow Jog CC: reporter {0}, local {1}' -f $(if ($reporterUp) { 'up' } else { 'down' }), $(if ($localUp) { 'up' } else { 'down' })
    if (($script:Phase -eq 'waitCopy') -or ($script:Phase -eq 'preparing')) { $text += ' (starting)' }
    if ($text.Length -gt 63) { $text = $text.Substring(0, 63 - 3) + '...' }   # NotifyIcon.Text: 63 characters at most
    if ($state -ne $script:LastState) { $Notify.Icon = $Icons[$state]; $script:LastState = $state }
    $Notify.Text = $text
}

# ---- run ----

Reset-Job   # if this fails, Start-Services warns with a balloon tip

try {
    Start-Services
} catch {
    Write-TrayLog ("start failed: {0}" -f $_.Exception.Message)
    Show-Balloon ("The services could not start: {0}" -f $_.Exception.Message) ([System.Windows.Forms.ToolTipIcon]::Error)
}
$Timer.Start()
try {
    [System.Windows.Forms.Application]::Run($Context)
} finally {
    $Timer.Dispose()
    try { $Notify.Visible = $false; $Notify.Dispose() } catch { }
}
