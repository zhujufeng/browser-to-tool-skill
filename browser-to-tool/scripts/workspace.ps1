param(
    [string]$Name = '',
    [string]$Desktop = '',
    [string]$Resume = ''
)
# Windows PowerShell 5.1+；不需要 Node、Python、Git 或管理员权限。
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
function Assert-Absolute([string]$Value) {
    if ($Value -notmatch '^(?:[A-Za-z]:[\\/]|\\\\[^\\]+\\[^\\]+)') {
        throw '目录必须是绝对路径，不能使用相对路径或驱动器相对路径。'
    }
}
function New-Directory([string]$Parent, [string]$Leaf) {
    # 父路径用LiteralPath，避免OneDrive等目录中的方括号被当成通配符。
    Push-Location -LiteralPath $Parent
    try { return (New-Item -Path . -Name $Leaf -ItemType Directory) }
    finally { Pop-Location }
}
try {
    if ($Resume) {
        if ($Name -or $Desktop) { throw '-Resume 不能与 -Name 或 -Desktop 同用。' }
        Assert-Absolute $Resume
        foreach ($Path in @($Resume, (Join-Path $Resume '工作记录.md'), (Join-Path $Resume '使用说明.md'), (Join-Path $Resume '代码'))) {
            $Item = Get-Item -LiteralPath $Path -Force
            # OneDrive文件可能有ReparsePoint属性，不能一概当成符号链接拒绝。
            if ($Item.LinkType -in @('SymbolicLink', 'Junction')) {
                throw '续作目录或关键文件是符号链接/目录联接，请确认真实任务目录。'
            }
        }
        if (!(Test-Path -LiteralPath (Join-Path $Resume '代码') -PathType Container) -or
            !(Test-Path -LiteralPath (Join-Path $Resume '工作记录.md') -PathType Leaf) -or
            !(Test-Path -LiteralPath (Join-Path $Resume '使用说明.md') -PathType Leaf)) {
            throw '未找到完整任务目录；不会创建新目录或改写现有文件。'
        }
        Write-Output ((Get-Item -LiteralPath $Resume).FullName)
        exit 0
    }
    $Name = ($Name -replace '[<>:"/\\|?*\[\]\x00-\x1F\x7F]', '-').Trim(' ', '.')
    if (!$Name) { throw '请用 -Name 提供简短任务名。' }
    if ([System.Text.Encoding]::UTF8.GetByteCount($Name) -gt 120) {
        throw '任务名太长，请用不超过约40个汉字的简短名称。'
    }
    if (!$Desktop) { $Desktop = [Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory) }
    if (!$Desktop) { throw '系统未提供桌面位置，请让用户指定保存目录。' }
    Assert-Absolute $Desktop
    if (!(Test-Path -LiteralPath $Desktop -PathType Container)) {
        throw '保存根目录不存在；不会静默创建假桌面或回退当前目录。'
    }
    $Desktop = (Get-Item -LiteralPath $Desktop -Force).FullName
    $Base = (Get-Date -Format 'yyyy-MM-dd') + '_' + $Name
    $Work = $null
    for ($N = 1; $N -le 999; $N++) {
        $Leaf = $Base
        if ($N -ne 1) { $Leaf += "_$N" }
        $Candidate = Join-Path $Desktop $Leaf
        try {
            # 不用-Force：存在即失败，包含与另一个初始化进程的竞争。
            $Work = (New-Directory $Desktop $Leaf).FullName
            break
        } catch {
            if (!(Test-Path -LiteralPath $Candidate)) { throw }
        }
    }
    if (!$Work) { throw '同名目录过多，请换一个任务名。' }
    $null = New-Directory $Work '代码'
    $Record = @"
# 工作记录

- 任务：$Name
- 创建：$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')
- 状态：准备中，尚未开始调查或验证。

## 目标与授权范围

待记录。

## 调查、分析与决定

按时间补充观察依据、结论与限制；不保存凭据或原始请求头。

## 实际验证

尚未执行。

## 下一步

检测环境并确认目标页面。
"@
    # CreateNew防止覆盖；创建后失败也不递归删除已有内容。
    foreach ($Entry in @(
        @{ File = '工作记录.md'; Text = $Record },
        @{ File = '使用说明.md'; Text = "# 使用说明`n`n工具尚未完成。交付时补齐首次准备、日常运行、输出位置、停止方式、已验证范围和限制。`n" }
    )) {
        $Stream = [System.IO.File]::Open((Join-Path $Work $Entry.File), [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
        try {
            $Bytes = [System.Text.Encoding]::UTF8.GetBytes($Entry.Text)
            $Stream.Write($Bytes, 0, $Bytes.Length)
        } finally { $Stream.Dispose() }
    }
    Write-Output $Work
} catch {
    $Location = ''
    if ($Work) { $Location = " 已有内容保留在：$Work" }
    [Console]::Error.WriteLine("创建/恢复失败：$($_.Exception.Message)$Location 不会换位置、覆盖旧文件或调整系统安全策略。")
    exit 1
}
