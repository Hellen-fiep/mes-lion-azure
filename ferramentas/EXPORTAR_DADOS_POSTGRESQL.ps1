<#
=====================================================================
 MES LION — EXPORTAÇÃO DOS DADOS DO POSTGRESQL (versão PowerShell/PostgreSQL)
 Gera um pacote de migração para a versão Microsoft/Azure (SQL Server):
   estado.json         -> app_state.payload (todo o estado do MES)
   app_storage.json    -> chaves do localStorage do frontend
   usuarios.json       -> usuários com hash de senha (bcrypt do pgcrypto, preservado)
   auditoria.json      -> histórico de modificações (audit_log)
   documentos.json     -> metadados dos documentos de equipamentos
   uploads\            -> arquivos PDF/XLS/XLSX dos documentos (server\uploads)
   manifesto.json      -> contagens e SHA-256 para conferência
 Somente LEITURA no PostgreSQL: nada é alterado no banco antigo.
 Compatível com Windows PowerShell 5.1 e PowerShell 7.
=====================================================================
#>
param(
    [string]$Servidor = 'localhost',
    [int]$Porta = 5432,
    [string]$Banco = 'mes_lion',
    [string]$Usuario = 'postgres',
    [string]$PastaMesAntigo = '',
    [string]$Saida = ''
)
$ErrorActionPreference = 'Stop'

function Find-Psql {
    $c = Get-Command psql -ErrorAction SilentlyContinue
    if ($c) { return $c.Source }
    $c = Get-Command psql.exe -ErrorAction SilentlyContinue
    if ($c) { return $c.Source }
    if (Test-Path 'C:\Program Files\PostgreSQL') {
        $xs = Get-ChildItem 'C:\Program Files\PostgreSQL' -Filter psql.exe -Recurse -ErrorAction SilentlyContinue | Sort-Object FullName -Descending
        if ($xs) { return $xs[0].FullName }
    }
    throw 'psql não encontrado. O PostgreSQL (cliente psql) precisa estar instalado neste computador.'
}

Write-Host ''
Write-Host '=====================================================' -ForegroundColor Cyan
Write-Host ' MES LION - Exportação dos dados do PostgreSQL' -ForegroundColor Cyan
Write-Host '=====================================================' -ForegroundColor Cyan

$Psql = Find-Psql
Write-Host "psql: $Psql"

if ([string]::IsNullOrWhiteSpace($Saida)) {
    $Saida = Join-Path (Get-Location) ('migracao_postgresql_' + (Get-Date -Format 'yyyyMMdd_HHmmss'))
}
New-Item -ItemType Directory -Force -Path $Saida | Out-Null
$Saida = (Resolve-Path $Saida).Path

