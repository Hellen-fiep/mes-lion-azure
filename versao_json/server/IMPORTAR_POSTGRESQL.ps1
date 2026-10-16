<#
=====================================================================
 MES LION 1.0 JSON - IMPORTAR OS DADOS DO MES POSTGRESQL (COM TODO O HISTORICO)

 Rode no computador onde esta o MES LION 1.0 PGSQL (com o PostgreSQL instalado):
 de dois cliques em IMPORTAR_DADOS_DO_POSTGRESQL.bat, na pasta da versao JSON.

 Copia do banco PostgreSQL (somente LEITURA: nada e alterado no banco) para a pasta Dados desta versao:
   app_state            -> Dados\MES_LION_DATA.json            todos os dados do MES, como estao hoje
   app_storage          -> Dados\app_storage.json
   users                -> Dados\usuarios.json                 os mesmos usuarios e as MESMAS senhas
   audit_log            -> Dados\auditoria.jsonl               Historico de Modificacoes completo
   equipment_documents  -> Dados\documentos_equipamentos.json  + arquivos de server\uploads do MES antigo
 Os arquivos que ja estavam na pasta Dados sao guardados antes em Dados\backups.
 Compativel com Windows PowerShell 5.1 e PowerShell 7.
=====================================================================
#>
param(
    [string]$Servidor = 'localhost',
    [int]$Porta = 5432,
    [string]$Banco = 'mes_lion',
    [string]$Usuario = 'postgres',
    [string]$PastaMesAntigo = '',
    [string]$PastaDados = '',
    [switch]$SemConfirmacao
)
$ErrorActionPreference = 'Stop'
$Utf8 = New-Object System.Text.UTF8Encoding($false)
$Utf8Estrito = New-Object System.Text.UTF8Encoding($false, $true)
$Latin1 = [System.Text.Encoding]::GetEncoding(28591)
$Root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if ([string]::IsNullOrWhiteSpace($PastaDados)) { $Dados = Join-Path $Root 'Dados' } else { $Dados = [System.IO.Path]::GetFullPath($PastaDados) }
$Carimbo = [DateTime]::Now.ToString('yyyyMMdd_HHmmss')
$PastaBackups = Join-Path $Dados 'backups'
$PastaDocumentos = Join-Path (Join-Path $Dados 'arquivos') 'documentos'

function Titulo([string]$t) { Write-Host ''; Write-Host $t -ForegroundColor Cyan }
function Falhar([string]$mensagem) {
    Write-Host ''
    Write-Host ('ERRO: ' + $mensagem) -ForegroundColor Red
    Write-Host 'Nada foi alterado na pasta Dados.' -ForegroundColor Yellow
    exit 1
}

Write-Host ''
Write-Host '=====================================================' -ForegroundColor Green
Write-Host ' MES LION 1.0 JSON - importar dados do MES PostgreSQL' -ForegroundColor Green
Write-Host '=====================================================' -ForegroundColor Green
Write-Host "Destino (versão JSON): $Dados"

