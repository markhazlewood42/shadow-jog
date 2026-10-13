# The tray app of the Shadow Jog Command Center (Windows PowerShell 5.1, System.Windows.Forms; no other dependency).
# Start it with a desktop shortcut (README.md, "The local reporter (step 5)"). It shows one icon in the notification area and starts two hidden services:
#   1. the reporter: `node reporter-launch.mjs --manual` (the launcher with the pinned copy, the lock and the protection check; no idle exit),
#   2. the local Command Center on port 3009 (from the pinned copy, with the docs of the real checkout), after `reporter-launch.mjs --prepare-local`.
# The icon is green when both ports answer, amber when one does, gray when none does. A right click opens the menu.
#
# Rules of this file:
#   - It keeps the process ids of its children (and their logs) in `.cc-reporter/` and stops them by those ids only. Never by name.
#   - Quit runs `reporter-launch.mjs --stop` (the verified stop of the design), then ends the process trees of the kept ids as a backstop.
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

# Ends a process and its children, by the id that this script kept. Never by name.
function Stop-Tree($Child) {
    if (-not (Test-Alive $Child)) { return }
    $id = $Child.Proc.Id
    try {
        & taskkill.exe /PID $id /T /F 2>&1 | Out-Null
        $null = $Child.Proc.WaitForExit(5000)
        Write-TrayLog ("ended {0} (process {1}) and its tree" -f $Child.Name, $id)
    } catch {
        Write-TrayLog ("could not end {0} (process {1}): {2}" -f $Child.Name, $id, $_.Exception.Message)
    }
}

function Start-Services {
    if (-not $Node) { throw 'node.exe was not found on the PATH.' }
    $env:CC_NO_OPEN = '1'
    $script:Launcher = Start-Child 'reporter launcher' ('"{0}" --repo "{1}" --manual' -f $LauncherJs, $MainCheckout) $AppDir (Join-Path $StateDir 'tray-launcher.out.log') (Join-Path $StateDir 'tray-launcher.err.log')
    $script:Prepare = $null
    $script:Server = $null
    $script:Phase = 'waitCopy'
    Save-Pids
}

function Stop-Services {
    $script:Stopping = $true
    try {
        # The design's own stop first: it checks each process (id and start time in the lock) and removes the live key.
        if (Test-Alive $script:Launcher) {
            $stop = Start-Process -FilePath $Node -ArgumentList ('"{0}" --stop --repo "{1}"' -f $LauncherJs, $MainCheckout) -WindowStyle Hidden -PassThru `
                -RedirectStandardOutput (Join-Path $StateDir 'tray-stop.out.log') -RedirectStandardError (Join-Path $StateDir 'tray-stop.err.log')
            if (-not $stop.WaitForExit(35000)) { Write-TrayLog 'the stop command took more than 35 seconds' }
        }
        # The backstop: the kept ids only.
        Stop-Tree $script:Server
        Stop-Tree $script:Prepare
        Stop-Tree $script:Launcher
    } finally {
        $script:Launcher = $null
        $script:Prepare = $null
        $script:Server = $null
        $script:Phase = 'idle'
        $script:Stopping = $false
        Remove-Item -Path $PidFile -Force -ErrorAction SilentlyContinue
    }
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
    try { Start-Process $Url } catch { Write-TrayLog ("could not open a page: {0}" -f $_.Exception.Message) }
}

# Reads only the key CC_HOSTED_URL. The other lines (the token) are never kept, shown or logged.
function Get-HostedUrl {
    $file = Join-Path $HOME '.shadow-jog-cc\upstash.env'
    if (-not (Test-Path $file)) { return $null }
    foreach ($line in [System.IO.File]::ReadAllLines($file)) {
        if ($line -match '^\s*CC_HOSTED_URL\s*=\s*(.+?)\s*$') {
            $value = $Matches[1].Trim('"').Trim("'")
            if ($value -match '^https://\S+$') { return $value }
            return $null
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
    if ($url) { Open-Url $url } else { Show-Balloon 'CC_HOSTED_URL is not set in ~/.shadow-jog-cc/upstash.env, or it is not an https address.' ([System.Windows.Forms.ToolTipIcon]::Warning) }
})
$ItemLog.Add_Click({
    foreach ($file in @($ReporterLog, $TrayLog, $LocalLog, $LocalErrLog)) {
        if (Test-Path $file) { try { Start-Process -FilePath 'notepad.exe' -ArgumentList ('"{0}"' -f $file) } catch { } }
    }
})

$Context = New-Object System.Windows.Forms.ApplicationContext

function Close-Tray {
    $Timer.Stop()
    $Notify.Text = 'Shadow Jog Command Center: stopping'
    try { Stop-Services } catch { Write-TrayLog ("stop failed: {0}" -f $_.Exception.Message) }
    $Notify.Visible = $false
    $Notify.Dispose()
    try { $Mutex.ReleaseMutex() } catch { }
    $Context.ExitThread()
}

$ItemQuit.Add_Click({ Close-Tray })
$ItemRestart.Add_Click({
    try {
        $Timer.Stop()
        $Notify.Text = 'Shadow Jog Command Center: restarting'
        Stop-Services
        Start-Services
    } catch {
        Write-TrayLog ("restart failed: {0}" -f $_.Exception.Message)
        Show-Balloon ("The services could not start: {0}" -f $_.Exception.Message) ([System.Windows.Forms.ToolTipIcon]::Error)
    } finally {
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
        Show-Balloon ("{0}: another copy already runs, so this one ended. Nothing is wrong." -f $Label)
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
                Show-Balloon "Port $LocalPort is already in use, so the local server was not started."
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

$Timer = New-Object System.Windows.Forms.Timer
$Timer.Interval = $PollMs
$Timer.Add_Tick({
    try { Update-Tray } catch { Write-TrayLog ("poll failed: {0}" -f $_.Exception.Message) }
})

# ---- run ----

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