if ([string]::IsNullOrEmpty($env:PGPASSWORD)) {
    $sec = Read-Host "Senha do usuario $Usuario do PostgreSQL (nao sera salva)" -AsSecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
    try { $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}
$env:PGCLIENTENCODING = 'UTF8'

function Export-Query([string]$Sql, [string]$Arquivo) {
    $destino = Join-Path $Saida $Arquivo
    $tmp = Join-Path $Saida ('_consulta_' + [guid]::NewGuid().ToString('N') + '.sql')
    [IO.File]::WriteAllText($tmp, $Sql, (New-Object Text.UTF8Encoding($false)))
    try {
        $saidaPsql = & $Psql -h $Servidor -p $Porta -U $Usuario -d $Banco -X -q -t -A -v ON_ERROR_STOP=1 -f $tmp -o $destino 2>&1
        if ($LASTEXITCODE -ne 0) { throw "Falha no psql ($Arquivo): $($saidaPsql -join ' ')" }
    } finally { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
    return $destino
}

function Get-Scalar([string]$Sql) {
    $tmp = Join-Path $Saida ('_consulta_' + [guid]::NewGuid().ToString('N') + '.sql')
    [IO.File]::WriteAllText($tmp, $Sql, (New-Object Text.UTF8Encoding($false)))
    try {
        $o = & $Psql -h $Servidor -p $Porta -U $Usuario -d $Banco -X -q -t -A -v ON_ERROR_STOP=1 -f $tmp 2>&1
        if ($LASTEXITCODE -ne 0) { throw "Falha no psql: $($o -join ' ')" }
        return ($o -join "`n").Trim()
    } finally { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
}

function Get-Sha256([string]$Caminho) {
    $sha = [Security.Cryptography.SHA256]::Create()
    $fs = [IO.File]::OpenRead($Caminho)
    try { return ([BitConverter]::ToString($sha.ComputeHash($fs)) -replace '-', '').ToLowerInvariant() }
    finally { $fs.Dispose(); $sha.Dispose() }
}

Write-Host "Conectando em ${Servidor}:${Porta}/${Banco} como $Usuario..."
$versaoPg = Get-Scalar 'SELECT version();'
Write-Host "PostgreSQL: $versaoPg"

Write-Host 'Exportando estado do MES (app_state)...'
$arqEstado = Export-Query 'SELECT payload::text FROM app_state WHERE id=1;' 'estado.json'
if ((Get-Item $arqEstado).Length -lt 2) { throw 'app_state vazio: não há estado para exportar.' }

Write-Host 'Exportando app_storage...'
Export-Query "SELECT coalesce(json_object_agg(key, value), '{}'::json)::text FROM app_storage;" 'app_storage.json' | Out-Null

Write-Host 'Exportando usuários (com hash de senha)...'
Export-Query @'
SELECT coalesce(json_agg(u ORDER BY u.created_at), '[]'::json)::text
FROM (SELECT id::text AS id, username, full_name, password_hash, role, active, created_at, updated_at FROM users) u;
'@ 'usuarios.json' | Out-Null

Write-Host 'Exportando histórico de modificações (audit_log)...'
Export-Query @'
SELECT coalesce(json_agg(a ORDER BY a.id), '[]'::json)::text
FROM (SELECT id, user_id::text AS user_id, username, module, action, record_key, changed_at, details FROM audit_log) a;
'@ 'auditoria.json' | Out-Null

Write-Host 'Exportando documentos de equipamentos...'
Export-Query @'
SELECT coalesce(json_agg(d ORDER BY d.uploaded_at), '[]'::json)::text
FROM (SELECT id::text AS id, equipment_code, original_name, stored_name, mime_type, file_size, document_type, revision, active,
             uploaded_at, uploaded_by::text AS uploaded_by FROM equipment_documents) d;
'@ 'documentos.json' | Out-Null

# Arquivos dos documentos (server\uploads do MES antigo)
$pastaUploadsDestino = Join-Path $Saida 'uploads'
New-Item -ItemType Directory -Force -Path $pastaUploadsDestino | Out-Null
$copiados = 0
if (-not [string]::IsNullOrWhiteSpace($PastaMesAntigo)) {
    $origemUploads = Join-Path $PastaMesAntigo 'server\uploads'
    if (-not (Test-Path $origemUploads)) { $origemUploads = Join-Path $PastaMesAntigo 'server/uploads' }
    if (Test-Path $origemUploads) {
        Get-ChildItem $origemUploads -File | ForEach-Object { Copy-Item $_.FullName (Join-Path $pastaUploadsDestino $_.Name) -Force; $copiados++ }
        Write-Host "Arquivos de documentos copiados: $copiados"
    } else {
        Write-Host "AVISO: pasta de uploads não encontrada em $origemUploads" -ForegroundColor Yellow
    }
} else {
    Write-Host 'AVISO: -PastaMesAntigo não informado; os arquivos dos documentos não foram copiados.' -ForegroundColor Yellow
}

$contagens = Get-Scalar @'
SELECT json_build_object(
  'colecoes', (SELECT count(*) FROM jsonb_object_keys((SELECT payload FROM app_state WHERE id=1))),
  'app_storage', (SELECT count(*) FROM app_storage),
  'usuarios', (SELECT count(*) FROM users),
  'auditoria', (SELECT count(*) FROM audit_log),
  'documentos', (SELECT count(*) FROM equipment_documents)
)::text;
'@

$manifesto = [ordered]@{
    origem          = 'MES LION PowerShell/PostgreSQL'
    servidor        = "${Servidor}:${Porta}/${Banco}"
    postgresql      = $versaoPg
    exportadoEm     = (Get-Date).ToString('yyyy-MM-ddTHH:mm:sszzz')
    computador      = $env:COMPUTERNAME
    contagens       = ($contagens | ConvertFrom-Json)
    arquivosCopiados = $copiados
    sha256Estado    = (Get-Sha256 $arqEstado)
    bytesEstado     = (Get-Item $arqEstado).Length
}
$jsonManifesto = $manifesto | ConvertTo-Json -Depth 5
[IO.File]::WriteAllText((Join-Path $Saida 'manifesto.json'), $jsonManifesto, (New-Object Text.UTF8Encoding($false)))

Write-Host ''
Write-Host 'Exportação concluída.' -ForegroundColor Green
Write-Host "Pacote: $Saida"
Write-Host $jsonManifesto
Write-Output $Saida