# ---------------------------------------------------------------- o MES JSON nao pode estar aberto nesta pasta
$trava = Join-Path $Dados 'servidor_em_execucao.json'
if ([System.IO.File]::Exists($trava)) {
    try {
        $t = [System.IO.File]::ReadAllText($trava, $Utf8) | ConvertFrom-Json
        $ativo = $false
        if ([string]$t.computador -eq [Environment]::MachineName) {
            $p = Get-Process -Id ([int]$t.pid) -ErrorAction SilentlyContinue
            $ativo = ($null -ne $p -and $p.ProcessName -match 'powershell|pwsh')
            if ($ativo) { try { $ativo = ($p.StartTime.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss') -eq [string]$t.processoIniciadoEm) } catch { $ativo = $false } }
        } else {
            $quando = [DateTimeOffset]::MinValue
            $ativo = [DateTimeOffset]::TryParse([string]$t.atualizadoEm, [ref]$quando) -and (([DateTimeOffset]::Now - $quando).TotalMinutes -lt 3)
        }
        if ($ativo) { Falhar ('o MES (versão JSON) está aberto usando esta pasta (computador ' + $t.computador + '). Feche a janela do servidor do MES JSON e rode a importação de novo.') }
    } catch [System.Management.Automation.ExitException] { throw } catch { }
}

# ---------------------------------------------------------------- psql
function Achar-Psql {
    foreach ($nome in 'psql.exe', 'psql') { $c = Get-Command $nome -ErrorAction SilentlyContinue; if ($c) { return $c.Source } }
    foreach ($base in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, 'C:\Program Files\PostgreSQL')) {
        if ([string]::IsNullOrWhiteSpace($base)) { continue }
        $pg = Join-Path $base 'PostgreSQL'
        if (-not (Test-Path $pg)) { $pg = $base }
        if (-not (Test-Path $pg)) { continue }
        $xs = @(Get-ChildItem $pg -Filter psql.exe -Recurse -ErrorAction SilentlyContinue | Sort-Object FullName -Descending)
        if ($xs.Count -gt 0) { return $xs[0].FullName }
    }
    return $null
}
$Psql = Achar-Psql
if (-not $Psql) { Falhar 'psql.exe não encontrado. Rode esta importação no computador onde o MES PostgreSQL está instalado (o PostgreSQL inclui o psql).' }
Write-Host "psql: $Psql"

if ([string]::IsNullOrEmpty($env:PGPASSWORD)) {
    $sec = Read-Host "Senha do usuário $Usuario do PostgreSQL (a mesma pedida ao abrir o MES PostgreSQL; não será salva)" -AsSecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
    try { $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}
$env:PGCLIENTENCODING = 'UTF8'

$Temp = Join-Path $Dados ('importacao_postgresql_tmp_' + $Carimbo)
[void][System.IO.Directory]::CreateDirectory($Temp)
$script:BancoAtual = $Banco

function Psql-Executar([string]$sql, [string]$arquivoSaida = '') {
    $tmp = Join-Path $Temp ('consulta_' + [guid]::NewGuid().ToString('N') + '.sql')
    [System.IO.File]::WriteAllText($tmp, $sql, $Utf8)
    $argumentos = @('-h', $Servidor, '-p', [string]$Porta, '-U', $Usuario, '-d', $script:BancoAtual, '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-f', $tmp)
    if ($arquivoSaida) { $argumentos += @('-o', $arquivoSaida) }
    $anterior = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $saida = & $Psql @argumentos 2>&1
        $codigo = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $anterior
        Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
    }
    $texto = ((@($saida) | ForEach-Object { $_.ToString() }) -join "`n").Trim()
    if ($codigo -ne 0) { throw (New-Object System.InvalidOperationException $texto) }
    return $texto
}

function Limpar-Temp { try { Remove-Item -LiteralPath $Temp -Recurse -Force -ErrorAction SilentlyContinue } catch { } }

# ---------------------------------------------------------------- conexao
Titulo "Conectando em ${Servidor}:${Porta} (banco $Banco, usuário $Usuario)..."
$versaoPg = $null
foreach ($tentativa in @($Banco, 'meslion')) {
    $script:BancoAtual = $tentativa
    try { $versaoPg = Psql-Executar 'SELECT version();'; break }
    catch {
        $m = $_.Exception.Message
        if ($m -match 'password authentication failed|autentica') { Limpar-Temp; Falhar 'senha do PostgreSQL incorreta.' }
        if ($m -match 'does not exist|não existe|nao existe' -and $tentativa -ne 'meslion' -and $Banco -eq 'mes_lion') { continue }
        Limpar-Temp
        Falhar ('não foi possível conectar ao PostgreSQL: ' + $m)
    }
}
if (-not $versaoPg) { Limpar-Temp; Falhar "o banco $Banco não existe neste PostgreSQL." }
Write-Host ('Conectado: ' + $versaoPg.Split(',')[0] + ' | banco ' + $script:BancoAtual)

foreach ($tabela in 'app_state', 'users', 'audit_log', 'app_storage', 'equipment_documents') {
    if ((Psql-Executar "SELECT to_regclass('public.$tabela') IS NOT NULL;") -ne 't') { Limpar-Temp; Falhar "o banco $($script:BancoAtual) não tem a tabela $tabela - não parece ser o banco do MES LION PostgreSQL." }
}
$temEstado = Psql-Executar 'SELECT count(*) FROM app_state WHERE id=1;'
if ($temEstado -ne '1') { Limpar-Temp; Falhar 'o banco PostgreSQL não tem dados do MES (tabela app_state vazia).' }

$c = (Psql-Executar @'
SELECT json_build_object(
  'bytesEstado', (SELECT octet_length(payload::text) FROM app_state WHERE id=1),
  'colecoes', (SELECT CASE WHEN jsonb_typeof(payload)='object' THEN (SELECT count(*) FROM jsonb_object_keys(payload)) ELSE 0 END FROM app_state WHERE id=1),
  'atualizadoEm', (SELECT to_char(updated_at, 'DD/MM/YYYY HH24:MI') FROM app_state WHERE id=1),
  'appStorage', (SELECT count(*) FROM app_storage),
  'usuarios', (SELECT count(*) FROM users),
  'usuariosAtivos', (SELECT count(*) FROM users WHERE active),
  'admins', (SELECT count(*) FROM users WHERE active AND role='ADMIN'),
  'historico', (SELECT count(*) FROM audit_log),
  'historicoDe', (SELECT to_char(min(changed_at), 'DD/MM/YYYY') FROM audit_log),
  'historicoAte', (SELECT to_char(max(changed_at), 'DD/MM/YYYY') FROM audit_log),
  'documentos', (SELECT count(*) FROM equipment_documents)
)::text;
'@) | ConvertFrom-Json

# outras tabelas do esquema original (o servidor PowerShell não as usava; se tiverem linhas, são guardadas também)
$extras = @()
foreach ($tabela in 'products', 'materials', 'suppliers', 'equipment', 'routes', 'route_steps', 'production_orders', 'op_steps', 'op_materials',
    'op_document_flags', 'icv_snapshots', 'aicv_results', 'lcc_studies', 'battery_passports', 'equipment_scales', 'characterization_bookings',
    'capacity_restrictions', 'planning_goals', 'setup_time_logs', 'stock_movements') {
    if ((Psql-Executar "SELECT to_regclass('public.$tabela') IS NOT NULL;") -ne 't') { continue }
    $n = [int](Psql-Executar "SELECT count(*) FROM public.$tabela;")
    if ($n -gt 0) { $extras += [pscustomobject]@{ tabela = $tabela; linhas = $n } }
}

Titulo 'Dados encontrados no PostgreSQL:'
Write-Host ('  Dados do MES ........ {0:N1} MB, {1} coleções (última gravação: {2})' -f ($c.bytesEstado / 1MB), $c.colecoes, $c.atualizadoEm)
Write-Host ('  Usuários ............ {0} ({1} ativos, {2} administradores ativos) - com as mesmas senhas' -f $c.usuarios, $c.usuariosAtivos, $c.admins)
$periodo = ''
if ($c.historico -gt 0) { $periodo = " (de $($c.historicoDe) a $($c.historicoAte))" }
Write-Host ('  Histórico ........... {0} registros{1}' -f $c.historico, $periodo)
Write-Host ('  Documentos .......... {0}' -f $c.documentos)
Write-Host ('  Preferências ........ {0} chaves (app_storage)' -f $c.appStorage)
foreach ($x in $extras) { Write-Host ('  Tabela {0} ...... {1} linhas (guardadas em Dados\importacao_postgresql)' -f $x.tabela, $x.linhas) }

$atual = Join-Path $Dados 'MES_LION_DATA.json'
Write-Host ''
if ([System.IO.File]::Exists($atual)) {
    Write-Host 'Os dados que estão hoje na pasta Dados desta versão JSON serão SUBSTITUÍDOS pelos do PostgreSQL.' -ForegroundColor Yellow
    Write-Host 'Antes disso, uma cópia deles é guardada em Dados\backups.' -ForegroundColor Yellow
}
if (-not $SemConfirmacao) {
    $resp = Read-Host 'Continuar com a importação? (S/N)'
    if ($resp -notmatch '^(s|sim|y|yes)$') { Limpar-Temp; Write-Host 'Importação cancelada. Nada foi alterado.'; exit 2 }
}

# ---------------------------------------------------------------- exportacao (somente leitura)
try {
    Titulo 'Copiando do PostgreSQL...'
    $arqEstado = Join-Path $Temp 'estado.json'
    Psql-Executar 'SELECT payload::text FROM app_state WHERE id=1;' $arqEstado | Out-Null
    Write-Host '  dados do MES'
    $arqKv = Join-Path $Temp 'app_storage.json'
    Psql-Executar "SELECT coalesce(json_object_agg(key, coalesce(value, '')), '{}'::json)::text FROM app_storage;" $arqKv | Out-Null
    $arqUsuarios = Join-Path $Temp 'usuarios.json'
    Psql-Executar @'
SELECT coalesce(json_agg(u ORDER BY u.created_at), '[]'::json)::text
FROM (SELECT id::text AS id, username, full_name, password_hash, role, active, created_at, updated_at FROM users) u;
'@ $arqUsuarios | Out-Null
    Write-Host '  usuários'
    $arqAuditoria = Join-Path $Temp 'auditoria.jsonl'
    Psql-Executar @'
SELECT json_build_object('username', username, 'module', module, 'action', action, 'record_key', record_key,
                         'changed_at', changed_at, 'details', coalesce(details, '{}'::jsonb))::text
FROM audit_log ORDER BY changed_at, id;
'@ $arqAuditoria | Out-Null
    Write-Host '  histórico de modificações'
    $arqDocs = Join-Path $Temp 'documentos.json'
    Psql-Executar @'
SELECT coalesce(json_agg(d ORDER BY d.uploaded_at), '[]'::json)::text
FROM (SELECT id::text AS id, equipment_code, original_name, stored_name, mime_type, file_size, document_type, revision, active,
             uploaded_at, uploaded_by::text AS uploaded_by FROM equipment_documents) d;
'@ $arqDocs | Out-Null
    Write-Host '  documentos (dados)'
    $pastaExtras = Join-Path $Temp 'tabelas_extras'
    foreach ($x in $extras) {
        [void][System.IO.Directory]::CreateDirectory($pastaExtras)
        Psql-Executar ("SELECT coalesce(json_agg(t), '[]'::json)::text FROM public.$($x.tabela) t;") (Join-Path $pastaExtras ($x.tabela + '.json')) | Out-Null
    }
} catch {
    Limpar-Temp
    Falhar ('falha ao ler o PostgreSQL: ' + $_.Exception.Message)
}

# ---------------------------------------------------------------- conferencia
function Ler-Bytes([string]$p) {
    $b = [System.IO.File]::ReadAllBytes($p)
    $n = $b.Length
    while ($n -gt 0 -and ($b[$n - 1] -eq 10 -or $b[$n - 1] -eq 13 -or $b[$n - 1] -eq 32)) { $n-- }
    if ($n -eq $b.Length) { return , $b }
    $c2 = New-Object byte[] $n
    [Array]::Copy($b, $c2, $n)
    return , $c2
}
$estadoBytes = Ler-Bytes $arqEstado
if ($estadoBytes.Length -lt 2 -or $estadoBytes[0] -ne 123 -or $estadoBytes[$estadoBytes.Length - 1] -ne 125) { Limpar-Temp; Falhar 'os dados do MES lidos do PostgreSQL não são um objeto JSON.' }
$usuarios = @([System.IO.File]::ReadAllText($arqUsuarios, $Utf8) | ConvertFrom-Json)
$docs = @([System.IO.File]::ReadAllText($arqDocs, $Utf8) | ConvertFrom-Json)
$linhasHist = @()
if ((New-Object System.IO.FileInfo($arqAuditoria)).Length -gt 0) { $linhasHist = @([System.IO.File]::ReadAllLines($arqAuditoria, $Utf8) | Where-Object { $_.Trim().Length -gt 0 }) }
if ($linhasHist.Count -ne [int]$c.historico) { Limpar-Temp; Falhar ("histórico incompleto ({0} de {1} registros)." -f $linhasHist.Count, $c.historico) }

# nomes enviados pelo MES PostgreSQL ficavam com acentos trocados ("InstruÃ§Ã£o"): corrige quando for o caso
function Corrigir-Acentos([string]$s) {
    if ([string]::IsNullOrEmpty($s) -or $s -notmatch '[\u00C2-\u00F4][\u0080-\u00BF]') { return $s }
    foreach ($ch in $s.ToCharArray()) { if ([int]$ch -gt 255) { return $s } }
    try { return $Utf8Estrito.GetString($Latin1.GetBytes($s)) } catch { return $s }
}
foreach ($d in $docs) {
    foreach ($campo in 'original_name', 'document_type', 'revision') {
        if ($d.PSObject.Properties[$campo] -and $d.$campo) { $d.$campo = Corrigir-Acentos ([string]$d.$campo) }
    }
}

# ---------------------------------------------------------------- arquivos dos documentos (server\uploads do MES antigo)
$copiados = 0; $faltando = @()
if ($docs.Count -gt 0) {
    function Pasta-Uploads([string]$p) {
        if ([string]::IsNullOrWhiteSpace($p)) { return $null }
        $p = $p.Trim().Trim('"')
        foreach ($cand in @((Join-Path $p 'server\uploads'), (Join-Path $p 'server/uploads'), (Join-Path $p 'uploads'), $p)) {
            if ((Test-Path -LiteralPath $cand) -and (Get-ChildItem -LiteralPath $cand -File -ErrorAction SilentlyContinue | Select-Object -First 1)) { return (Resolve-Path -LiteralPath $cand).Path }
        }
        return $null
    }
    $uploads = Pasta-Uploads $PastaMesAntigo
    if (-not $uploads) {
        # procura o MES PostgreSQL perto desta pasta e nas pastas comuns do usuario
        $bases = @((Split-Path $Root -Parent))
        foreach ($pp in 'Desktop', 'Documents', 'Downloads', 'OneDrive', 'OneDrive\Desktop', 'OneDrive\Documents') { if ($env:USERPROFILE) { $bases += (Join-Path $env:USERPROFILE $pp) } }
        $bases += 'C:\'
        $candidatos = @()
        foreach ($b in $bases) {
            if (-not (Test-Path -LiteralPath $b)) { continue }
            foreach ($dir in @(Get-Item -LiteralPath $b) + @(Get-ChildItem -LiteralPath $b -Directory -ErrorAction SilentlyContinue)) {
                foreach ($sub in @($dir) + @(Get-ChildItem -LiteralPath $dir.FullName -Directory -ErrorAction SilentlyContinue)) {
                    if ($sub.FullName -eq $Root) { continue }
                    if (Test-Path -LiteralPath (Join-Path $sub.FullName 'server\MES_LION_SERVER.ps1')) { $candidatos += $sub.FullName }
                }
            }
        }
        $melhor = $null; $melhorN = 0
        foreach ($cand in ($candidatos | Select-Object -Unique)) {
            $up = Join-Path $cand 'server\uploads'
            if (-not (Test-Path -LiteralPath $up)) { continue }
            $n = @($docs | Where-Object { $_.stored_name -and (Test-Path -LiteralPath (Join-Path $up ([System.IO.Path]::GetFileName([string]$_.stored_name)))) }).Count
            if ($n -gt $melhorN) { $melhor = $up; $melhorN = $n }
        }
        $uploads = $melhor
    }
    if (-not $uploads -and -not $SemConfirmacao) {
        Write-Host ''
        Write-Host ('Há {0} documentos de equipamentos. Os arquivos ficam na pasta server\uploads do MES PostgreSQL.' -f $docs.Count) -ForegroundColor Yellow
        $resp = Read-Host 'Arraste aqui a pasta do MES PostgreSQL (ou digite o caminho) e tecle Enter. Só Enter = pular os arquivos'
        $uploads = Pasta-Uploads $resp
    }
    if ($uploads) {
        Write-Host "  arquivos dos documentos: $uploads"
        [void][System.IO.Directory]::CreateDirectory((Join-Path $Temp 'documentos'))
        foreach ($d in $docs) {
            $nome = [System.IO.Path]::GetFileName([string]$d.stored_name)
            $origem = Join-Path $uploads $nome
            if ($nome -and (Test-Path -LiteralPath $origem)) { Copy-Item -LiteralPath $origem -Destination (Join-Path (Join-Path $Temp 'documentos') $nome) -Force; $copiados++ }
            else { $faltando += $d.original_name }
        }
    } else {
        $faltando = @($docs | ForEach-Object { $_.original_name })
    }
}

# ---------------------------------------------------------------- copia de seguranca do que ja existe na pasta Dados
[void][System.IO.Directory]::CreateDirectory($PastaBackups)
$existentes = @('MES_LION_DATA.json', 'app_storage.json', 'usuarios.json', 'auditoria.jsonl', 'documentos_equipamentos.json', 'anexos.json', 'passaportes_publicados.json') |
    Where-Object { [System.IO.File]::Exists((Join-Path $Dados $_)) }
$backup = $null
if ($existentes.Count -gt 0) {
    Add-Type -AssemblyName System.IO.Compression
    $backup = Join-Path $PastaBackups ('ARQUIVOS_ANTES_DA_IMPORTACAO_POSTGRESQL_' + $Carimbo + '.zip')
    $fs = [System.IO.File]::Open($backup, [System.IO.FileMode]::Create, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
    try {
        $zip = [System.IO.Compression.ZipArchive]::new($fs, [System.IO.Compression.ZipArchiveMode]::Create, $true)
        try {
            foreach ($n in $existentes) {
                $ent = $zip.CreateEntry($n, [System.IO.Compression.CompressionLevel]::Optimal)
                $es = $ent.Open()
                $orig = [System.IO.File]::OpenRead((Join-Path $Dados $n))
                try { $orig.CopyTo($es) } finally { $orig.Dispose(); $es.Dispose() }
            }
        } finally { $zip.Dispose() }
    } finally { $fs.Dispose() }
    Write-Host "  cópia dos dados anteriores: $backup"
}

# ---------------------------------------------------------------- grava na pasta Dados (troca atomica de cada arquivo)
function Gravar-Atomico([string]$destino, [byte[]]$conteudo) {
    $tmp = $destino + '.' + [guid]::NewGuid().ToString('N') + '.tmp'
    [System.IO.File]::WriteAllBytes($tmp, $conteudo)
    if ([System.IO.File]::Exists($destino)) { [System.IO.File]::Replace($tmp, $destino, [NullString]::Value) } else { [System.IO.File]::Move($tmp, $destino) }
}
function Json-Str([string]$s) {
    if ($null -eq $s) { return 'null' }
    $t = $s.Replace('\', '\\').Replace('"', '\"').Replace("`r", '\r').Replace("`n", '\n').Replace("`t", '\t')
    $t = [regex]::Replace($t, '[\x00-\x1f]', { param($m) '\u{0:x4}' -f [int][char]$m.Value })
    return '"' + $t + '"'
}
try {
    Titulo 'Gravando na pasta Dados...'
    Gravar-Atomico (Join-Path $Dados 'MES_LION_DATA.json') $estadoBytes
    Gravar-Atomico (Join-Path $Dados 'app_storage.json') (Ler-Bytes $arqKv)
    if ($usuarios.Count -gt 0) { Gravar-Atomico (Join-Path $Dados 'usuarios.json') (Ler-Bytes $arqUsuarios) }
    else { Write-Host '  AVISO: o PostgreSQL não tem usuários; os usuários atuais da versão JSON foram mantidos.' -ForegroundColor Yellow }
    $agora = [DateTimeOffset]::Now.ToString("yyyy-MM-dd'T'HH:mm:ss.ffffffzzz", [System.Globalization.CultureInfo]::InvariantCulture)
    $detalhes = '{"origem":' + (Json-Str ("${Servidor}:${Porta}/$($script:BancoAtual)")) + ',"usuarios":' + $usuarios.Count + ',"historico":' + $linhasHist.Count +
    ',"documentos":' + $docs.Count + ',"arquivosCopiados":' + $copiados + ',"computador":' + (Json-Str ([Environment]::MachineName)) + '}'
    $linhaImport = '{"username":' + (Json-Str ('importação (' + [Environment]::UserName + ')')) + ',"module":"banco","action":"IMPORT_POSTGRESQL","record_key":' +
    (Json-Str ('PostgreSQL ' + $script:BancoAtual)) + ',"changed_at":' + (Json-Str $agora) + ',"details":' + $detalhes + '}'
    $sb = New-Object System.Text.StringBuilder
    foreach ($l in $linhasHist) { [void]$sb.Append($l.Trim()).Append("`n") }
    [void]$sb.Append($linhaImport).Append("`n")
    Gravar-Atomico (Join-Path $Dados 'auditoria.jsonl') ($Utf8.GetBytes($sb.ToString()))
    if ($docs.Count -gt 0) {
        [void][System.IO.Directory]::CreateDirectory($PastaDocumentos)
        $pastaDocsTemp = Join-Path $Temp 'documentos'
        if (Test-Path -LiteralPath $pastaDocsTemp) { Get-ChildItem -LiteralPath $pastaDocsTemp -File | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $PastaDocumentos $_.Name) -Force } }
        Gravar-Atomico (Join-Path $Dados 'documentos_equipamentos.json') ($Utf8.GetBytes((ConvertTo-Json -InputObject @($docs) -Depth 5)))
    } elseif ([System.IO.File]::Exists((Join-Path $Dados 'documentos_equipamentos.json'))) {
        Gravar-Atomico (Join-Path $Dados 'documentos_equipamentos.json') ($Utf8.GetBytes('[]'))
    }
    $pastaImport = Join-Path $Dados 'importacao_postgresql'
    [void][System.IO.Directory]::CreateDirectory($pastaImport)
    if ($extras.Count -gt 0) {
        $destExtras = Join-Path $pastaImport ('tabelas_extras_' + $Carimbo)
        Move-Item -LiteralPath (Join-Path $Temp 'tabelas_extras') -Destination $destExtras
    }
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $hash = ([BitConverter]::ToString($sha.ComputeHash($estadoBytes)) -replace '-', '').ToLowerInvariant()
    $sha.Dispose()
    $manifesto = [ordered]@{
        origem = 'MES LION 1.0 PGSQL (PostgreSQL)'; servidor = "${Servidor}:${Porta}"; banco = $script:BancoAtual; postgresql = $versaoPg
        importadoEm = $agora; computador = [Environment]::MachineName; usuarioWindows = [Environment]::UserName
        contagens = [ordered]@{ colecoes = $c.colecoes; bytesEstado = $estadoBytes.Length; usuarios = $usuarios.Count; historico = $linhasHist.Count; documentos = $docs.Count; appStorage = $c.appStorage }
        arquivosDocumentosCopiados = $copiados; arquivosDocumentosNaoEncontrados = @($faltando); tabelasExtras = @($extras | ForEach-Object { $_.tabela })
        sha256Estado = $hash; backupAnterior = $backup
    }
    [System.IO.File]::WriteAllText((Join-Path $pastaImport ('importacao_' + $Carimbo + '.json')), (ConvertTo-Json -InputObject $manifesto -Depth 5), $Utf8)
} catch {
    Write-Host ''
    Write-Host ('ERRO ao gravar na pasta Dados: ' + $_.Exception.Message) -ForegroundColor Red
    if ($backup) { Write-Host "Os dados anteriores estão em: $backup" -ForegroundColor Yellow }
    Limpar-Temp
    exit 1
}
Limpar-Temp

Titulo 'Importação concluída.'
Write-Host ('  Dados do MES ........ {0:N1} MB, {1} coleções' -f ($estadoBytes.Length / 1MB), $c.colecoes) -ForegroundColor Green
Write-Host ('  Usuários ............ {0} (entre com o mesmo usuário e a mesma senha do MES PostgreSQL)' -f $usuarios.Count) -ForegroundColor Green
Write-Host ('  Histórico ........... {0} registros' -f $linhasHist.Count) -ForegroundColor Green
if ($docs.Count -gt 0) {
    Write-Host ('  Documentos .......... {0} ({1} arquivos copiados)' -f $docs.Count, $copiados) -ForegroundColor Green
    if ($faltando.Count -gt 0) { Write-Host ('  AVISO: {0} arquivo(s) de documento não encontrado(s); os dados do documento ficam, mas o arquivo não abre.' -f $faltando.Count) -ForegroundColor Yellow }
}
if ([int]$c.admins -eq 0 -and $usuarios.Count -gt 0) { Write-Host '  AVISO: nenhum administrador ativo entre os usuários importados. Use REDEFINIR_SENHA.bat para ativar um.' -ForegroundColor Yellow }
Write-Host ''
Write-Host 'Próximos passos:'
Write-Host '  1) Abra o MES com INICIAR_MES.bat e confira os dados e o Histórico de Modificações.'
Write-Host '  2) Para os outros usuários: GERAR_PACOTE_PARA_OUTROS_USUARIOS.bat cria um .zip desta pasta, já com os dados.'
exit 0
