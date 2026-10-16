<#
=====================================================================
 MES LION 1.0 JSON - GERAR PACOTE PARA OUTROS USUARIOS
 Cria um .zip desta pasta do MES, JA COM OS DADOS (pasta Dados: dados do MES, usuarios, historico e
 documentos), para enviar a quem nao tem PostgreSQL. Quem recebe so extrai e abre INICIAR_MES.bat.
 Ficam de fora: copias de seguranca (Dados\backups), logs e arquivos temporarios.
 Compativel com Windows PowerShell 5.1 e PowerShell 7.
=====================================================================
#>
param([string]$Destino = '')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
$Utf8 = New-Object System.Text.UTF8Encoding($false)
$Root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$Dados = Join-Path $Root 'Dados'
$NomePasta = Split-Path $Root -Leaf

Write-Host ''
Write-Host '=====================================================' -ForegroundColor Green
Write-Host ' MES LION 1.0 JSON - gerar pacote para outros usuários' -ForegroundColor Green
Write-Host '=====================================================' -ForegroundColor Green

$trava = Join-Path $Dados 'servidor_em_execucao.json'
if ([System.IO.File]::Exists($trava)) {
    try {
        $t = [System.IO.File]::ReadAllText($trava, $Utf8) | ConvertFrom-Json
        if ([string]$t.computador -eq [Environment]::MachineName) {
            $p = Get-Process -Id ([int]$t.pid) -ErrorAction SilentlyContinue
            $mesmo = $false
            if ($null -ne $p -and $p.ProcessName -match 'powershell|pwsh') { try { $mesmo = ($p.StartTime.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss') -eq [string]$t.processoIniciadoEm) } catch { } }
            if ($mesmo) {
                Write-Host ''
                Write-Host 'O MES está aberto. Feche a janela do servidor do MES (para gravar tudo) e rode de novo.' -ForegroundColor Yellow
                exit 1
            }
        }
    } catch { }
}

if ([string]::IsNullOrWhiteSpace($Destino)) {
    $Destino = Join-Path (Split-Path $Root -Parent) ('MES_LION_1_0_JSON_' + [DateTime]::Now.ToString('yyyyMMdd_HHmm') + '.zip')
}
$Destino = [System.IO.Path]::GetFullPath($Destino)
if ($Destino.StartsWith($Root + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    Write-Host 'O pacote não pode ser gravado dentro da própria pasta do MES.' -ForegroundColor Red
    exit 1
}

function Excluido([string]$rel) {
    $r = $rel.Replace('\', '/')
    $l = $r.ToLowerInvariant()
    if ($l.StartsWith('dados/backups/') -or $l.StartsWith('dados/logs/') -or $l.StartsWith('dados/importacao_postgresql_tmp_')) { return $true }
    if ($l -eq 'dados/servidor_em_execucao.json' -or $l.EndsWith('.tmp')) { return $true }
    $nome = [System.IO.Path]::GetFileName($r)
    if ($nome.StartsWith('.teste_gravacao_')) { return $true }
    return $false
}

$arquivos = @([System.IO.Directory]::GetFiles($Root, '*', [System.IO.SearchOption]::AllDirectories) | Sort-Object)
$tmp = $Destino + '.tmp'
$n = 0; $bytes = 0L
$fs = [System.IO.File]::Open($tmp, [System.IO.FileMode]::Create, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
try {
    $zip = [System.IO.Compression.ZipArchive]::new($fs, [System.IO.Compression.ZipArchiveMode]::Create, $true)
    try {
        foreach ($f in $arquivos) {
            $rel = $f.Substring($Root.Length).TrimStart('\', '/')
            if (Excluido $rel) { continue }
            $ent = $zip.CreateEntry($NomePasta + '/' + $rel.Replace('\', '/'), [System.IO.Compression.CompressionLevel]::Optimal)
            $ent.LastWriteTime = [DateTimeOffset](New-Object System.IO.FileInfo($f)).LastWriteTime
            $es = $ent.Open()
            $orig = [System.IO.File]::Open($f, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
            try { $orig.CopyTo($es); $bytes += $orig.Length } finally { $orig.Dispose(); $es.Dispose() }
            $n++
        }
    } finally { $zip.Dispose() }
} finally { $fs.Dispose() }
if ([System.IO.File]::Exists($Destino)) { [System.IO.File]::Delete($Destino) }
[System.IO.File]::Move($tmp, $Destino)

$usuarios = 0
try { $usuarios = @([System.IO.File]::ReadAllText((Join-Path $Dados 'usuarios.json'), $Utf8) | ConvertFrom-Json).Count } catch { }
Write-Host ''
Write-Host ('Pacote criado: ' + $Destino) -ForegroundColor Green
Write-Host ('{0} arquivos, {1:N1} MB ({2:N1} MB compactado). Usuários incluídos: {3}.' -f $n, ($bytes / 1MB), ((New-Object System.IO.FileInfo($Destino)).Length / 1MB), $usuarios)
Write-Host ''
Write-Host 'Quem receber o pacote: extrair o .zip (botão direito > Extrair Tudo) em uma pasta local, por exemplo'
Write-Host 'Documentos, e dar dois cliques em INICIAR_MES.bat. Entra com o próprio usuário e senha do MES.'
Write-Host 'Cada computador passa a ter a sua cópia dos dados. Para todos trabalharem nos MESMOS dados, use'
Write-Host 'INICIAR_MES_REDE.bat em um computador e os demais acessam pelo navegador.'
exit 0
