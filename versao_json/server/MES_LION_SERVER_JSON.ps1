<#
=====================================================================
 MES LION 1.0 JSON - SERVIDOR SEM BANCO DE DADOS (Windows PowerShell 5.1 ou superior)

 Mesmas telas, mesmas regras e mesmo contrato HTTP do MES LION 1.0 PGSQL (server\MES_LION_SERVER.ps1),
 mas SEM PostgreSQL: os dados ficam em arquivos na pasta "Dados", ao lado da pasta "server".

   Dados\MES_LION_DATA.json             todos os dados do MES (gravados exatamente como o navegador envia)
   Dados\app_storage.json               demais chaves que o navegador grava
   Dados\usuarios.json                  usuarios do MES (senha com hash PBKDF2; hash bcrypt vindo do PostgreSQL tambem vale)
   Dados\auditoria.jsonl                Historico de Modificacoes (um registro JSON por linha)
   Dados\documentos_equipamentos.json   documentos dos equipamentos (arquivos em Dados\arquivos\documentos)
   Dados\anexos.json                    anexos dos cadastros (arquivos em Dados\arquivos\anexos)
   Dados\backups\                       copias de seguranca (.zip): manuais, diarias e antes de importar

 Nao requer instalacao, PostgreSQL, Node.js nem Python. Use INICIAR_MES.bat ou INICIAR_MES_REDE.bat.
 Para redefinir a senha de um usuario: REDEFINIR_SENHA.bat (parametro -RedefinirSenha).
=====================================================================
#>
param(
    [string]$HostIP = '127.0.0.1',
    [int]$Port = 8765,
    [string]$PastaDados = '',
    [switch]$NaoAbrirNavegador,
    [switch]$RedefinirSenha,
    [switch]$Detalhado
)

$ErrorActionPreference = 'Stop'
$VersaoMes = 'MES LION 1.0 JSON'
$VersaoServidor = '1.1.0 (2026-10-19)'
$EhPS7 = $PSVersionTable.PSVersion.Major -ge 6
$EhWindows = ($env:OS -eq 'Windows_NT')
$Utf8 = New-Object System.Text.UTF8Encoding($false)
$Latin1 = [System.Text.Encoding]::GetEncoding(28591)
$Invariante = [System.Globalization.CultureInfo]::InvariantCulture

$Root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if ([string]::IsNullOrWhiteSpace($PastaDados)) { $Dados = Join-Path $Root 'Dados' } else { $Dados = [System.IO.Path]::GetFullPath($PastaDados) }
$ArqEstado = Join-Path $Dados 'MES_LION_DATA.json'
$ArqKv = Join-Path $Dados 'app_storage.json'
$ArqUsuarios = Join-Path $Dados 'usuarios.json'
$ArqAuditoria = Join-Path $Dados 'auditoria.jsonl'
$ArqDocumentos = Join-Path $Dados 'documentos_equipamentos.json'
$ArqAnexos = Join-Path $Dados 'anexos.json'
$ArqPassaportes = Join-Path $Dados 'passaportes_publicados.json'
$ArqTrava = Join-Path $Dados 'servidor_em_execucao.json'
$PastaArquivos = Join-Path $Dados 'arquivos'
$PastaDocumentos = Join-Path $PastaArquivos 'documentos'
$PastaAnexos = Join-Path $PastaArquivos 'anexos'
$PastaPassaportes = Join-Path $PastaArquivos 'passaportes'
$PastaBackups = Join-Path $Dados 'backups'
$PastaLogs = Join-Path $Dados 'logs'
$LimiteCorpo = 300MB
$BackupsAutomaticosMantidos = 14

if (-not $EhPS7) { Add-Type -AssemblyName System.Web.Extensions }
Add-Type -AssemblyName System.IO.Compression

# =====================================================================================================
# Utilitarios gerais
# =====================================================================================================
function Agora { return [DateTimeOffset]::Now.ToString("yyyy-MM-dd'T'HH:mm:ss.ffffffzzz", $Invariante) }

function Escrever-Log([string]$mensagem, [string]$cor = 'Gray', [switch]$Arquivo) {
    $linha = [DateTime]::Now.ToString('dd/MM HH:mm:ss') + '  ' + $mensagem
    try { Write-Host $linha -ForegroundColor $cor } catch { }
    if ($Arquivo) {
        try {
            if (-not [System.IO.Directory]::Exists($PastaLogs)) { [void][System.IO.Directory]::CreateDirectory($PastaLogs) }
            [System.IO.File]::AppendAllText((Join-Path $PastaLogs ('servidor_' + [DateTime]::Now.ToString('yyyyMM') + '.log')), $linha + [Environment]::NewLine, $Utf8)
        } catch { }
    }
}

function Bytes([string]$texto) { return , $Utf8.GetBytes($texto) }

# Texto JSON de uma string (escape completo, rapido mesmo para dezenas de MB).
function Json-Str([string]$s) {
    if ($null -eq $s) { return 'null' }
    $t = $s.Replace('\', '\\').Replace('"', '\"').Replace("`r", '\r').Replace("`n", '\n').Replace("`t", '\t')
    if ($t -match '[\x00-\x1f]') {
        $t = [regex]::Replace($t, '[\x00-\x1f]', { param($m) '\u{0:x4}' -f [int][char]$m.Value })
    }
    return '"' + $t + '"'
}

# Le JSON e devolve Dictionary[string,object] / object[] / valores simples (iguais no PowerShell 5.1 e 7).
if (-not $EhPS7) {
    $script:Jss = New-Object System.Web.Script.Serialization.JavaScriptSerializer
    $script:Jss.MaxJsonLength = [int]::MaxValue
    $script:Jss.RecursionLimit = 1000
}
function Json-Converter($e) {
    switch ($e.ValueKind.ToString()) {
        'Object' {
            $d = New-Object 'System.Collections.Generic.Dictionary[string,object]' ([StringComparer]::Ordinal)
            foreach ($p in $e.EnumerateObject()) { $d[$p.Name] = Json-Converter $p.Value }
            return , $d
        }
        'Array' {
            $l = New-Object System.Collections.ArrayList
            foreach ($i in $e.EnumerateArray()) { [void]$l.Add((Json-Converter $i)) }
            return , ($l.ToArray())
        }
        'String' { return $e.GetString() }
        'Number' {
            $n = 0L; if ($e.TryGetInt64([ref]$n)) { return $n }
            $m = [decimal]0; if ($e.TryGetDecimal([ref]$m)) { return $m }
            return $e.GetDouble()
        }
        'True' { return $true }
        'False' { return $false }
        default { return $null }
    }
}
function Json-Ler([string]$texto) {
    if ($EhPS7) {
        $opc = New-Object System.Text.Json.JsonDocumentOptions
        $opc.MaxDepth = 1000
        $doc = [System.Text.Json.JsonDocument]::Parse($texto, $opc)
        try { return , (Json-Converter $doc.RootElement) } finally { $doc.Dispose() }
    }
    return , ($script:Jss.DeserializeObject($texto))
}
function Json-Texto($objeto, [switch]$Indentado) {
    if ($Indentado) { return (ConvertTo-Json -InputObject $objeto -Depth 50) }
    return (ConvertTo-Json -InputObject $objeto -Depth 50 -Compress)
}
function Novo-Objeto { return , (New-Object System.Collections.Specialized.OrderedDictionary) }

function Eh-Espaco([byte]$b) { return ($b -eq 32 -or $b -eq 10 -or $b -eq 13 -or $b -eq 9) }
# Indices do primeiro e do ultimo caractere nao-branco (ignora BOM UTF-8 no inicio).
function Limites-Json([byte[]]$b) {
    $i = 0
    if ($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF) { $i = 3 }
    while ($i -lt $b.Length -and (Eh-Espaco $b[$i])) { $i++ }
    $j = $b.Length - 1
    while ($j -ge $i -and (Eh-Espaco $b[$j])) { $j-- }
    return @($i, $j)
}
function Eh-ObjetoJson([byte[]]$b) {
    if ($null -eq $b -or $b.Length -lt 2) { return $false }
    $l = Limites-Json $b
    return ($l[1] -gt $l[0] -and $b[$l[0]] -eq 123 -and $b[$l[1]] -eq 125)
}
function Sem-Bom([byte[]]$b) {
    if ($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF) {
        $c = New-Object byte[] ($b.Length - 3)
        [Array]::Copy($b, 3, $c, 0, $c.Length)
        return , $c
    }
    return , $b
}

# Gravacao atomica: arquivo temporario na mesma pasta + troca (nunca deixa o arquivo pela metade).
function Gravar-Atomico([string]$destino, [byte[]]$conteudo) {
    $pasta = [System.IO.Path]::GetDirectoryName($destino)
    if (-not [System.IO.Directory]::Exists($pasta)) { [void][System.IO.Directory]::CreateDirectory($pasta) }
    $tmp = $destino + '.' + [guid]::NewGuid().ToString('N') + '.tmp'
    $fs = New-Object System.IO.FileStream($tmp, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None, 65536, [System.IO.FileOptions]::WriteThrough)
    try { $fs.Write($conteudo, 0, $conteudo.Length); $fs.Flush($true) } finally { $fs.Dispose() }
    for ($tentativa = 1; ; $tentativa++) {
        try {
            if ([System.IO.File]::Exists($destino)) { [System.IO.File]::Replace($tmp, $destino, [NullString]::Value) }
            else { [System.IO.File]::Move($tmp, $destino) }
            return
        } catch {
            # antivirus/sincronizacao podem segurar o arquivo por alguns instantes
            if ($tentativa -ge 12) {
                try { [System.IO.File]::Delete($tmp) } catch { }
                throw
            }
            Start-Sleep -Milliseconds (100 * $tentativa)
        }
    }
}
function Gravar-Texto([string]$destino, [string]$texto) { Gravar-Atomico $destino ($Utf8.GetBytes($texto)) }

function Ler-Lista([string]$arquivo) {
    if (-not [System.IO.File]::Exists($arquivo)) { return , @() }
    $t = [System.IO.File]::ReadAllText($arquivo, $Utf8)
    if ([string]::IsNullOrWhiteSpace($t)) { return , @() }
    $v = Json-Ler $t
    if ($null -eq $v) { return , @() }
    return , @($v)
}
function Salvar-Lista([string]$arquivo, $lista) {
    $l = @($lista)
    if ($l.Count -eq 0) { Gravar-Texto $arquivo '[]'; return }
    Gravar-Texto $arquivo (Json-Texto $l -Indentado)
}

function Ler-UInt32BE([byte[]]$d, [int]$o) { return ([long]$d[$o] -shl 24) -bor ([long]$d[$o + 1] -shl 16) -bor ([long]$d[$o + 2] -shl 8) -bor [long]$d[$o + 3] }
function Escrever-UInt32BE([byte[]]$d, [int]$o, [long]$v) {
    $d[$o] = [byte](($v -shr 24) -band 0xFF); $d[$o + 1] = [byte](($v -shr 16) -band 0xFF)
    $d[$o + 2] = [byte](($v -shr 8) -band 0xFF); $d[$o + 3] = [byte]($v -band 0xFF)
}
function Iguais-TempoConstante([byte[]]$a, [byte[]]$b) {
    if ($a.Length -ne $b.Length) { return $false }
    $dif = 0
    for ($i = 0; $i -lt $a.Length; $i++) { $dif = $dif -bor ($a[$i] -bxor $b[$i]) }
    return ($dif -eq 0)
}
$script:Rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
function Bytes-Aleatorios([int]$n) { $b = New-Object byte[] $n; $script:Rng.GetBytes($b); return , $b }
function Novo-Token { return ([BitConverter]::ToString((Bytes-Aleatorios 32)) -replace '-', '').ToLowerInvariant() }

function Nome-Seguro([string]$nome, [string]$padrao = 'arquivo') {
    $s = $nome
    if ([string]::IsNullOrWhiteSpace($s)) { $s = $padrao }
    $s = [regex]::Replace($s, '[\x00-\x1f<>:"/\\|?*]', '_').Trim()
    if ($s.Length -gt 120) { $s = $s.Substring(0, 120) }
    if ([string]::IsNullOrWhiteSpace($s) -or $s -eq '.' -or $s -eq '..') { return $padrao }
    return $s
}
function Cortar([string]$s, [int]$n) { if ($null -eq $s -or $s.Length -le $n) { return $s }; return $s.Substring(0, $n) }

$TiposArquivo = @{
    '.pdf' = 'application/pdf'; '.xlsx' = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'; '.xls' = 'application/vnd.ms-excel'
    '.jpg' = 'image/jpeg'; '.jpeg' = 'image/jpeg'; '.png' = 'image/png'; '.gif' = 'image/gif'; '.webp' = 'image/webp'; '.svg' = 'image/svg+xml'
    '.doc' = 'application/msword'; '.docx' = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    '.csv' = 'text/csv'; '.txt' = 'text/plain; charset=utf-8'; '.zip' = 'application/zip'; '.html' = 'text/html; charset=utf-8'
}
function Tipo-PorNome([string]$nome) {
    $ext = [System.IO.Path]::GetExtension([string]$nome).ToLowerInvariant()
    if ($TiposArquivo.ContainsKey($ext)) { return $TiposArquivo[$ext] }
    return 'application/octet-stream'
}

function Ip-RedeLocal {
    try {
        foreach ($ni in [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
            if ($ni.OperationalStatus.ToString() -ne 'Up' -or $ni.NetworkInterfaceType.ToString() -eq 'Loopback') { continue }
            foreach ($a in $ni.GetIPProperties().UnicastAddresses) {
                if ($a.Address.AddressFamily.ToString() -eq 'InterNetwork' -and -not [System.Net.IPAddress]::IsLoopback($a.Address) -and -not $a.Address.ToString().StartsWith('169.254.')) { return $a.Address.ToString() }
            }
        }
    } catch { }
    return $null
}

# =====================================================================================================
# Senhas: PBKDF2 (formato ASP.NET Core Identity V3, o mesmo do MES LION AZURE) e bcrypt herdado do PostgreSQL
# =====================================================================================================
function Derivar-Pbkdf2([string]$senha, [byte[]]$sal, [int]$iteracoes, $algoritmo, [int]$tamanho) {
    $kdf = [System.Security.Cryptography.Rfc2898DeriveBytes]::new($Utf8.GetBytes($senha), $sal, $iteracoes, $algoritmo)
    try { return , $kdf.GetBytes($tamanho) } finally { $kdf.Dispose() }
}
function Gerar-HashSenha([string]$senha) {
    $sal = Bytes-Aleatorios 16
    $iteracoes = 100000
    $prf = 2
    try { $sub = Derivar-Pbkdf2 $senha $sal $iteracoes ([System.Security.Cryptography.HashAlgorithmName]::SHA512) 32 }
    catch {
        # .NET Framework anterior a 4.7.2: PBKDF2-HMAC-SHA1 (tambem previsto no formato V3)
        $prf = 0
        $kdf = [System.Security.Cryptography.Rfc2898DeriveBytes]::new($Utf8.GetBytes($senha), $sal, $iteracoes)
        try { $sub = $kdf.GetBytes(32) } finally { $kdf.Dispose() }
    }
    $saida = New-Object byte[] (13 + 16 + 32)
    $saida[0] = 1
    Escrever-UInt32BE $saida 1 $prf
    Escrever-UInt32BE $saida 5 $iteracoes
    Escrever-UInt32BE $saida 9 16
    [Array]::Copy($sal, 0, $saida, 13, 16)
    [Array]::Copy($sub, 0, $saida, 29, 32)
    return [Convert]::ToBase64String($saida)
}
function Verificar-Pbkdf2([string]$senha, [string]$hash) {
    try { $d = [Convert]::FromBase64String($hash) } catch { return $false }
    if ($d.Length -lt 13 -or $d[0] -ne 1) { return $false }
    $prf = Ler-UInt32BE $d 1
    $iteracoes = Ler-UInt32BE $d 5
    $tamanhoSal = Ler-UInt32BE $d 9
    if ($tamanhoSal -lt 16 -or $iteracoes -lt 1 -or $iteracoes -gt 10000000 -or (13 + $tamanhoSal) -ge $d.Length) { return $false }
    $alg = $null
    if ($prf -eq 0) { $alg = [System.Security.Cryptography.HashAlgorithmName]::SHA1 }
    elseif ($prf -eq 1) { $alg = [System.Security.Cryptography.HashAlgorithmName]::SHA256 }
    elseif ($prf -eq 2) { $alg = [System.Security.Cryptography.HashAlgorithmName]::SHA512 }
    else { return $false }
    $sal = New-Object byte[] $tamanhoSal
    [Array]::Copy($d, 13, $sal, 0, $tamanhoSal)
    $esperado = New-Object byte[] ($d.Length - 13 - $tamanhoSal)
    [Array]::Copy($d, 13 + $tamanhoSal, $esperado, 0, $esperado.Length)
    if ($esperado.Length -lt 16) { return $false }
    if ($prf -eq 0) {
        $kdf = [System.Security.Cryptography.Rfc2898DeriveBytes]::new($Utf8.GetBytes($senha), $sal, [int]$iteracoes)
        try { $obtido = $kdf.GetBytes($esperado.Length) } finally { $kdf.Dispose() }
    } else {
        try { $obtido = Derivar-Pbkdf2 $senha $sal ([int]$iteracoes) $alg $esperado.Length }
        catch {
            Escrever-Log 'Senha criada com PBKDF2-SHA256/512, que exige .NET Framework 4.7.2 ou superior (atualize o Windows ou redefina a senha neste computador com REDEFINIR_SENHA.bat).' 'Yellow' -Arquivo
            return $false
        }
    }
    return (Iguais-TempoConstante $obtido $esperado)
}

# ---- bcrypt ($2a$/$2b$/$2y$ do pgcrypto: crypt(senha, gen_salt('bf'))) — para manter as senhas do MES PostgreSQL.
# O laco do Blowfish e compilado em tempo de execucao (System.Linq.Expressions): ~10 ms por verificacao.
# Constantes do Blowfish: digitos hexadecimais de pi (P = 18 palavras, S = 4 x 256 palavras).
$BfHex = (
    '243F6A8885A308D313198A2E03707344A4093822299F31D0082EFA98EC4E6C89452821E638D01377BE5466CF34E90C6CC0AC29B7C97C50DD3F84D5B5B5470917' +
    '9216D5D98979FB1BD1310BA698DFB5AC2FFD72DBD01ADFB7B8E1AFED6A267E96BA7C9045F12C7F9924A19947B3916CF70801F2E2858EFC16636920D871574E69' +
    'A458FEA3F4933D7E0D95748F728EB658718BCD5882154AEE7B54A41DC25A59B59C30D5392AF26013C5D1B023286085F0CA417918B8DB38EF8E79DCB0603A180E' +
    '6C9E0E8BB01E8A3ED71577C1BD314B2778AF2FDA55605C60E65525F3AA55AB945748986263E8144055CA396A2AAB10B6B4CC5C341141E8CEA15486AF7C72E993' +
    'B3EE1411636FBC2A2BA9C55D741831F6CE5C3E169B87931EAFD6BA336C24CF5C7A325381289586773B8F48986B4BB9AFC4BFE81B6628219361D809CCFB21A991' +
    '487CAC605DEC8032EF845D5DE98575B1DC262302EB651B8823893E81D396ACC50F6D6FF383F442392E0B4482A484200469C8F04A9E1F9B5E21C66842F6E96C9A' +
    '670C9C61ABD388F06A51A0D2D8542F68960FA728AB5133A36EEF0B6C137A3BE4BA3BF0507EFB2A98A1F1651D39AF017666CA593E82430E888CEE8619456F9FB4' +
    '7D84A5C33B8B5EBEE06F75D885C12073401A449F56C16AA64ED3AA62363F77061BFEDF72429B023D37D0D724D00A1248DB0FEAD349F1C09B075372C980991B7B' +
    '25D479D8F6E8DEF7E3FE501AB6794C3B976CE0BD04C006BAC1A94FB6409F60C45E5C9EC2196A246368FB6FAF3E6C53B51339B2EB3B52EC6F6DFC511F9B30952C' +
    'CC814544AF5EBD09BEE3D004DE334AFD660F2807192E4BB3C0CBA85745C8740FD20B5F39B9D3FBDB5579C0BD1A60320AD6A100C6402C7279679F25FEFB1FA3CC' +
    '8EA5E9F8DB3222F83C7516DFFD616B152F501EC8AD0552AB323DB5FAFD23876053317B483E00DF829E5C57BBCA6F8CA01A87562EDF1769DBD542A8F6287EFFC3' +
    'AC6732C68C4F5573695B27B0BBCA58C8E1FFA35DB8F011A010FA3D98FD2183B84AFCB56C2DD1D35B9A53E479B6F84565D28E49BC4BFB9790E1DDF2DAA4CB7E33' +
    '62FB1341CEE4C6E8EF20CADA36774C01D07E9EFE2BF11FB495DBDA4DAE909198EAAD8E716B93D5A0D08ED1D0AFC725E08E3C5B2F8E7594B78FF6E2FBF2122B64' +
    '8888B812900DF01C4FAD5EA0688FC31CD1CFF191B3A8C1AD2F2F2218BE0E1777EA752DFE8B021FA1E5A0CC0FB56F74E818ACF3D6CE89E299B4A84FE0FD13E0B7' +
    '7CC43B81D2ADA8D9165FA2668095770593CC7314211A1477E6AD206577B5FA86C75442F5FB9D35CFEBCDAF0C7B3E89A0D6411BD3AE1E7E4900250E2D2071B35E' +
    '226800BB57B8E0AF2464369BF009B91E5563911D59DFA6AA78C14389D95A537F207D5BA202E5B9C5832603766295CFA911C819684E734A41B3472DCA7B14A94A' +
    '1B5100529A532915D60F573FBC9BC6E42B60A47681E6740008BA6FB5571BE91FF296EC6B2A0DD915B6636521E7B9F9B6FF34052EC585566453B02D5DA99F8FA1' +
    '08BA47996E85076A4B7A70E9B5B32944DB75092EC4192623AD6EA6B049A7DF7D9CEE60B88FEDB266ECAA8C71699A17FF5664526CC2B19EE1193602A575094C29' +
    'A0591340E4183A3E3F54989A5B429D656B8FE4D699F73FD6A1D29C07EFE830F54D2D38E6F0255DC14CDD20868470EB266382E9C6021ECC5E09686B3F3EBAEFC9' +
    '3C9718146B6A70A1687F358452A0E286B79C5305AA5007373E07841C7FDEAE5C8E7D44EC5716F2B8B03ADA37F0500C0DF01C1F040200B3FFAE0CF51A3CB574B2' +
    '25837A58DC0921BDD19113F97CA92FF69432477322F547013AE5E58137C2DADCC8B576349AF3DDA7A94461460FD0030EECC8C73EA4751E41E238CD993BEA0E2F' +
    '3280BBA1183EB3314E548B384F6DB9086F420D03F60A04BF2CB8129024977C795679B072BCAF89AFDE9A771FD9930810B38BAE12DCCF3F2E5512721F2E6B7124' +
    '501ADDE69F84CD877A5847187408DA17BC9F9ABCE94B7D8CEC7AEC3ADB851DFA63094366C464C3D2EF1C18473215D908DD433B3724C2BA1612A14D432A65C451' +
    '50940002133AE4DD71DFF89E10314E5581AC77D65F11199B043556F1D7A3C76B3C11183B5924A509F28FE6ED97F1FBFA9EBABF2C1E153C6E86E34570EAE96FB1' +
    '860E5E0A5A3E2AB3771FE71C4E3D06FA2965DCB999E71D0F803E89D65266C8252E4CC9789C10B36AC6150EBA94E2EA78A5FC3C531E0A2DF4F2F74EA7361D2B3D' +
    '1939260F19C279605223A708F71312B6EBADFE6EEAC31F66E3BC4595A67BC883B17F37D1018CFF28C332DDEFBE6C5AA56558218568AB9802EECEA50FDB2F953B' +
    '2AEF7DAD5B6E2F841521B62829076170ECDD4775619F151013CCA830EB61BD960334FE1EAA0363CFB5735C904C70A239D59E9E0BCBAADE14EECC86BC60622CA7' +
    '9CAB5CABB2F3846E648B1EAF19BDF0CAA02369B9655ABB5040685A323C2AB4B3319EE9D5C021B8F79B540B19875FA09995F7997E623D7DA8F837889A97E32D77' +
    '11ED935F166812810E358829C7E61FD696DEDFA17858BA9957F584A51B2272639B83C3FF1AC24696CDB30AEB532E30548FD948E46DBC312858EBF2EF34C6FFEA' +
    'FE28ED61EE7C3C735D4A14D9E864B7E342105D14203E13E045EEE2B6A3AAABEADB6C4F15FACB4FD0C742F442EF6ABBB5654F3B1D41CD2105D81E799E86854DC7' +
    'E44B476A3D816250CF62A1F25B8D2646FC8883A0C1C7B6A37F1524C369CB749247848A0B5692B285095BBF00AD19489D1462B17423820E0058428D2A0C55F5EA' +
    '1DADF43E233F70613372F0928D937E41D65FECF16C223BDB7CDE3759CBEE74604085F2A7CE77326EA607808419F8509EE8EFD85561D99735A969A7AAC50C06C2' +
    '5A04ABFC800BCADC9E447A2EC3453484FDD567050E1E9EC9DB73DBD3105588CD675FDA79E3674340C5C43465713E38D83D28F89EF16DFF20153E21E78FB03D4A' +
    'E6E39F2BDB83ADF7E93D5A68948140F7F64C261C94692934411520F77602D4F7BCF46B2ED4A20068D40824713320F46A43B7D4B7500061AF1E39F62E97244546' +
    '14214F74BF8B88404D95FC1D96B591AF70F4DDD366A02F45BFBC09EC03BD97857FAC6DD031CB850496EB27B355FD3941DA2547E6ABCA0A9A28507825530429F4' +
    '0A2C86DAE9B66DFB68DC1462D7486900680EC0A427A18DEE4F3FFEA2E887AD8CB58CE0067AF4D6B6AACE1E7CD3375FECCE78A399406B2A4220FE9E35D9F385B9' +
    'EE39D7AB3B124E8B1DC9FAF74B6D185626A36631EAE397B23A6EFA74DD5B43326841E7F7CA7820FBFB0AF54ED8FEB397454056ACBA48952755533A3A20838D87' +
    'FE6BA9B7D096954B55A867BCA1159A58CCA9296399E1DB33A62A4A563F3125F95EF47E1C9029317CFDF8E80204272F7080BB155C05282CE395C11548E4C66D22' +
    '48C1133FC70F86DC07F9C9EE41041F0F404779A45D886E17325F51EBD59BC0D1F2BCC18F41113564257B7834602A9C60DFF8E8A31F636C1B0E12B4C202E1329E' +
    'AF664FD1CAD181156B2395E0333E92E13B240B62EEBEB92285B2A20EE6BA0D99DE720C8C2DA2F728D012784595B794FD647D0862E7CCF5F05449A36F877D48FA' +
    'C39DFD27F33E8D1E0A476341992EFF743A6F6EABF4F8FD37A812DC60A1EBDDF8991BE14CDB6E6B0DC67B55106D672C372765D43BDCD0E804F1290DC7CC00FFA3' +
    'B5390F92690FED0B667B9FFBCEDB7D9CA091CF0BD9155EA3BB132F88515BAD247B9479BF763BD6EB37392EB3CC1159798026E297F42E312D6842ADA7C66A2B3B' +
    '12754CCC782EF11C6A124237B79251E706A1BBE64BFB63501A6B101811CAEDFA3D25BDD8E2E1C3C9444216590A121386D90CEC6ED5ABEA2A64AF674EDA86A85F' +
    'BEBFE98864E4C3FE9DBC8057F0F7C08660787BF86003604DD1FD8346F6381FB07745AE04D736FCCC83426B33F01EAB71B08041873C005E5F77A057BEBDE8AE24' +
    '55464299BF582E614E58F48FF2DDFDA2F474EF388789BDC25366F9C3C8B38E74B475F25546FCD9B97AEB26618B1DDF84846A0E79915F95E2466E598E20B45770' +
    '8CD55591C902DE4CB90BACE1BB8205D011A862487574A99EB77F19B6E0A9DC09662D09A1C4324633E85A1F0209F0BE8C4A99A0251D6EFE101AB93D1D0BA5A4DF' +
    'A186F20F2868F169DCB7DA83573906FEA1E2CE9B4FCD7F5250115E01A70683FAA002B5C40DE6D0279AF88C27773F8641C3604C0661A806B5F0177A28C0F586E0' +
    '006058AA30DC7D6211E69ED72338EA6353C2DD94C2C21634BBCBEE5690BCB6DEEBFC7DA1CE591D766F05E4094B7C018839720A3D7C927C2486E3725F724D9DB9' +
    '1AC15BB4D39EB8FCED54557808FCA5B5D83D7CD34DAD0FC41E50EF5EB161E6F8A28514D96C51133C6FD5C7E756E14EC4362ABFCEDDC6C837D79A323492638212' +
    '670EFA8E406000E03A39CE37D3FAF5CFABC277375AC52D1B5CB0679E4FA33742D382274099BC9BBED5118E9DBF0F7315D62D1C7EC700C47BB78C1B6B21A19045' +
    'B26EB1BE6A366EB45748AB2FBC946E79C6A376D26549C2C8530FF8EE468DDE7DD5730A1D4CD04DC62939BBDBA9BA4650AC9526E8BE5EE304A1FAD5F06A2D519A' +
    '63EF8CE29A86EE22C089C2B843242EF6A51E03AA9CF2D0A483C061BA9BE96A4D8FE51550BA645BD62826A2F9A73A3AE14BA99586EF5562E9C72FEFD3F752F7DA' +
    '3F046F6977FA0A5980E4A91587B086019B09E6AD3B3EE593E990FD5A9E34D7972CF0B7D9022B8B5196D5AC3A017DA67DD1CF3ED67C7D2D281F9F25CFADF2B89B' +
    '5AD6B4725A88F54CE029AC71E019A5E647B0ACFDED93FA9BE8D3C48D283B57CCF8D5662979132E28785F0191ED756055F7960E44E3D35E8C15056DD488F46DBA' +
    '03A161250564F0BDC3EB9E153C9057A297271AECA93A072A1B3F6D9B1E6321F5F59C66FB26DCF3197533D928B155FDF5035634828ABA3CBB28517711C20AD9F8' +
    'ABCC5167CCAD925F4DE817513830DC8E379D58629320F991EA7A90C2FB3E7BCE5121CE64774FBE32A8B6E37EC3293D4648DE53696413E680A2AE0810DD6DB224' +
    '69852DFD09072166B39A460A6445C0DD586CDECF1C20C8AE5BBEF7DD1B588D40CCD2017F6BB4E3BBDDA26A7E3A59FF453E350A44BCB4CDD572EACEA8FA6484BB' +
    '8D6612AEBF3C6F47D29BE463542F5D9EAEC2771BF64E6370740E0D8DE75B1357F8721671AF537D5D4040CB084EB4E2CC34D2466A0115AF84E1B0042895983A1D' +
    '06B89FB4CE6EA0486F3F3B823520AB82011A1D4B277227F8611560B1E7933FDCBB3A792B344525BDA08839E151CE794B2F32C9B7A01FBAC9E01CC87EBCC7D1F6' +
    'CF0111C3A1E8AAC71A908749D44FBD9AD0DADECBD50ADA380339C32AC69136678DF9317CE0B12B4FF79E59B743F5BB3AF2D519FF27D9459CBF97222C15E6FC2A' +
    '0F91FC719B941525FAE59361CEB69CEBC2A8645912BAA8D1B6C1075EE3056A0C10D25065CB03A442E0EC6E0E1698DB3B4C98A0BE3278E9649F1F9532E0D392DF' +
    'D3A0342B8971F21E1B0A74414BA3348CC5BE7120C37632D8DF359F8D9B992F2EE60B6F470FE3F11DE54CDA541EDAD891CE6279CFCD3E7E6F1618B166FD2C1D05' +
    '848FD2C5F6FB2299F523F357A632762393A8353156CCCD02ACF081625A75EBB56E16369788D273CCDE96629281B949D04C50901B71C65614E6C6C7BD327A140A' +
    '45E1D006C3F27B9AC9AA53FD62A80F00BB25BFE235BDD2F671126905B2040222B6CBCF7CCD769C2B53113EC01640E3D338ABBD602547ADF0BA38209CF746CE76' +
    '77AFA1C52075606085CBFE4E8AE88DD87AAAF9B04CF9AA7E1948C25C02FB8A8C01C36AE4D6EBE1F990D4F869A65CDEA03F09252DC208E69FB74E6132CE77E25B' +
    '578FDFE33AC372E6'
)
$script:Bcrypt = $null
function Bcrypt-Preparar {
    if ($script:Bcrypt) { return }
    $pal = New-Object 'uint32[]' 1042
    for ($i = 0; $i -lt 1042; $i++) { $pal[$i] = [Convert]::ToUInt32($BfHex.Substring($i * 8, 8), 16) }
    $P0 = New-Object 'uint32[]' 18; [Array]::Copy($pal, 0, $P0, 0, 18)
    $S0 = New-Object 'uint32[]' 1024; [Array]::Copy($pal, 18, $S0, 0, 1024)
    try {
        $E = [System.Linq.Expressions.Expression]
        $tU = [uint32]; $tUA = [uint32[]]; $tI = [int]
        $tExp = [System.Linq.Expressions.Expression[]]
        $pP = $E::Parameter($tUA, 'P'); $pS = $E::Parameter($tUA, 'S'); $pK = $E::Parameter($tUA, 'K'); $pZ = $E::Parameter($tUA, 'Z'); $pD = $E::Parameter($tUA, 'D')
        $l = $E::Variable($tU, 'l'); $r = $E::Variable($tU, 'r'); $xl = $E::Variable($tU, 'xl'); $xr = $E::Variable($tU, 'xr')
        $i = $E::Variable($tI, 'i'); $j = $E::Variable($tI, 'j')
        $m255 = $E::Constant([uint32]255)
        $sIdx = { param($base, $v) $E::ArrayIndex($pS, $E::Add($E::Constant([int]$base), $E::Convert($v, $tI))) }
        $F = { param($x)
            $a = $E::ArrayIndex($pS, $E::Convert($E::RightShift($x, $E::Constant(24)), $tI))
            $b = & $sIdx 256 ($E::And($E::RightShift($x, $E::Constant(16)), $m255))
            $c = & $sIdx 512 ($E::And($E::RightShift($x, $E::Constant(8)), $m255))
            $d = & $sIdx 768 ($E::And($x, $m255))
            $E::Add($E::ExclusiveOr($E::Add($a, $b), $c), $d)
        }
        $pIdx = { param($n) $E::ArrayIndex($pP, $E::Constant([int]$n)) }
        # cifragem Blowfish de (l, r), 16 rodadas desenroladas
        $cif = New-Object 'System.Collections.Generic.List[System.Linq.Expressions.Expression]'
        $cif.Add($E::Assign($xl, $E::ExclusiveOr($l, (& $pIdx 0))))
        $cif.Add($E::Assign($xr, $r))
        for ($k = 1; $k -le 16; $k += 2) {
            $cif.Add($E::Assign($xr, $E::ExclusiveOr($xr, $E::ExclusiveOr((& $F $xl), (& $pIdx $k)))))
            $cif.Add($E::Assign($xl, $E::ExclusiveOr($xl, $E::ExclusiveOr((& $F $xr), (& $pIdx ($k + 1))))))
        }
        $cif.Add($E::Assign($xr, $E::ExclusiveOr($xr, (& $pIdx 17))))
        $cif.Add($E::Assign($l, $xr))
        $cif.Add($E::Assign($r, $xl))
        $blocoCif = $E::Block([System.Linq.Expressions.Expression[]]$cif.ToArray())
        # Expandir(P, S, K[18], Z[4] ou null): P ^= K; preenche P e S cifrando (l, r); com Z, aplica o sal (EksBlowfishSetup)
        $corpo = New-Object 'System.Collections.Generic.List[System.Linq.Expressions.Expression]'
        for ($k = 0; $k -lt 18; $k++) {
            $el = $E::ArrayAccess($pP, [System.Linq.Expressions.Expression[]]@($E::Constant($k)))
            $corpo.Add($E::Assign($el, $E::ExclusiveOr($el, $E::ArrayIndex($pK, $E::Constant($k)))))
        }
        $corpo.Add($E::Assign($l, $E::Constant([uint32]0)))
        $corpo.Add($E::Assign($r, $E::Constant([uint32]0)))
        $corpo.Add($E::Assign($j, $E::Constant(0)))
        $passoSal = $E::IfThen($E::NotEqual($pZ, $E::Constant($null, $tUA)), $E::Block([System.Linq.Expressions.Expression[]]@(
                    $E::Assign($l, $E::ExclusiveOr($l, $E::ArrayIndex($pZ, $j))),
                    $E::Assign($r, $E::ExclusiveOr($r, $E::ArrayIndex($pZ, $E::Add($j, $E::Constant(1))))),
                    $E::Assign($j, $E::And($E::Add($j, $E::Constant(2)), $E::Constant(3)))
                )))
        foreach ($alvo in @(@($pP, 18), @($pS, 1024))) {
            $arr = $alvo[0]; $lim = [int]$alvo[1]
            $fim = $E::Label('fim' + $lim)
            $corpo.Add($E::Assign($i, $E::Constant(0)))
            $corpo.Add($E::Loop($E::Block([System.Linq.Expressions.Expression[]]@(
                            $E::IfThen($E::GreaterThanOrEqual($i, $E::Constant($lim)), $E::Break($fim)),
                            $passoSal,
                            $blocoCif,
                            $E::Assign($E::ArrayAccess($arr, [System.Linq.Expressions.Expression[]]@($i)), $l),
                            $E::Assign($E::ArrayAccess($arr, [System.Linq.Expressions.Expression[]]@($E::Add($i, $E::Constant(1)))), $r),
                            $E::AddAssign($i, $E::Constant(2))
                        )), $fim))
        }
        $vars = [System.Linq.Expressions.ParameterExpression[]]@($l, $r, $xl, $xr, $i, $j)
        $lam = $E::Lambda($E::GetActionType([Type[]]@($tUA, $tUA, $tUA, $tUA)), $E::Block($vars, [System.Linq.Expressions.Expression[]]$corpo.ToArray()), [System.Linq.Expressions.ParameterExpression[]]@($pP, $pS, $pK, $pZ))
        # Cifrar(P, S, D[6]): cifra os 3 blocos de D (texto "OrpheanBeholderScryDoubt")
        $c2 = New-Object 'System.Collections.Generic.List[System.Linq.Expressions.Expression]'
        foreach ($b in 0, 2, 4) {
            $c2.Add($E::Assign($l, $E::ArrayIndex($pD, $E::Constant($b))))
            $c2.Add($E::Assign($r, $E::ArrayIndex($pD, $E::Constant($b + 1))))
            $c2.Add($blocoCif)
            $c2.Add($E::Assign($E::ArrayAccess($pD, [System.Linq.Expressions.Expression[]]@($E::Constant($b))), $l))
            $c2.Add($E::Assign($E::ArrayAccess($pD, [System.Linq.Expressions.Expression[]]@($E::Constant($b + 1))), $r))
        }
        $lam2 = $E::Lambda($E::GetActionType([Type[]]@($tUA, $tUA, $tUA)), $E::Block($vars, [System.Linq.Expressions.Expression[]]$c2.ToArray()), [System.Linq.Expressions.ParameterExpression[]]@($pP, $pS, $pD))
        $script:Bcrypt = @{ P = $P0; S = $S0; Expandir = $lam.Compile(); Cifrar = $lam2.Compile(); Compilado = $true }
    } catch {
        Escrever-Log ('bcrypt: compilação indisponível, usando a versão em PowerShell (mais lenta): ' + $_.Exception.Message) 'Yellow' -Arquivo
        $script:Bcrypt = @{ P = $P0; S = $S0; Compilado = $false }
    }
}
# Versao em PowerShell puro (usada so se a compilacao falhar): mesmo resultado, ~10-30 s por verificacao.
function Bf-ExpandirPS([uint32[]]$P, [uint32[]]$S, [uint32[]]$K, [uint32[]]$Z) {
    $M = 4294967295
    for ($n = 0; $n -lt 18; $n++) { $P[$n] = [uint32]([long]$P[$n] -bxor [long]$K[$n]) }
    $l = 0L; $r = 0L; $jz = 0
    foreach ($alvo in @(@($P, 18), @($S, 1024))) {
        $arr = $alvo[0]; $lim = $alvo[1]
        for ($n = 0; $n -lt $lim; $n += 2) {
            if ($null -ne $Z) { $l = $l -bxor [long]$Z[$jz]; $r = $r -bxor [long]$Z[$jz + 1]; $jz = ($jz + 2) -band 3 }
            $res = Bf-CifrarPS $P $S $l $r
            $l = $res[0]; $r = $res[1]
            $arr[$n] = [uint32]$l; $arr[$n + 1] = [uint32]$r
        }
    }
}
function Bf-CifrarPS([uint32[]]$P, [uint32[]]$S, [long]$l, [long]$r) {
    $M = 4294967295
    $xl = $l -bxor $P[0]; $xr = $r
    for ($i = 1; $i -le 16; $i += 2) {
        $xr = $xr -bxor ((((([long]$S[$xl -shr 24] + [long]$S[256 + (($xl -shr 16) -band 255)]) -band $M) -bxor [long]$S[512 + (($xl -shr 8) -band 255)]) + [long]$S[768 + ($xl -band 255)]) -band $M) -bxor [long]$P[$i]
        $xl = $xl -bxor ((((([long]$S[$xr -shr 24] + [long]$S[256 + (($xr -shr 16) -band 255)]) -band $M) -bxor [long]$S[512 + (($xr -shr 8) -band 255)]) + [long]$S[768 + ($xr -band 255)]) -band $M) -bxor [long]$P[$i + 1]
    }
    $xr = $xr -bxor [long]$P[17]
    return @($xr, $xl)
}
$B64Bcrypt = './ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
function Bcrypt-B64Decodificar([string]$s, [int]$max) {
    $saida = New-Object 'System.Collections.Generic.List[byte]'
    $off = 0
    while ($off -lt $s.Length - 1 -and $saida.Count -lt $max) {
        $c1 = $B64Bcrypt.IndexOf($s[$off]); $c2 = $B64Bcrypt.IndexOf($s[$off + 1]); $off += 2
        if ($c1 -lt 0 -or $c2 -lt 0) { break }
        $saida.Add([byte]((($c1 -shl 2) -bor (($c2 -band 0x30) -shr 4)) -band 0xFF))
        if ($saida.Count -ge $max -or $off -ge $s.Length) { break }
        $c3 = $B64Bcrypt.IndexOf($s[$off]); $off++
        if ($c3 -lt 0) { break }
        $saida.Add([byte](((($c2 -band 0x0F) -shl 4) -bor (($c3 -band 0x3C) -shr 2)) -band 0xFF))
        if ($saida.Count -ge $max -or $off -ge $s.Length) { break }
        $c4 = $B64Bcrypt.IndexOf($s[$off]); $off++
        if ($c4 -lt 0) { break }
        $saida.Add([byte](((($c3 -band 0x03) -shl 6) -bor $c4) -band 0xFF))
    }
    return , $saida.ToArray()
}
function Bcrypt-B64Codificar([byte[]]$d, [int]$tamanho) {
    $sb = New-Object System.Text.StringBuilder
    $off = 0
    while ($off -lt $tamanho) {
        $c1 = [int]$d[$off]; $off++
        [void]$sb.Append($B64Bcrypt[($c1 -shr 2) -band 0x3F])
        $c1 = ($c1 -band 0x03) -shl 4
        if ($off -ge $tamanho) { [void]$sb.Append($B64Bcrypt[$c1 -band 0x3F]); break }
        $c2 = [int]$d[$off]; $off++
        $c1 = $c1 -bor (($c2 -shr 4) -band 0x0F)
        [void]$sb.Append($B64Bcrypt[$c1 -band 0x3F])
        $c1 = ($c2 -band 0x0F) -shl 2
        if ($off -ge $tamanho) { [void]$sb.Append($B64Bcrypt[$c1 -band 0x3F]); break }
        $c2 = [int]$d[$off]; $off++
        $c1 = $c1 -bor (($c2 -shr 6) -band 0x03)
        [void]$sb.Append($B64Bcrypt[$c1 -band 0x3F])
        [void]$sb.Append($B64Bcrypt[$c2 -band 0x3F])
    }
    return $sb.ToString()
}
function Palavras-Ciclicas([byte[]]$dados, [int]$n) {
    $p = New-Object 'uint32[]' $n
    $pos = 0
    for ($i = 0; $i -lt $n; $i++) {
        $w = 0L
        for ($k = 0; $k -lt 4; $k++) { $w = (($w -shl 8) -band 4294967295) -bor [long]$dados[$pos]; $pos = ($pos + 1) % $dados.Length }
        $p[$i] = [uint32]$w
    }
    return , $p
}
function Eh-HashBcrypt([string]$h) { return ($null -ne $h -and $h.Length -eq 60 -and $h[0] -eq '$' -and $h[1] -eq '2' -and $h[3] -eq '$' -and $h[6] -eq '$') }
function Verificar-Bcrypt([string]$senha, [string]$hash) {
    if (-not (Eh-HashBcrypt $hash)) { return $false }
    # $2x$ (modo de compatibilidade com o erro antigo do crypt_blowfish) nao e suportado
    if (@('a', 'b', 'y') -cnotcontains [string]$hash[2]) { return $false }
    $custo = 0
    if (-not [int]::TryParse($hash.Substring(4, 2), [ref]$custo) -or $custo -lt 4 -or $custo -gt 31) { return $false }
    $sal = Bcrypt-B64Decodificar $hash.Substring(7, 22) 16
    if ($sal.Length -ne 16) { return $false }
    # chave = bytes UTF-8 da senha + terminador NUL, no maximo 72 bytes (como o pgcrypto)
    $sb = $Utf8.GetBytes($senha)
    $n = [Math]::Min($sb.Length + 1, 72)
    $chave = New-Object byte[] $n
    [Array]::Copy($sb, $chave, [Math]::Min($sb.Length, $n))
    Bcrypt-Preparar
    $P = [uint32[]]$script:Bcrypt.P.Clone(); $S = [uint32[]]$script:Bcrypt.S.Clone()
    $K = Palavras-Ciclicas $chave 18
    $KS = Palavras-Ciclicas $sal 18
    $Z = Palavras-Ciclicas $sal 4
    $rodadas = [long]1 -shl $custo
    $D = [uint32[]]@(0x4F727068, 0x65616E42, 0x65686F6C, 0x64657253, 0x63727944, 0x6F756274)
    if ($script:Bcrypt.Compilado) {
        $exp = $script:Bcrypt.Expandir
        $exp.Invoke($P, $S, $K, $Z)
        for ($t = 0L; $t -lt $rodadas; $t++) { $exp.Invoke($P, $S, $K, $null); $exp.Invoke($P, $S, $KS, $null) }
        $cifrar = $script:Bcrypt.Cifrar
        for ($t = 0; $t -lt 64; $t++) { $cifrar.Invoke($P, $S, $D) }
    } else {
        Bf-ExpandirPS $P $S $K $Z
        for ($t = 0L; $t -lt $rodadas; $t++) { Bf-ExpandirPS $P $S $K $null; Bf-ExpandirPS $P $S $KS $null }
        for ($t = 0; $t -lt 64; $t++) {
            foreach ($b in 0, 2, 4) { $res = Bf-CifrarPS $P $S ([long]$D[$b]) ([long]$D[$b + 1]); $D[$b] = [uint32]$res[0]; $D[$b + 1] = [uint32]$res[1] }
        }
    }
    $saida = New-Object byte[] 24
    for ($t = 0; $t -lt 6; $t++) {
        $saida[$t * 4] = [byte](($D[$t] -shr 24) -band 0xFF); $saida[$t * 4 + 1] = [byte](($D[$t] -shr 16) -band 0xFF)
        $saida[$t * 4 + 2] = [byte](($D[$t] -shr 8) -band 0xFF); $saida[$t * 4 + 3] = [byte]($D[$t] -band 0xFF)
    }
    $obtido = [System.Text.Encoding]::ASCII.GetBytes((Bcrypt-B64Codificar $saida 23))
    $esperado = [System.Text.Encoding]::ASCII.GetBytes($hash.Substring(29))
    return (Iguais-TempoConstante $obtido $esperado)
}
# 'ok' | 'atualizar' (senha certa com hash antigo: converter para PBKDF2) | 'falhou'
function Verificar-Senha([string]$senha, [string]$hash) {
    if ([string]::IsNullOrEmpty($hash) -or $hash.StartsWith('!')) { return 'falhou' }
    if (Eh-HashBcrypt $hash) { if (Verificar-Bcrypt $senha $hash) { return 'atualizar' }; return 'falhou' }
    if (Verificar-Pbkdf2 $senha $hash) { return 'ok' }
    return 'falhou'
}

# =====================================================================================================
# Dados: estado do MES, app_storage, usuarios, historico, documentos, anexos, passaportes, backups
# =====================================================================================================
# Estado (bytes UTF-8 sem BOM) ou $null quando nao ha dados (o navegador carrega os dados iniciais de js/data.js).
function Ler-EstadoBytes {
    if (-not [System.IO.File]::Exists($ArqEstado)) { return $null }
    $b = [System.IO.File]::ReadAllBytes($ArqEstado)
    if ($b.Length -eq 0) { return $null }
    $b = Sem-Bom $b
    if (-not (Eh-ObjetoJson $b)) { return $null }
    if ($b.Length -lt 64) { $t = $Utf8.GetString($b) -replace '\s', ''; if ($t -eq '{}') { return $null } }
    return , $b
}
function Ler-Kv {
    $d = New-Object 'System.Collections.Generic.Dictionary[string,string]' ([StringComparer]::Ordinal)
    if ([System.IO.File]::Exists($ArqKv)) {
        $t = [System.IO.File]::ReadAllText($ArqKv, $Utf8)
        if (-not [string]::IsNullOrWhiteSpace($t)) {
            $o = Json-Ler $t
            foreach ($k in @($o.Keys)) {
                $v = $o[$k]
                if ($null -eq $v) { $d[$k] = '' } elseif ($v -is [string]) { $d[$k] = $v } else { $d[$k] = (Json-Texto $v) }
            }
        }
    }
    return , $d
}
function Kv-Json($d) {
    $partes = New-Object 'System.Collections.Generic.List[string]'
    foreach ($k in $d.Keys) { $partes.Add((Json-Str $k) + ':' + (Json-Str $d[$k])) }
    return '{' + [string]::Join(',', $partes) + '}'
}
function Salvar-Kv($d) { Gravar-Texto $ArqKv (Kv-Json $d) }

function Ler-Usuarios { return , (Ler-Lista $ArqUsuarios) }
function Salvar-Usuarios($lista) { Salvar-Lista $ArqUsuarios $lista }
function Usuario-Ativo($u) { $a = $u['active']; return ($a -eq $true -or [string]$a -eq 'true' -or [string]$a -eq 'True' -or [string]$a -eq '1') }

function Acrescentar-Linha([string]$arquivo, [string]$linha) {
    $prefixo = ''
    if ([System.IO.File]::Exists($arquivo)) {
        $fs = [System.IO.File]::Open($arquivo, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        try { if ($fs.Length -gt 0) { [void]$fs.Seek(-1, [System.IO.SeekOrigin]::End); if ($fs.ReadByte() -ne 10) { $prefixo = "`n" } } } finally { $fs.Dispose() }
    }
    [System.IO.File]::AppendAllText($arquivo, $prefixo + $linha + "`n", $Utf8)
}
# Historico de Modificacoes: mesmo formato da tabela audit_log do original (GET /api/audit).
function Auditar($u, [string]$modulo, [string]$acao, [string]$chave = '', $detalhes = $null) {
    if ($null -eq $u) { return }
    try {
        if ($null -eq $detalhes) { $detalhes = Novo-Objeto }
        $reg = Novo-Objeto
        $reg['username'] = [string]$u.username
        $reg['module'] = $modulo
        $reg['action'] = $acao
        $reg['record_key'] = $chave
        $reg['changed_at'] = Agora
        $reg['details'] = $detalhes
        Acrescentar-Linha $ArqAuditoria (Json-Texto $reg)
    } catch { Escrever-Log ('Falha ao gravar o histórico: ' + $_.Exception.Message) 'Red' -Arquivo }
}
function Ler-UltimasLinhas([string]$arquivo, [int]$maximo) {
    if (-not [System.IO.File]::Exists($arquivo)) { return , @() }
    $fs = [System.IO.File]::Open($arquivo, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
    try {
        $tam = $fs.Length
        if ($tam -eq 0) { return , @() }
        $bloco = 262144L
        while ($true) {
            $ini = [Math]::Max(0L, $tam - $bloco)
            $n = [int]($tam - $ini)
            $buf = New-Object byte[] $n
            [void]$fs.Seek($ini, [System.IO.SeekOrigin]::Begin)
            $lidos = 0
            while ($lidos -lt $n) { $k = $fs.Read($buf, $lidos, $n - $lidos); if ($k -le 0) { break }; $lidos += $k }
            $partes = $Utf8.GetString($buf, 0, $lidos).Split([char]10)
            $inicio = 0
            if ($ini -gt 0) { $inicio = 1 }   # a primeira linha pode estar cortada
            $linhas = New-Object 'System.Collections.Generic.List[string]'
            for ($x = $inicio; $x -lt $partes.Length; $x++) { $t = $partes[$x].Trim(); if ($t.Length -gt 0) { $linhas.Add($t) } }
            if ($linhas.Count -ge $maximo -or $ini -eq 0) {
                if ($linhas.Count -gt $maximo) { $linhas = $linhas.GetRange($linhas.Count - $maximo, $maximo) }
                return , $linhas.ToArray()
            }
            $bloco = $bloco * 4
        }
    } finally { $fs.Dispose() }
}
function Auditoria-Json([int]$maximo = 500) {
    $linhas = Ler-UltimasLinhas $ArqAuditoria $maximo
    $validas = New-Object 'System.Collections.Generic.List[string]'
    for ($x = $linhas.Length - 1; $x -ge 0; $x--) { $t = $linhas[$x]; if ($t.StartsWith('{') -and $t.EndsWith('}')) { $validas.Add($t) } }
    $texto = '[' + [string]::Join(',', $validas) + ']'
    try { [void](Json-Ler $texto); return $texto } catch { }
    # alguma linha corrompida (ex.: desligamento no meio da gravacao): devolve so as validas
    $ok = New-Object 'System.Collections.Generic.List[string]'
    foreach ($t in $validas) { try { [void](Json-Ler $t); $ok.Add($t) } catch { } }
    return '[' + [string]::Join(',', $ok) + ']'
}

# ---- exportacao / backup no formato MES_LION_JSON_DATABASE (o mesmo do menu Banco do MES)
function Montar-Exportacao {
    $estado = Ler-EstadoBytes
    if ($null -eq $estado) { $estado = Bytes '{}' }
    $inicio = '{"schemaVersion":39,"format":"MES_LION_JSON_DATABASE","updatedAt":' + (Json-Str ([DateTimeOffset]::Now.ToString("yyyy-MM-dd'T'HH:mm:sszzz", $Invariante))) +
    ',"exportedBy":"' + $VersaoMes + ' (PowerShell)","appStorage":' + (Kv-Json (Ler-Kv)) + ',"data":'
    $ms = New-Object System.IO.MemoryStream ($estado.Length + 65536)
    $b1 = Bytes $inicio
    $ms.Write($b1, 0, $b1.Length)
    $ms.Write($estado, 0, $estado.Length)
    $ms.WriteByte(125)
    return , $ms.ToArray()
}
$script:UltimoBackupDiario = $null
function Criar-Backup([string]$motivo, $u) {
    if (-not [System.IO.Directory]::Exists($PastaBackups)) { [void][System.IO.Directory]::CreateDirectory($PastaBackups) }
    $nome = 'MES_LION_BACKUP_' + [DateTime]::Now.ToString('yyyyMMdd_HHmmss_fff') + '_' + $motivo
    $destino = Join-Path $PastaBackups ($nome + '.zip')
    $conteudo = Montar-Exportacao
    $tmp = $destino + '.tmp'
    $fs = [System.IO.File]::Open($tmp, [System.IO.FileMode]::Create, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
    try {
        $zip = [System.IO.Compression.ZipArchive]::new($fs, [System.IO.Compression.ZipArchiveMode]::Create, $true)
        try {
            $ent = $zip.CreateEntry($nome + '.json', [System.IO.Compression.CompressionLevel]::Optimal)
            $es = $ent.Open()
            try { $es.Write($conteudo, 0, $conteudo.Length) } finally { $es.Dispose() }
        } finally { $zip.Dispose() }
    } finally { $fs.Dispose() }
    if ([System.IO.File]::Exists($destino)) { [System.IO.File]::Delete($destino) }
    [System.IO.File]::Move($tmp, $destino)
    $tamanho = (New-Object System.IO.FileInfo($destino)).Length
    if ($motivo.StartsWith('automatico')) {
        # mantem somente os backups automaticos mais recentes (manuais e de importacao ficam)
        $autos = @([System.IO.Directory]::GetFiles($PastaBackups, 'MES_LION_BACKUP_*_automatico*.zip') | Sort-Object)
        if ($autos.Count -gt $BackupsAutomaticosMantidos) {
            foreach ($velho in $autos[0..($autos.Count - $BackupsAutomaticosMantidos - 1)]) { try { [System.IO.File]::Delete($velho) } catch { } }
        }
    }
    $usuario = ''
    if ($u) { $usuario = ' por ' + $u.username }
    Escrever-Log ("Backup criado ($motivo$usuario): " + $destino) 'DarkCyan' -Arquivo
    return @{ nome = $nome + '.zip'; caminho = $destino; bytes = $tamanho }
}
function Backup-DiarioSeNecessario {
    $hoje = [DateTime]::Now.ToString('yyyyMMdd')
    if ($script:UltimoBackupDiario -eq $hoje) { return }
    if ($null -eq $script:UltimoBackupDiario) {
        $existentes = @()
        if ([System.IO.Directory]::Exists($PastaBackups)) { $existentes = @([System.IO.Directory]::GetFiles($PastaBackups, ('MES_LION_BACKUP_' + $hoje + '_*_automatico*.zip'))) }
        if ($existentes.Count -gt 0) { $script:UltimoBackupDiario = $hoje; return }
    }
    if ($null -ne (Ler-EstadoBytes)) { [void](Criar-Backup 'automatico_diario' $null) }
    $script:UltimoBackupDiario = $hoje
}

# Arquivo de banco para importar: envelope MES_LION_JSON_DATABASE ({format, data, appStorage}) ou objeto de estado.
# Devolve @{ estado = byte[]; kv = Dictionary ou $null; formato = '...' } ou lanca erro com mensagem para o usuario.
function Ler-ArquivoBanco([byte[]]$conteudo) {
    $b = Sem-Bom $conteudo
    if (-not (Eh-ObjetoJson $b)) { throw (New-Object System.FormatException 'O arquivo não é um banco do MES (JSON inválido ou incompleto).') }
    if ($EhPS7) {
        $opc = New-Object System.Text.Json.JsonDocumentOptions
        $opc.MaxDepth = 1000
        try { $doc = [System.Text.Json.JsonDocument]::Parse([System.ReadOnlyMemory[byte]]::new($b), $opc) }
        catch { throw (New-Object System.FormatException ('O arquivo não é um JSON válido: ' + $_.Exception.Message)) }
        try {
            $raiz = $doc.RootElement
            if ($raiz.ValueKind.ToString() -ne 'Object') { throw (New-Object System.FormatException 'O banco do MES deve ser um objeto JSON.') }
            $chaves = New-Object 'System.Collections.Generic.List[string]'
            foreach ($p in $raiz.EnumerateObject()) { $chaves.Add($p.Name) }
            $fmt = New-Object System.Text.Json.JsonElement
            $ehEnv = $raiz.TryGetProperty('format', [ref]$fmt) -and $fmt.ValueKind.ToString() -eq 'String' -and $fmt.GetString() -eq 'MES_LION_JSON_DATABASE'
            if (-not $ehEnv) { return @{ estado = $b; kv = $null; formato = 'ESTADO'; chaves = $chaves.ToArray() } }
            $dat = New-Object System.Text.Json.JsonElement
            if (-not $raiz.TryGetProperty('data', [ref]$dat) -or $dat.ValueKind.ToString() -ne 'Object') { throw (New-Object System.FormatException "Arquivo MES_LION_JSON_DATABASE sem a propriedade 'data'.") }
            $kv = $null
            $as = New-Object System.Text.Json.JsonElement
            if ($raiz.TryGetProperty('appStorage', [ref]$as) -and $as.ValueKind.ToString() -eq 'Object') {
                $kv = New-Object 'System.Collections.Generic.Dictionary[string,string]' ([StringComparer]::Ordinal)
                foreach ($p in $as.EnumerateObject()) { if ($p.Value.ValueKind.ToString() -eq 'String') { $kv[$p.Name] = $p.Value.GetString() } else { $kv[$p.Name] = $p.Value.GetRawText() } }
            }
            return @{ estado = (Bytes $dat.GetRawText()); kv = $kv; formato = 'MES_LION_JSON_DATABASE'; chaves = $chaves.ToArray() }
        } finally { $doc.Dispose() }
    }
    try { $o = $script:Jss.DeserializeObject($Utf8.GetString($b)) }
    catch { throw (New-Object System.FormatException ('O arquivo não é um JSON válido: ' + $_.Exception.Message)) }
    if (-not ($o -is [System.Collections.Generic.Dictionary[string,object]])) { throw (New-Object System.FormatException 'O banco do MES deve ser um objeto JSON.') }
    $chaves = @($o.Keys)
    if (-not ($o.ContainsKey('format') -and [string]$o['format'] -ceq 'MES_LION_JSON_DATABASE')) { return @{ estado = $b; kv = $null; formato = 'ESTADO'; chaves = $chaves } }
    if (-not ($o.ContainsKey('data') -and $o['data'] -is [System.Collections.Generic.Dictionary[string,object]])) { throw (New-Object System.FormatException "Arquivo MES_LION_JSON_DATABASE sem a propriedade 'data'.") }
    $kv = $null
    if ($o.ContainsKey('appStorage') -and $o['appStorage'] -is [System.Collections.Generic.Dictionary[string,object]]) {
        $kv = New-Object 'System.Collections.Generic.Dictionary[string,string]' ([StringComparer]::Ordinal)
        foreach ($k in @($o['appStorage'].Keys)) { $v = $o['appStorage'][$k]; if ($v -is [string]) { $kv[$k] = $v } elseif ($null -eq $v) { $kv[$k] = '' } else { $kv[$k] = $script:Jss.Serialize($v) } }
    }
    return @{ estado = (Bytes ($script:Jss.Serialize($o['data']))); kv = $kv; formato = 'MES_LION_JSON_DATABASE'; chaves = $chaves }
}

# =====================================================================================================
# HTTP (TcpListener: nao exige administrador nem reserva de URL)
# =====================================================================================================
$Motivos = @{ 100 = 'Continue'; 200 = 'OK'; 400 = 'Bad Request'; 401 = 'Unauthorized'; 403 = 'Forbidden'; 404 = 'Not Found'; 405 = 'Method Not Allowed'
    411 = 'Length Required'; 413 = 'Payload Too Large'; 500 = 'Internal Server Error'; 503 = 'Service Unavailable' }
$TipoJson = 'application/json; charset=utf-8'
$TipoTexto = 'text/plain; charset=utf-8'

function Ler-Requisicao($cliente) {
    $st = $cliente.GetStream()
    $buf = New-Object byte[] 65536
    $acum = New-Object System.IO.MemoryStream
    $fimCab = -1
    while ($fimCab -lt 0) {
        $n = $st.Read($buf, 0, $buf.Length)
        if ($n -le 0) { return $null }
        $acum.Write($buf, 0, $n)
        $tam = [int]$acum.Length
        $ini = [Math]::Max(0, $tam - $n - 3)
        $p = $Latin1.GetString($acum.GetBuffer(), $ini, $tam - $ini).IndexOf("`r`n`r`n", [StringComparison]::Ordinal)
        if ($p -ge 0) { $fimCab = $ini + $p + 4 }
        elseif ($tam -gt 65536) { return @{ stream = $st; erro = 400; mensagem = 'Cabeçalho HTTP muito grande.' } }
    }
    $todos = $acum.GetBuffer(); $tam = [int]$acum.Length
    $linhas = $Latin1.GetString($todos, 0, $fimCab - 4).Split([string[]]@("`r`n"), [StringSplitOptions]::None)
    $prim = $linhas[0].Split(' ')
    if ($prim.Length -lt 2) { return $null }
    $h = @{}
    for ($k = 1; $k -lt $linhas.Length; $k++) {
        $ix = $linhas[$k].IndexOf(':')
        if ($ix -gt 0) { $h[$linhas[$k].Substring(0, $ix).Trim().ToLowerInvariant()] = $linhas[$k].Substring($ix + 1).Trim() }
    }
    $alvo = $prim[1]
    $q = $alvo.IndexOf('?')
    $caminho = $alvo
    if ($q -ge 0) { $caminho = $alvo.Substring(0, $q) }
    $req = @{ stream = $st; method = $prim[0].ToUpperInvariant(); path = $caminho; target = $alvo; headers = $h; body = (New-Object byte[] 0); cliente = $cliente }
    $len = 0L
    if ($h.ContainsKey('content-length')) {
        if (-not [long]::TryParse($h['content-length'], [ref]$len) -or $len -lt 0) { $req.erro = 400; $req.mensagem = 'Content-Length inválido.'; return $req }
    } elseif ($h.ContainsKey('transfer-encoding')) { $req.erro = 411; $req.mensagem = 'Envie o corpo com Content-Length.'; return $req }
    if ($len -gt $LimiteCorpo) { $req.erro = 413; $req.mensagem = 'Requisição excede o limite de ' + [int]($LimiteCorpo / 1MB) + ' MB.'; return $req }
    if ($len -gt 0) {
        if ($h['expect'] -eq '100-continue' -and ($tam - $fimCab) -lt $len) {
            $c = [System.Text.Encoding]::ASCII.GetBytes("HTTP/1.1 100 Continue`r`n`r`n"); $st.Write($c, 0, $c.Length)
        }
        $corpo = New-Object byte[] $len
        $tem = $tam - $fimCab
        if ($tem -gt 0) { [Array]::Copy($todos, $fimCab, $corpo, 0, [Math]::Min([long]$tem, $len)) }
        $pos = [int][Math]::Min([long]$tem, $len)
        while ($pos -lt $len) {
            $n = $st.Read($corpo, $pos, [int]($len - $pos))
            if ($n -le 0) { break }
            $pos += $n
        }
        if ($pos -lt $len) { $req.erro = 400; $req.mensagem = 'Requisição incompleta (conexão interrompida).'; return $req }
        $req.body = $corpo
    }
    return $req
}

function Responder($st, [int]$codigo, $partes, [string]$tipo = $TipoJson, $extras = $null) {
    $script:UltimaResposta = $codigo
    $lista = New-Object System.Collections.ArrayList
    if ($partes -is [byte[]]) { [void]$lista.Add($partes) } else { foreach ($p in $partes) { if ($null -ne $p) { [void]$lista.Add([byte[]]$p) } } }
    $total = 0L
    foreach ($p in $lista) { $total += $p.Length }
    $motivo = $Motivos[$codigo]
    if (-not $motivo) { $motivo = 'OK' }
    $cab = New-Object System.Text.StringBuilder
    [void]$cab.Append("HTTP/1.1 $codigo $motivo`r`nContent-Type: $tipo`r`nContent-Length: $total`r`nConnection: close`r`nCache-Control: no-store`r`nX-Content-Type-Options: nosniff`r`nReferrer-Policy: same-origin`r`n")
    if ($extras) { foreach ($k in $extras.Keys) { [void]$cab.Append($k + ': ' + $extras[$k] + "`r`n") } }
    [void]$cab.Append("`r`n")
    $hb = [System.Text.Encoding]::ASCII.GetBytes($cab.ToString())
    $st.Write($hb, 0, $hb.Length)
    foreach ($p in $lista) { if ($p.Length -gt 0) { $st.Write($p, 0, $p.Length) } }
    $st.Flush()
}
function R-JsonTexto($st, [int]$codigo, [string]$json, $extras = $null) { Responder $st $codigo (Bytes $json) $TipoJson $extras }
function R-Json($st, [int]$codigo, $objeto, $extras = $null) { R-JsonTexto $st $codigo (Json-Texto $objeto) $extras }
function R-Texto($st, [int]$codigo, [string]$texto) { Responder $st $codigo (Bytes $texto) $TipoTexto }
function R-Erro($st, [int]$codigo, [string]$mensagem) { R-JsonTexto $st $codigo ('{"error":' + (Json-Str $mensagem) + '}') }
function R-Arquivo($st, [byte[]]$conteudo, [string]$tipo, [string]$nome, [string]$disposicao = 'inline') {
    $ascii = [regex]::Replace([string]$nome, '[^\x20-\x7E]|["\\]', '_')
    $utf = [Uri]::EscapeDataString([string]$nome)
    $cd = $disposicao + '; filename="' + $ascii + '"; filename*=UTF-8' + "''" + $utf
    Responder $st 200 $conteudo $tipo @{ 'Content-Disposition' = $cd }
}

function Corpo-Texto($req) { return $Utf8.GetString((Sem-Bom $req.body)) }
function Corpo-Json($req) {
    $t = Corpo-Texto $req
    if ([string]::IsNullOrWhiteSpace($t)) { return , (New-Object 'System.Collections.Generic.Dictionary[string,object]') }
    $o = Json-Ler $t
    if ($null -eq $o -or -not ($o -is [System.Collections.IDictionary])) { throw (New-Object System.FormatException 'Corpo JSON inválido.') }
    return , $o
}
function Tem-Chave($o, [string]$k) {
    if ($null -eq $o) { return $false }
    if ($o -is [System.Collections.Generic.Dictionary[string,object]]) { return $o.ContainsKey($k) }
    return ([System.Collections.IDictionary]$o).Contains($k)
}
function Campo($o, [string]$nome) { if ((Tem-Chave $o $nome) -and $null -ne $o[$nome]) { return [string]$o[$nome] }; return '' }
function Corpo-Descompactado($req) {
    $ce = [string]$req.headers['content-encoding']
    if ($ce -match 'gzip') {
        $ms = [System.IO.MemoryStream]::new($req.body)
        $gz = New-Object System.IO.Compression.GZipStream($ms, [System.IO.Compression.CompressionMode]::Decompress)
        $saida = New-Object System.IO.MemoryStream
        try { $gz.CopyTo($saida) } finally { $gz.Dispose() }
        return , $saida.ToArray()
    }
    return , $req.body
}

# multipart/form-data (upload de documentos): limites de cada parte por bytes, sem perder bytes do arquivo.
function Ler-Multipart($req) {
    $ct = [string]$req.headers['content-type']
    $m = [regex]::Match($ct, 'boundary=(?:"([^"]+)"|([^;\s]+))', 'IgnoreCase')
    $saida = @{}
    if (-not $m.Success) { return $saida }
    $limite = $m.Groups[1].Value
    if (-not $limite) { $limite = $m.Groups[2].Value }
    $texto = $Latin1.GetString($req.body)   # 1 caractere = 1 byte
    $delim = '--' + $limite
    $pos = $texto.IndexOf($delim, [StringComparison]::Ordinal)
    while ($pos -ge 0) {
        $ini = $pos + $delim.Length
        if ($ini + 2 -le $texto.Length -and [string]::CompareOrdinal($texto, $ini, '--', 0, 2) -eq 0) { break }
        $ini += 2   # CRLF
        $prox = $texto.IndexOf("`r`n" + $delim, $ini, [StringComparison]::Ordinal)
        if ($prox -lt 0) { break }
        $sep = $texto.IndexOf("`r`n`r`n", $ini, [StringComparison]::Ordinal)
        if ($sep -lt 0 -or $sep -gt $prox) { $pos = $texto.IndexOf($delim, $prox + 2, [StringComparison]::Ordinal); continue }
        $cabParte = $Utf8.GetString($req.body, $ini, $sep - $ini)
        $iniDados = $sep + 4
        $nm = [regex]::Match($cabParte, 'name="([^"]*)"', 'IgnoreCase')
        if ($nm.Success) {
            $fn = [regex]::Match($cabParte, 'filename="([^"]*)"', 'IgnoreCase')
            if ($fn.Success) {
                $dados = New-Object byte[] ($prox - $iniDados)
                [Array]::Copy($req.body, $iniDados, $dados, 0, $dados.Length)
                $saida[$nm.Groups[1].Value] = @{ filename = $fn.Groups[1].Value; bytes = $dados }
            } else {
                $saida[$nm.Groups[1].Value] = $Utf8.GetString($req.body, $iniDados, $prox - $iniDados)
            }
        }
        $pos = $prox + 2
    }
    return $saida
}

# =====================================================================================================
# Adaptadores do frontend: arquivos server\*.js da lista abaixo, incluidos nessa ordem no fim do index.html ao entregar
# a pagina, cada um no seu <script> (os arquivos do frontend nao mudam). Lidos na inicializacao; a pasta server nunca e
# entregue pelo servidor.
#   adaptador_frontend.js   - ACV/LCC, textos, capacidade, calendario (dias disponiveis e historico), carga, MRP
#   adaptador_passaporte.js - passaporte da bateria e biblioteca de fatores ambientais (GWP100)
# =====================================================================================================
$ArquivosAdaptador = @(
    @{ Arquivo = 'adaptador_frontend.js'; Id = 'mes-adaptador-json' },
    @{ Arquivo = 'adaptador_passaporte.js'; Id = 'mes-adaptador-passaporte' }
)
$script:AdaptadorHtml = ''
function Carregar-Adaptador {
    $tags = New-Object System.Text.StringBuilder
    foreach ($a in $ArquivosAdaptador) {
        $arq = Join-Path $PSScriptRoot $a.Arquivo
        if (-not [System.IO.File]::Exists($arq)) { throw ('arquivo server\' + $a.Arquivo + ' não encontrado em ' + $PSScriptRoot + '. Extraia novamente o pacote completo do MES (todas as pastas).') }
        $js = $Utf8.GetString((Sem-Bom ([System.IO.File]::ReadAllBytes($arq))))
        # o texto vai dentro de <script>...</script>: um "</script" no meio encerraria o bloco antes da hora
        $js = [regex]::Replace($js, '</(script)', '<\/$1', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
        [void]$tags.Append('<script id="' + $a.Id + '">' + $js + '</script>')
    }
    $script:AdaptadorHtml = $tags.ToString()
}
function Entregar-Index([byte[]]$html) {
    $t = $Utf8.GetString((Sem-Bom $html))
    $t = $t.Replace('<title>MES LION 1.0 PGSQL</title>', '<title>MES LION 1.0 JSON</title>')
    $tag = $script:AdaptadorHtml
    $i = $t.LastIndexOf('</body>', [StringComparison]::OrdinalIgnoreCase)
    if ($i -ge 0) { $t = $t.Substring(0, $i) + $tag + $t.Substring($i) } else { $t = $t + $tag }
    return , $Utf8.GetBytes($t)
}

# Somente os arquivos do frontend sao publicos; Dados e server nunca sao entregues.
$TiposWeb = @{ '.html' = 'text/html; charset=utf-8'; '.htm' = 'text/html; charset=utf-8'; '.js' = 'application/javascript; charset=utf-8'
    '.css' = 'text/css; charset=utf-8'; '.jpg' = 'image/jpeg'; '.jpeg' = 'image/jpeg'; '.png' = 'image/png'; '.gif' = 'image/gif'
    '.svg' = 'image/svg+xml'; '.ico' = 'image/x-icon'; '.webp' = 'image/webp'; '.woff' = 'font/woff'; '.woff2' = 'font/woff2'; '.ttf' = 'font/ttf'
    '.map' = 'application/json; charset=utf-8' }
$PastasPrivadas = @('dados', 'server', 'database', 'backups', 'logs')
$RootComBarra = $Root.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
$DadosComBarra = $Dados.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
function Servir-Estatico($st, [string]$caminho) {
    $rel = 'index.html'
    if ($caminho -ne '/') {
        try { $rel = [Uri]::UnescapeDataString($caminho.TrimStart('/')) } catch { R-Texto $st 404 'Não encontrado'; return }
    }
    $segs = $rel.Split([char[]]@('/', '\'))
    if ($segs.Length -gt 0 -and $PastasPrivadas -contains $segs[0].ToLowerInvariant()) { R-Texto $st 404 'Não encontrado'; return }
    foreach ($s in $segs) { if ($s.StartsWith('.')) { R-Texto $st 404 'Não encontrado'; return } }
    try { $fp = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($Root, $rel.Replace('/', [System.IO.Path]::DirectorySeparatorChar))) } catch { R-Texto $st 404 'Não encontrado'; return }
    $ext = [System.IO.Path]::GetExtension($fp).ToLowerInvariant()
    if (-not $fp.StartsWith($RootComBarra, [StringComparison]::OrdinalIgnoreCase) -or $fp.StartsWith($DadosComBarra, [StringComparison]::OrdinalIgnoreCase) -or
        -not $TiposWeb.ContainsKey($ext) -or -not [System.IO.File]::Exists($fp)) {
        R-Texto $st 404 'Não encontrado'; return
    }
    # confere de novo depois da normalizacao do Windows (ex.: "Dados." ou "Dados " viram "Dados")
    $primeiro = $fp.Substring($RootComBarra.Length).Split([char[]]@('/', '\'))[0].ToLowerInvariant()
    if ($PastasPrivadas -contains $primeiro) { R-Texto $st 404 'Não encontrado'; return }
    $bytes = [System.IO.File]::ReadAllBytes($fp)
    if ([string]::Equals($fp, (Join-Path $Root 'index.html'), [StringComparison]::OrdinalIgnoreCase)) { $bytes = Entregar-Index $bytes }
    Responder $st 200 $bytes $TiposWeb[$ext]
}

# =====================================================================================================
# Sessoes (na memoria, como no original: expiram ao fechar o servidor ou apos 12 h sem uso)
# =====================================================================================================
$Sessoes = @{}
function Usuario-DaRequisicao($req) {
    $c = [string]$req.headers['cookie']
    if (-not $c) { return $null }
    $m = [regex]::Match($c, '(?:^|;)\s*MESSESSION=([^;\s]+)')
    if (-not $m.Success) { return $null }
    $t = $m.Groups[1].Value
    if (-not $Sessoes.ContainsKey($t)) { return $null }
    $s = $Sessoes[$t]
    if (([DateTime]::UtcNow - $s.uso).TotalHours -gt 12) { $Sessoes.Remove($t); return $null }
    $s.uso = [DateTime]::UtcNow
    return $s
}
function Encerrar-SessoesDoUsuario([string]$id) {
    foreach ($t in @($Sessoes.Keys)) { if ($Sessoes[$t].id -eq $id) { $Sessoes.Remove($t) } }
}
function Usuario-Json($s) { $o = Novo-Objeto; $o['id'] = $s.id; $o['username'] = $s.username; $o['fullName'] = $s.fullName; $o['role'] = $s.role; return , $o }

# =====================================================================================================
# Rotas
# =====================================================================================================
function Rotear($req) {
    $st = $req.stream; $metodo = $req.method; $caminho = $req.path
    $u = Usuario-DaRequisicao $req

    # ---------------------------------------------------------------- publicas
    if ($caminho -eq '/healthz') {
        $o = Novo-Objeto; $o['status'] = 'ok'; $o['banco'] = 'JSON'; $o['versao'] = $VersaoMes; $o['servidor'] = 'PowerShell ' + $PSVersionTable.PSVersion.ToString()
        R-Json $st 200 $o; return
    }
    if ($caminho -eq '/api/auth/login' -and $metodo -eq 'POST') {
        try { $b = Corpo-Json $req } catch { R-Erro $st 400 'Requisição inválida.'; return }
        $nome = Campo $b 'username'; $senha = Campo $b 'password'
        $lista = Ler-Usuarios
        $achado = $null
        foreach ($x in $lista) { if ([string]::Equals([string]$x['username'], $nome, [StringComparison]::Ordinal) -and (Usuario-Ativo $x)) { $achado = $x; break } }
        $res = 'falhou'
        if ($achado) { $res = Verificar-Senha $senha ([string]$achado['password_hash']) }
        if ($res -eq 'falhou') { R-Erro $st 401 'Usuário ou senha inválidos'; return }
        if ($res -eq 'atualizar') {
            # senha migrada do PostgreSQL (bcrypt): converte para PBKDF2 no primeiro login
            try { $achado['password_hash'] = Gerar-HashSenha $senha; $achado['updated_at'] = Agora; Salvar-Usuarios $lista } catch { Escrever-Log ('Não foi possível atualizar o hash da senha: ' + $_.Exception.Message) 'Yellow' -Arquivo }
        }
        $tok = Novo-Token
        $Sessoes[$tok] = @{ id = [string]$achado['id']; username = [string]$achado['username']; fullName = [string]$achado['full_name']; role = [string]$achado['role']; uso = [DateTime]::UtcNow }
        Auditar $Sessoes[$tok] 'auth' 'LOGIN' ([string]$achado['username'])
        Escrever-Log ('Login: ' + $achado['username']) 'DarkGray'
        $o = Novo-Objeto; $o['user'] = Usuario-Json $Sessoes[$tok]
        R-Json $st 200 $o @{ 'Set-Cookie' = "MESSESSION=$tok; Path=/; HttpOnly; SameSite=Lax" }
        return
    }
    if ($caminho -eq '/api/auth/logout' -and $metodo -eq 'POST') {
        $m = [regex]::Match([string]$req.headers['cookie'], '(?:^|;)\s*MESSESSION=([^;\s]+)')
        if ($m.Success) { $Sessoes.Remove($m.Groups[1].Value) }
        R-JsonTexto $st 200 '{"ok":true}' @{ 'Set-Cookie' = 'MESSESSION=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax' }
        return
    }
    if ($caminho -eq '/api/auth/me') {
        if (-not $u) { R-Erro $st 401 'Não autenticado'; return }
        $o = Novo-Objeto; $o['user'] = Usuario-Json $u; R-Json $st 200 $o; return
    }
    if ($caminho.StartsWith('/passaporte/') -and ($metodo -eq 'GET' -or $metodo -eq 'HEAD')) {
        $id = [Uri]::UnescapeDataString($caminho.Substring(12))
        if ($id.EndsWith('.html', [StringComparison]::OrdinalIgnoreCase)) { $id = $id.Substring(0, $id.Length - 5) }
        $id = Id-PassaporteSeguro $id
        $fp = Join-Path $PastaPassaportes ($id + '.html')
        if (-not $id -or -not [System.IO.File]::Exists($fp)) { R-Texto $st 404 'Passaporte não publicado.'; return }
        Responder $st 200 ([System.IO.File]::ReadAllBytes($fp)) 'text/html; charset=utf-8'
        return
    }
    if ($caminho.StartsWith('/api/') -and -not $u) { R-Erro $st 401 'Não autenticado'; return }
    if (-not $caminho.StartsWith('/api/')) {
        if ($metodo -ne 'GET' -and $metodo -ne 'HEAD') { R-Texto $st 405 'Método não permitido'; return }
        Servir-Estatico $st $caminho; return
    }

    # ---------------------------------------------------------------- estado do MES e app_storage
    if ($caminho -eq '/api/bootstrap') {
        $estado = Ler-EstadoBytes
        if ($null -eq $estado) { $estado = Bytes 'null' }
        $fim = ',"appStorage":' + (Kv-Json (Ler-Kv)) + ',"user":' + (Json-Texto (Usuario-Json $u)) + '}'
        Responder $st 200 @((Bytes '{"data":'), $estado, (Bytes $fim)) $TipoJson
        return
    }
    if ($caminho -eq '/api/storage' -and $metodo -eq 'GET') {
        $kv = Ler-Kv
        $estado = Ler-EstadoBytes
        $txt = '{}'
        if ($null -ne $estado) { $txt = $Utf8.GetString($estado) }
        $kv['MES_LION_DATA'] = $txt
        R-JsonTexto $st 200 (Kv-Json $kv)
        return
    }
    if ($caminho -eq '/api/storage' -and $metodo -eq 'DELETE') {
        Salvar-Kv (New-Object 'System.Collections.Generic.Dictionary[string,string]' ([StringComparer]::Ordinal))
        Auditar $u 'app' 'CLEAR_STORAGE' 'app_storage'
        R-Texto $st 200 'OK'; return
    }
    if ($caminho.StartsWith('/api/storage/')) {
        $chave = [Uri]::UnescapeDataString($caminho.Substring(13))
        if ($metodo -eq 'PUT') {
            if ($chave -ceq 'MES_LION_DATA') {
                $corpo = Sem-Bom (Corpo-Descompactado $req)
                if (-not (Eh-ObjetoJson $corpo)) { R-Erro $st 400 'Estado do MES inválido: o conteúdo enviado não é um objeto JSON completo. Nada foi alterado.'; return }
                $sw = [System.Diagnostics.Stopwatch]::StartNew()
                try { Backup-DiarioSeNecessario } catch { Escrever-Log ('Backup diário não criado: ' + $_.Exception.Message) 'Yellow' -Arquivo }
                Gravar-Atomico $ArqEstado $corpo
                $d = Novo-Objeto; $d['bytes'] = $corpo.Length
                Auditar $u 'app' 'SAVE_STATE' 'MES_LION_DATA' $d
                Escrever-Log ('Dados salvos por {0} ({1:N1} MB, {2} ms)' -f $u.username, ($corpo.Length / 1MB), $sw.ElapsedMilliseconds) 'DarkGray'
                R-Texto $st 200 'OK'; return
            }
            $kv = Ler-Kv
            $kv[$chave] = Corpo-Texto $req
            Salvar-Kv $kv
            R-Texto $st 200 'OK'; return
        }
        if ($metodo -eq 'DELETE') {
            # o estado do MES nunca e apagado por esta rota (o original respondia 404)
            if ($chave -cne 'MES_LION_DATA') { $kv = Ler-Kv; if ($kv.Remove($chave)) { Salvar-Kv $kv } }
            R-Texto $st 200 'OK'; return
        }
    }

    # ---------------------------------------------------------------- usuarios e historico
    if ($caminho -eq '/api/users' -and $metodo -eq 'GET') {
        if ($u.role -ne 'ADMIN') { R-Erro $st 403 'Acesso administrativo necessário'; return }
        $saida = New-Object System.Collections.ArrayList
        $todos = Ler-Usuarios
        foreach ($x in ($todos | Sort-Object { [string]$_['full_name'] })) {
            $o = Novo-Objeto
            foreach ($c in 'id', 'username', 'full_name', 'role') { $o[$c] = [string]$x[$c] }
            $o['active'] = [bool](Usuario-Ativo $x)
            $o['created_at'] = [string]$x['created_at']; $o['updated_at'] = [string]$x['updated_at']
            [void]$saida.Add($o)
        }
        if ($saida.Count -eq 0) { R-JsonTexto $st 200 '[]'; return }
        R-JsonTexto $st 200 (Json-Texto ($saida.ToArray())); return
    }
    if ($caminho -eq '/api/users' -and $metodo -eq 'POST') {
        if ($u.role -ne 'ADMIN') { R-Erro $st 403 'Acesso administrativo necessário'; return }
        try { $b = Corpo-Json $req } catch { R-Erro $st 400 'Requisição inválida.'; return }
        $nome = Campo $b 'username'; $completo = Campo $b 'fullName'; $senha = Campo $b 'password'; $perfil = Campo $b 'role'
        if ([string]::IsNullOrWhiteSpace($nome) -or [string]::IsNullOrWhiteSpace($completo) -or [string]::IsNullOrWhiteSpace($senha)) { R-Erro $st 400 'Usuário, nome e senha são obrigatórios'; return }
        if (-not $perfil) { $perfil = 'USER' }
        $lista = Ler-Usuarios
        foreach ($x in $lista) { if ([string]::Equals([string]$x['username'], $nome, [StringComparison]::Ordinal)) { R-Erro $st 400 ('O usuário "' + $nome + '" já existe.'); return } }
        $novo = Novo-Objeto
        $novo['id'] = [guid]::NewGuid().ToString()
        $novo['username'] = Cortar $nome 80
        $novo['full_name'] = Cortar $completo 180
        $novo['password_hash'] = Gerar-HashSenha $senha
        $novo['role'] = Cortar $perfil 30
        $novo['active'] = ((Tem-Chave $b 'active') -and $b['active'] -eq $true)
        $novo['created_at'] = Agora; $novo['updated_at'] = $novo['created_at']
        Salvar-Usuarios ($lista + @($novo))
        Auditar $u 'usuarios' 'CREATE' $nome
        $o = Novo-Objeto; $o['id'] = $novo['id']; R-Json $st 200 $o; return
    }
    if ($caminho -match '^/api/users/([0-9a-fA-F-]+)$' -and $metodo -eq 'PUT') {
        if ($u.role -ne 'ADMIN') { R-Erro $st 403 'Acesso administrativo necessário'; return }
        $id = $Matches[1]
        try { $b = Corpo-Json $req } catch { R-Erro $st 400 'Requisição inválida.'; return }
        $lista = Ler-Usuarios
        $alvo = $null
        foreach ($x in $lista) { if ([string]$x['id'] -eq $id) { $alvo = $x; break } }
        if (-not $alvo) { R-Erro $st 404 'Usuário não encontrado'; return }
        $ativo = ((Tem-Chave $b 'active') -and $b['active'] -eq $true)
        $perfil = Campo $b 'role'
        if (-not $perfil) { $perfil = [string]$alvo['role'] }
        $completo = Campo $b 'fullName'
        if (-not $completo) { $completo = [string]$alvo['full_name'] }
        # nunca deixa o MES sem administrador ativo
        $outrosAdmins = @($lista | Where-Object { [string]$_['id'] -ne $id -and [string]$_['role'] -eq 'ADMIN' -and (Usuario-Ativo $_) }).Count
        if ($outrosAdmins -eq 0 -and (-not $ativo -or $perfil -ne 'ADMIN')) { R-Erro $st 400 'É necessário manter pelo menos um administrador ativo.'; return }
        $alvo['full_name'] = Cortar $completo 180
        $alvo['role'] = Cortar $perfil 30
        $alvo['active'] = $ativo
        $senha = Campo $b 'password'
        if (-not [string]::IsNullOrWhiteSpace($senha)) { $alvo['password_hash'] = Gerar-HashSenha $senha }
        $alvo['updated_at'] = Agora
        Salvar-Usuarios $lista
        if (-not $ativo) { Encerrar-SessoesDoUsuario $id }
        else { foreach ($t in @($Sessoes.Keys)) { if ($Sessoes[$t].id -eq $id) { $Sessoes[$t].role = [string]$alvo['role']; $Sessoes[$t].fullName = [string]$alvo['full_name'] } } }
        Auditar $u 'usuarios' 'UPDATE' $id
        R-JsonTexto $st 200 '{"ok":true}'; return
    }
    if ($caminho -eq '/api/audit') { R-JsonTexto $st 200 (Auditoria-Json 500); return }

    # ---------------------------------------------------------------- documentos de equipamentos
    if ($caminho -match '^/api/equipment/(.+)/documents$') {
        $codigo = [Uri]::UnescapeDataString($Matches[1])
        if ($metodo -eq 'GET') {
            $todos = Ler-Lista $ArqDocumentos
            $docs = @($todos | Where-Object { [string]$_['equipment_code'] -ceq $codigo -and ($_['active'] -eq $true) } | Sort-Object { [string]$_['uploaded_at'] } -Descending)
            $saida = New-Object System.Collections.ArrayList
            foreach ($d in $docs) {
                $o = Novo-Objeto
                foreach ($c in 'id', 'equipment_code', 'original_name', 'mime_type', 'file_size', 'document_type', 'revision', 'active', 'uploaded_at') { $o[$c] = $d[$c] }
                [void]$saida.Add($o)
            }
            if ($saida.Count -eq 0) { R-JsonTexto $st 200 '[]'; return }
            R-JsonTexto $st 200 (Json-Texto ($saida.ToArray())); return
        }
        if ($metodo -eq 'POST') {
            if ($codigo.Length -gt 100) { R-Erro $st 400 'Código de equipamento muito longo (máx. 100).'; return }
            $m = Ler-Multipart $req
            if (-not $m.ContainsKey('file') -or -not ($m['file'] -is [hashtable])) { R-Erro $st 400 'Arquivo obrigatório'; return }
            $nomeArq = Nome-Seguro (([string]$m['file'].filename).Replace('\', '/').Split('/')[-1]) 'documento'
            $ext = [System.IO.Path]::GetExtension($nomeArq).ToLowerInvariant()
            if (@('.pdf', '.xlsx', '.xls') -notcontains $ext) { R-Erro $st 400 'Somente PDF/XLS/XLSX'; return }
            $armazenado = [guid]::NewGuid().ToString() + $ext
            Gravar-Atomico (Join-Path $PastaDocumentos $armazenado) $m['file'].bytes
            $d = Novo-Objeto
            $d['id'] = [guid]::NewGuid().ToString(); $d['equipment_code'] = $codigo; $d['original_name'] = $nomeArq; $d['stored_name'] = $armazenado
            $d['mime_type'] = Tipo-PorNome $nomeArq; $d['file_size'] = $m['file'].bytes.Length
            $d['document_type'] = Cortar ([string]$m['documentType']) 80; $d['revision'] = Cortar ([string]$m['revision']) 40
            $d['active'] = $true; $d['uploaded_at'] = Agora; $d['uploaded_by'] = $u.id
            $existentes = Ler-Lista $ArqDocumentos
            Salvar-Lista $ArqDocumentos ($existentes + @($d))
            Auditar $u 'equipamentos' 'UPLOAD_DOCUMENT' $codigo
            $o = Novo-Objeto; $o['id'] = $d['id']; R-Json $st 200 $o; return
        }
    }
    if ($caminho -match '^/api/documents/([0-9a-fA-F-]+)$') {
        $id = $Matches[1]
        $doc = $null
        foreach ($d in (Ler-Lista $ArqDocumentos)) { if ([string]$d['id'] -eq $id -and $d['active'] -eq $true) { $doc = $d; break } }
        if (-not $doc) { R-Texto $st 404 'Não encontrado'; return }
        $fp = Join-Path $PastaDocumentos ([System.IO.Path]::GetFileName([string]$doc['stored_name']))
        if (-not [System.IO.File]::Exists($fp)) { R-Texto $st 404 'Arquivo não encontrado'; return }
        $tipo = [string]$doc['mime_type']
        if (-not $tipo) { $tipo = Tipo-PorNome ([string]$doc['original_name']) }
        R-Arquivo $st ([System.IO.File]::ReadAllBytes($fp)) $tipo ([string]$doc['original_name'])
        return
    }

    # ---------------------------------------------------------------- anexos de cadastros e passaporte publicado
    if ($caminho -eq '/api/attachments' -and $metodo -eq 'POST') {
        try { $b = Corpo-Json $req } catch { R-Erro $st 400 'Requisição inválida.'; return }
        $b64 = Campo $b 'dataBase64'
        if (-not $b64) { R-Erro $st 400 'Arquivo obrigatório (dataBase64).'; return }
        try { $dados = [Convert]::FromBase64String($b64) } catch { R-Erro $st 400 'Conteúdo do arquivo inválido (base64).'; return }
        if ($dados.Length -gt 50MB) { R-Erro $st 400 'Arquivo excede 50 MB.'; return }
        $id = [guid]::NewGuid().ToString('N')
        $nomeSeguro = Nome-Seguro (Campo $b 'name')
        $escopo = Campo $b 'scope'
        if (-not $escopo) { $escopo = 'geral' }
        $registro = Campo $b 'recordId'
        $mime = Campo $b 'mime'
        if ([string]::IsNullOrWhiteSpace($mime)) { $mime = Tipo-PorNome $nomeSeguro }
        Gravar-Atomico (Join-Path (Join-Path $PastaAnexos $id) $nomeSeguro) $dados
        $a = Novo-Objeto
        $a['id'] = $id; $a['scope'] = Cortar $escopo 100; $a['record_id'] = Cortar $registro 200; $a['original_name'] = $nomeSeguro
        $a['mime_type'] = Cortar $mime 200; $a['file_size'] = $dados.Length; $a['uploaded_at'] = Agora; $a['uploaded_by'] = $u.id
        $existentes = Ler-Lista $ArqAnexos
        Salvar-Lista $ArqAnexos ($existentes + @($a))
        $caminhoLogico = $a['scope'] + '/' + $a['record_id'] + '/' + $nomeSeguro
        Auditar $u 'anexos' 'UPLOAD_ATTACHMENT' $caminhoLogico
        $o = Novo-Objeto
        $o['id'] = $id; $o['url'] = '/api/attachments/' + $id + '/' + [Uri]::EscapeDataString($nomeSeguro); $o['path'] = $caminhoLogico
        $o['name'] = $nomeSeguro; $o['size'] = $dados.Length
        R-Json $st 200 $o; return
    }
    if ($caminho -match '^/api/attachments/([0-9a-fA-F]{32})(/.*)?$' -and $metodo -eq 'GET') {
        $id = $Matches[1].ToLowerInvariant()
        $a = $null
        foreach ($x in (Ler-Lista $ArqAnexos)) { if ([string]$x['id'] -eq $id) { $a = $x; break } }
        if (-not $a) { R-Texto $st 404 'Não encontrado'; return }
        $fp = Join-Path (Join-Path $PastaAnexos $id) ([System.IO.Path]::GetFileName([string]$a['original_name']))
        if (-not [System.IO.File]::Exists($fp)) { R-Texto $st 404 'Não encontrado'; return }
        R-Arquivo $st ([System.IO.File]::ReadAllBytes($fp)) ([string]$a['mime_type']) ([string]$a['original_name'])
        return
    }
    if ($caminho -eq '/api/passport-publish' -and $metodo -eq 'POST') {
        try { $b = Corpo-Json $req } catch { R-Erro $st 400 'Requisição inválida.'; return }
        $id = Id-PassaporteSeguro (Campo $b 'id')
        $html = Campo $b 'html'
        if (-not $id) { R-Erro $st 400 'Passaporte sem ID.'; return }
        if (-not $html) { R-Erro $st 400 'HTML do dashboard ausente.'; return }
        Gravar-Texto (Join-Path $PastaPassaportes ($id + '.html')) $html
        $pub = Novo-Objeto; $pub['id'] = $id; $pub['published_at'] = Agora; $pub['published_by'] = $u.id
        $existentes = Ler-Lista $ArqPassaportes
        Salvar-Lista $ArqPassaportes (@($existentes | Where-Object { [string]$_['id'] -cne $id }) + @($pub))
        Auditar $u 'passaporte' 'PUBLISH_HTML' $id
        $host_ = [string]$req.headers['host']
        if (-not $host_) { $host_ = 'localhost:' + $Port }
        $nomeHost = $host_; $porta = ''
        $mh = [regex]::Match($host_, '^(\[[^\]]+\]|[^:]+)(:\d+)?$')
        if ($mh.Success) { $nomeHost = $mh.Groups[1].Value; $porta = $mh.Groups[2].Value }
        if (@('localhost', '127.0.0.1', '[::1]') -contains $nomeHost.ToLowerInvariant()) { $ip = Ip-RedeLocal; if ($ip) { $nomeHost = $ip } }
        $o = Novo-Objeto; $o['ok'] = $true; $o['id'] = $id; $o['url'] = 'http://' + $nomeHost + $porta + '/passaporte/' + [Uri]::EscapeDataString($id) + '.html'
        R-Json $st 200 $o; return
    }

    # ---------------------------------------------------------------- menu "Banco": backup, exportar, importar, pasta de dados
    if ($caminho -eq '/api/backup' -and $metodo -eq 'POST') {
        $bk = Criar-Backup 'manual' $u
        Auditar $u 'banco' 'BACKUP' $bk.nome
        $o = Novo-Objeto; $o['ok'] = $true; $o['path'] = $bk.caminho; $o['arquivo'] = $bk.nome; $o['sizeBytes'] = $bk.bytes
        R-Json $st 200 $o; return
    }
    if ($caminho -eq '/api/export' -and $metodo -eq 'GET') {
        $conteudo = Montar-Exportacao
        $d = Novo-Objeto; $d['bytes'] = $conteudo.Length
        Auditar $u 'banco' 'EXPORT' ('' + $conteudo.Length + ' bytes') $d
        R-Arquivo $st $conteudo $TipoJson ('MES_LION_BANCO_' + [DateTime]::Now.ToString('yyyyMMdd_HHmmss') + '.json') 'attachment'
        return
    }
    if ($caminho -eq '/api/import' -and $metodo -eq 'POST') {
        if ($u.role -ne 'ADMIN') { R-Erro $st 403 'Acesso administrativo necessário'; return }
        try { $arq = Ler-ArquivoBanco (Corpo-Descompactado $req) } catch { R-Erro $st 400 $_.Exception.Message; return }
        if (-not (Eh-ObjetoJson $arq.estado)) { R-Erro $st 400 'O arquivo não contém um banco do MES válido.'; return }
        $bk = Criar-Backup 'antes_importar' $u
        Gravar-Atomico $ArqEstado $arq.estado
        $nKv = 0
        if ($null -ne $arq.kv) { Salvar-Kv $arq.kv; $nKv = $arq.kv.Count }
        $d = Novo-Objeto; $d['backupAnterior'] = $bk.nome; $d['bytes'] = $arq.estado.Length; $d['chavesAppStorage'] = $nKv
        Auditar $u 'banco' 'IMPORT' $arq.formato $d
        Escrever-Log ("Banco importado por {0} ({1}); backup anterior: {2}" -f $u.username, $arq.formato, $bk.caminho) 'Cyan' -Arquivo
        $o = Novo-Objeto; $o['ok'] = $true; $o['formato'] = $arq.formato; $o['backupAnterior'] = $bk.nome; $o['chavesAppStorage'] = $nKv
        R-Json $st 200 $o; return
    }
    if ($caminho -eq '/api/backups' -and $metodo -eq 'GET') {
        if ($u.role -ne 'ADMIN') { R-Erro $st 403 'Acesso administrativo necessário'; return }
        $saida = New-Object System.Collections.ArrayList
        if ([System.IO.Directory]::Exists($PastaBackups)) {
            foreach ($f in ([System.IO.Directory]::GetFiles($PastaBackups, 'MES_LION_BACKUP_*.zip') | Sort-Object -Descending)) {
                $fi = New-Object System.IO.FileInfo($f)
                $o = Novo-Objeto
                $o['id'] = $fi.Name; $o['arquivo'] = $fi.Name
                $mm = [regex]::Match($fi.Name, '^MES_LION_BACKUP_\d{8}_\d{6}_\d{3}_(.+)\.zip$')
                $o['motivo'] = $(if ($mm.Success) { $mm.Groups[1].Value } else { '' })
                $o['criadoEm'] = ([DateTimeOffset]$fi.LastWriteTime).ToString("yyyy-MM-dd'T'HH:mm:sszzz", $Invariante); $o['bytes'] = $fi.Length
                [void]$saida.Add($o)
            }
        }
        if ($saida.Count -eq 0) { R-JsonTexto $st 200 '[]'; return }
        R-JsonTexto $st 200 (Json-Texto ($saida.ToArray())); return
    }
    if ($caminho.StartsWith('/api/backups/') -and $metodo -eq 'GET') {
        if ($u.role -ne 'ADMIN') { R-Erro $st 403 'Acesso administrativo necessário'; return }
        $nome = [Uri]::UnescapeDataString($caminho.Substring(13))
        if ($nome -notmatch '^MES_LION_BACKUP_[\w\-]+\.zip$') { R-Texto $st 404 'Não encontrado'; return }
        $fp = Join-Path $PastaBackups $nome
        if (-not [System.IO.File]::Exists($fp)) { R-Texto $st 404 'Não encontrado'; return }
        R-Arquivo $st ([System.IO.File]::ReadAllBytes($fp)) 'application/zip' $nome 'attachment'
        return
    }
    if ($caminho -eq '/api/open-data-folder' -and $metodo -eq 'POST') {
        $remoto = $req.cliente.Client.RemoteEndPoint
        $local = $false
        try { $local = [System.Net.IPAddress]::IsLoopback($remoto.Address) } catch { }
        if (-not $EhWindows -or -not $local) { R-Erro $st 400 ('Disponível somente no computador onde o MES está aberto. Pasta de dados: ' + $Dados); return }
        Start-Process -FilePath 'explorer.exe' -ArgumentList ('"' + $Dados + '"')
        $o = Novo-Objeto; $o['ok'] = $true; $o['path'] = $Dados; R-Json $st 200 $o; return
    }
    if ($caminho -eq '/api/info') {
        $fi = New-Object System.IO.FileInfo($ArqEstado)
        $o = Novo-Objeto
        $o['app'] = 'MES LION'; $o['versao'] = $VersaoMes; $o['servidorVersao'] = $VersaoServidor
        $o['plataforma'] = 'PowerShell ' + $PSVersionTable.PSVersion.ToString() + ' + arquivos JSON'
        $o['ambiente'] = 'Servidor local'; $o['servidor'] = [Environment]::MachineName
        $banco = Novo-Objeto; $banco['provedor'] = 'JSON'; $banco['descricao'] = 'Arquivos JSON em ' + $Dados; $o['banco'] = $banco
        $est = Novo-Objeto
        if ($fi.Exists) { $est['bytes'] = $fi.Length; $est['atualizadoEm'] = ([DateTimeOffset]$fi.LastWriteTime).ToString("yyyy-MM-dd'T'HH:mm:sszzz", $Invariante) } else { $est['bytes'] = 0; $est['atualizadoEm'] = $null }
        $o['estado'] = $est
        $o['usuario'] = $u.username; $o['iniciadoEm'] = $script:IniciadoEm
        R-Json $st 200 $o; return
    }

    R-Texto $st 404 'API não encontrada'
}

function Id-PassaporteSeguro([string]$id) {
    $s = [regex]::Replace(([string]$id).Trim(), '[^\p{L}\p{Nd}\-_.]', '_').Trim('.')
    if ($s.Length -gt 120) { $s = $s.Substring(0, 120) }
    return $s
}

function Atender($cliente) {
    $st = $null
    $req = $null
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $script:UltimaResposta = 0
    try {
        $req = Ler-Requisicao $cliente
        if ($null -eq $req) { if ($Detalhado) { Escrever-Log ('conexão encerrada sem pedido (' + $sw.ElapsedMilliseconds + ' ms)') 'DarkGray' }; return }
        $st = $req.stream
        if ($Detalhado) { Escrever-Log ('<- ' + $req.method + ' ' + $req.target + ' (' + $req.body.Length + ' bytes, lido em ' + $sw.ElapsedMilliseconds + ' ms)') 'DarkGray' }
        if ($req.erro) { R-Erro $st $req.erro $req.mensagem; return }
        Rotear $req
        if ($Detalhado) { Escrever-Log ('-> ' + $script:UltimaResposta + ' ' + $req.method + ' ' + $req.path + ' (' + $sw.ElapsedMilliseconds + ' ms)') 'DarkGray' }
    } catch {
        $ex = $_.Exception
        $msg = $ex.Message
        $conexao = $false
        while ($null -ne $ex) {
            if ($ex -is [System.IO.IOException] -or $ex -is [System.Net.Sockets.SocketException] -or $ex -is [System.ObjectDisposedException]) { $conexao = $true }
            $msg = $ex.Message
            $ex = $ex.InnerException
        }
        if ($conexao) { return }   # o navegador desistiu ou a conexao caiu
        $onde = ''
        try { $onde = ' [' + $req.method + ' ' + $req.path + ']' } catch { }
        Escrever-Log ('ERRO' + $onde + ': ' + $msg + ' (linha ' + $_.InvocationInfo.ScriptLineNumber + ')') 'Red' -Arquivo
        if ($st) { try { R-Erro $st 500 $msg } catch { } }
    } finally {
        try { $cliente.Close() } catch { }
    }
}

# =====================================================================================================
# Inicializacao
# =====================================================================================================
function Ler-SenhaOculta([string]$pergunta) {
    # entrada redirecionada (automacao/testes): le a linha diretamente
    if ([Console]::IsInputRedirected) { Write-Host ($pergunta + ': ') -NoNewline; return [Console]::In.ReadLine() }
    $sec = Read-Host $pergunta -AsSecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

function Garantir-Pastas {
    foreach ($p in @($Dados, $PastaArquivos, $PastaDocumentos, $PastaAnexos, $PastaPassaportes, $PastaBackups)) {
        if (-not [System.IO.Directory]::Exists($p)) { [void][System.IO.Directory]::CreateDirectory($p) }
    }
    # a pasta precisa permitir gravacao (ex.: nao pode estar em "Arquivos de Programas" nem em um CD/zip)
    $teste = Join-Path $Dados ('.teste_gravacao_' + [guid]::NewGuid().ToString('N'))
    [System.IO.File]::WriteAllText($teste, 'ok')
    [System.IO.File]::Delete($teste)
    # restos de gravacoes interrompidas
    foreach ($f in [System.IO.Directory]::GetFiles($Dados, '*.tmp')) { try { [System.IO.File]::Delete($f) } catch { } }
}

function Garantir-Administrador {
    $lista = Ler-Usuarios
    if ($lista.Count -gt 0) { return $false }
    $u = Novo-Objeto
    $u['id'] = [guid]::NewGuid().ToString(); $u['username'] = 'admin'; $u['full_name'] = 'Administrador MES LION'
    $u['password_hash'] = Gerar-HashSenha 'meslion2026'; $u['role'] = 'ADMIN'; $u['active'] = $true
    $u['created_at'] = Agora; $u['updated_at'] = $u['created_at']
    Salvar-Usuarios @($u)
    return $true
}

# Dados\MES_LION_DATA.json no formato de exportacao (envelope MES_LION_JSON_DATABASE, como no pacote PostgreSQL,
# que usava o arquivo so como carga inicial): extrai os dados uma unica vez, guardando o original em backups.
function Converter-EnvelopeSeNecessario {
    if (-not [System.IO.File]::Exists($ArqEstado)) { return }
    $fs = [System.IO.File]::OpenRead($ArqEstado)
    try { $n = [int][Math]::Min(8192L, $fs.Length); $buf = New-Object byte[] $n; [void]$fs.Read($buf, 0, $n) } finally { $fs.Dispose() }
    if ($Utf8.GetString($buf) -notmatch '"format"\s*:\s*"MES_LION_JSON_DATABASE"') { return }
    Escrever-Log 'Convertendo Dados\MES_LION_DATA.json do formato de exportação (MES_LION_JSON_DATABASE) para o formato de trabalho...' 'Cyan'
    $bytes = [System.IO.File]::ReadAllBytes($ArqEstado)
    $arq = Ler-ArquivoBanco $bytes
    if ($arq.formato -ne 'MES_LION_JSON_DATABASE') { return }
    $chaves = @($arq.chaves)
    $extras = @($chaves | Where-Object { @('schemaVersion', 'format', 'updatedAt', 'exportedBy', 'exportedAt', 'appStorage', 'data') -cnotcontains $_ })
    if ($extras.Count -gt 0) {
        Escrever-Log ('AVISO: MES_LION_DATA.json tem o envelope de exportação e também coleções fora dele (' + ($extras -join ', ') + '); mantido como está.') 'Yellow' -Arquivo
        return
    }
    if (-not [System.IO.Directory]::Exists($PastaBackups)) { [void][System.IO.Directory]::CreateDirectory($PastaBackups) }
    $copia = Join-Path $PastaBackups ('MES_LION_DATA_original_' + [DateTime]::Now.ToString('yyyyMMdd_HHmmss') + '.json')
    [System.IO.File]::Copy($ArqEstado, $copia, $true)
    Gravar-Atomico $ArqEstado $arq.estado
    if ($null -ne $arq.kv) {
        $kv = Ler-Kv
        foreach ($k in $arq.kv.Keys) { if (-not $kv.ContainsKey($k)) { $kv[$k] = $arq.kv[$k] } }
        Salvar-Kv $kv
    }
    Escrever-Log ('Conversão concluída. Arquivo original guardado em ' + $copia) 'Cyan' -Arquivo
}

function Conferir-Frontend {
    $idx = Join-Path $Root 'index.html'
    if (-not [System.IO.File]::Exists($idx)) { throw ('index.html não encontrado em ' + $Root + '. Extraia o pacote completo do MES (todas as pastas).') }
    $html = [System.IO.File]::ReadAllText($idx, $Utf8)
    $faltando = New-Object 'System.Collections.Generic.List[string]'
    foreach ($m in [regex]::Matches($html, '(?:src|href)="([^"?#]+)')) {
        $rel = $m.Groups[1].Value
        if ($rel -match '^(https?:|data:|//|#|mailto:)') { continue }
        $fp = Join-Path $Root ($rel.TrimStart('/').Replace('/', [System.IO.Path]::DirectorySeparatorChar))
        if (-not [System.IO.File]::Exists($fp)) { $faltando.Add($rel) }
    }
    if ($faltando.Count -gt 0) {
        Write-Host ''
        Write-Host ('ATENÇÃO: faltam arquivos do MES nesta pasta (' + $faltando.Count + '): ' + [string]::Join(', ', $faltando)) -ForegroundColor Yellow
        Write-Host 'Extraia novamente o pacote completo (todas as pastas: js, assets, server e Dados).' -ForegroundColor Yellow
    }
}

# Trava: impede dois servidores gravando a mesma pasta Dados (ex.: pasta na rede aberta em dois computadores).
function Ler-Trava {
    if (-not [System.IO.File]::Exists($ArqTrava)) { return $null }
    try { return (Json-Ler ([System.IO.File]::ReadAllText($ArqTrava, $Utf8))) } catch { return $null }
}
function Trava-Ativa($t) {
    if ($null -eq $t) { return $false }
    if ([string]$t['computador'] -eq [Environment]::MachineName) {
        $p = $null
        try { $p = Get-Process -Id ([int]$t['pid']) -ErrorAction SilentlyContinue } catch { }
        if ($null -eq $p -or $p.Id -eq $PID -or $p.ProcessName -notmatch 'powershell|pwsh') { return $false }
        # o Windows reaproveita numeros de processo: confere tambem a hora em que o processo comecou
        try { return ($p.StartTime.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss') -eq [string]$t['processoIniciadoEm']) } catch { return $false }
    }
    $quando = [DateTimeOffset]::MinValue
    if (-not [DateTimeOffset]::TryParse([string]$t['atualizadoEm'], [ref]$quando)) { return $false }
    return (([DateTimeOffset]::Now - $quando).TotalMinutes -lt 3)
}
function Gravar-Trava {
    $o = Novo-Objeto
    $o['computador'] = [Environment]::MachineName; $o['pid'] = $PID; $o['porta'] = $Port; $o['endereco'] = $HostIP
    $o['usuarioWindows'] = [Environment]::UserName; $o['iniciadoEm'] = $script:IniciadoEm; $o['atualizadoEm'] = Agora
    try { $o['processoIniciadoEm'] = (Get-Process -Id $PID).StartTime.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss') } catch { $o['processoIniciadoEm'] = '' }
    try { Gravar-Texto $ArqTrava (Json-Texto $o -Indentado) } catch { }
}

# ---------------------------------------------------------------- modo: redefinir senha de um usuario
if ($RedefinirSenha) {
    Write-Host ''
    Write-Host "$VersaoMes - redefinir senha de usuário" -ForegroundColor Cyan
    Write-Host "Pasta de dados: $Dados"
    if (-not [System.IO.Directory]::Exists($Dados)) { [void][System.IO.Directory]::CreateDirectory($Dados) }
    [void](Garantir-Administrador)
    $lista = Ler-Usuarios
    Write-Host ''
    foreach ($x in $lista) { Write-Host ('  {0,-20} {1,-35} {2,-8} {3}' -f $x['username'], $x['full_name'], $x['role'], $(if (Usuario-Ativo $x) { 'ativo' } else { 'INATIVO' })) }
    Write-Host ''
    if ([Console]::IsInputRedirected) { Write-Host 'Usuário (login) que terá a senha redefinida: ' -NoNewline; $nome = ([string][Console]::In.ReadLine()).Trim() }
    else { $nome = ([string](Read-Host 'Usuário (login) que terá a senha redefinida')).Trim() }
    $alvo = $null
    foreach ($x in $lista) { if ([string]::Equals([string]$x['username'], $nome, [StringComparison]::Ordinal)) { $alvo = $x } }
    if (-not $alvo) { Write-Host "Usuário '$nome' não encontrado." -ForegroundColor Red; exit 1 }
    $s1 = Ler-SenhaOculta 'Nova senha'
    $s2 = Ler-SenhaOculta 'Repita a nova senha'
    if ([string]::IsNullOrWhiteSpace($s1) -or $s1 -cne $s2) { Write-Host 'As senhas não conferem (ou estão vazias). Nada foi alterado.' -ForegroundColor Red; exit 1 }
    $alvo['password_hash'] = Gerar-HashSenha $s1
    $alvo['active'] = $true
    $alvo['updated_at'] = Agora
    $admins = @($lista | Where-Object { [string]$_['role'] -eq 'ADMIN' -and (Usuario-Ativo $_) }).Count
    if ($admins -eq 0) { $alvo['role'] = 'ADMIN'; Write-Host 'Não havia administrador ativo: o usuário passou a ser ADMIN.' -ForegroundColor Yellow }
    Salvar-Usuarios $lista
    $o = @{ id = [string]$alvo['id']; username = 'REDEFINIR_SENHA.bat' }
    Auditar $o 'usuarios' 'RESET_PASSWORD' ([string]$alvo['username'])
    Write-Host ("Senha de '{0}' redefinida e usuário ativado." -f $alvo['username']) -ForegroundColor Green
    exit 0
}

# ---------------------------------------------------------------- modo normal: servidor
$script:IniciadoEm = Agora
Write-Host ''
Write-Host '================================================' -ForegroundColor Green
Write-Host " $VersaoMes - sem PostgreSQL (dados em arquivos JSON)" -ForegroundColor Green
Write-Host '================================================' -ForegroundColor Green
try {
    Garantir-Pastas
} catch {
    Write-Host ''
    Write-Host "ERRO: a pasta de dados não permite gravação: $Dados" -ForegroundColor Red
    Write-Host 'Copie a pasta do MES para "Documentos" ou para a "Área de Trabalho" e abra de lá.' -ForegroundColor Yellow
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 2
}
$travaExistente = Ler-Trava
if (Trava-Ativa $travaExistente) {
    Write-Host ''
    if ([string]$travaExistente['computador'] -eq [Environment]::MachineName) {
        Write-Host ('O MES (versão JSON) já está aberto neste computador, usando esta mesma pasta de dados (processo ' + $travaExistente['pid'] + ').') -ForegroundColor Yellow
        Write-Host ('Use a janela do servidor que já está aberta ou acesse http://localhost:' + $travaExistente['porta']) -ForegroundColor Yellow
    } else {
        Write-Host ('Esta pasta de dados está em uso pelo MES aberto no computador ' + $travaExistente['computador'] + ' (usuário ' + $travaExistente['usuarioWindows'] + ').') -ForegroundColor Yellow
        Write-Host ('Para trabalhar nos mesmos dados, peça para abrir o MES com INICIAR_MES_REDE.bat naquele computador e acesse http://' + $travaExistente['computador'] + ':' + $travaExistente['porta']) -ForegroundColor Yellow
        Write-Host 'Dois servidores gravando a mesma pasta fariam um apagar as alterações do outro.' -ForegroundColor Yellow
    }
    exit 3
}
if ($Dados -match '\\OneDrive') {
    Write-Host 'AVISO: a pasta de dados está no OneDrive. Prefira uma pasta local (ex.: C:\MES_LION) - a sincronização pode atrasar as gravações.' -ForegroundColor Yellow
}
try {
    Carregar-Adaptador
} catch {
    Write-Host ''
    Write-Host ('ERRO: ' + $_.Exception.Message) -ForegroundColor Red
    Escrever-Log ('ERRO na inicialização: ' + $_.Exception.Message) 'Red' -Arquivo
    exit 4
}
$adminCriado = $false
try {
    Converter-EnvelopeSeNecessario
    $adminCriado = Garantir-Administrador
    Conferir-Frontend
} catch {
    Write-Host ''
    Write-Host ('ERRO ao preparar os dados: ' + $_.Exception.Message) -ForegroundColor Red
    Escrever-Log ('ERRO na inicialização: ' + $_.Exception.Message) 'Red' -Arquivo
    exit 4
}

if ($HostIP -eq '0.0.0.0' -or $HostIP -eq '*') { $Endereco = [System.Net.IPAddress]::Any } else { $Endereco = [System.Net.IPAddress]::Parse($HostIP) }
try {
    $listener = [System.Net.Sockets.TcpListener]::new($Endereco, $Port)
    $listener.Start(128)
} catch {
    Write-Host ''
    Write-Host "ERRO: não foi possível abrir a porta $Port." -ForegroundColor Red
    Write-Host 'Feche qualquer outra versão do MES (janela do servidor) e tente novamente.' -ForegroundColor Yellow
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 2
}
Gravar-Trava

$fiEstado = New-Object System.IO.FileInfo($ArqEstado)
Write-Host ''
Write-Host ('Pasta de dados: ' + $Dados) -ForegroundColor Cyan
if ($fiEstado.Exists -and $fiEstado.Length -gt 2) {
    Write-Host ('Dados do MES:   MES_LION_DATA.json ({0:N1} MB, salvo em {1:dd/MM/yyyy HH:mm})' -f ($fiEstado.Length / 1MB), $fiEstado.LastWriteTime)
} else {
    Write-Host 'Dados do MES:   ainda vazios (o primeiro login grava os dados iniciais do MES)'
}
Write-Host ('Usuários:       ' + (Ler-Usuarios).Count + ' | Histórico: auditoria.jsonl | Backups: Dados\backups')
Write-Host ("Escutando em:   {0}:{1}" -f $listener.LocalEndpoint.Address, $Port) -ForegroundColor Cyan
if ($Endereco.Equals([System.Net.IPAddress]::Any)) {
    $ip = Ip-RedeLocal
    $ipTxt = 'IP-DESTE-PC'
    if ($ip) { $ipTxt = $ip }
    Write-Host 'MODO REDE ATIVO: outros computadores podem acessar este MES.' -ForegroundColor Green
    Write-Host ("Neste PC: http://localhost:$Port   |   Nos demais PCs: http://{0}:{1}" -f $ipTxt, $Port)
} else {
    Write-Host "MODO LOCAL: http://localhost:$Port"
}
if ($adminCriado) { Write-Host 'Usuário inicial: admin  |  Senha inicial: meslion2026  (troque em Usuários / Segurança)' -ForegroundColor Yellow }
Write-Host 'Mantenha esta janela aberta enquanto usa o MES. Para encerrar, feche a janela ou tecle Ctrl+C.'
Write-Host ''
Escrever-Log ("Servidor iniciado ($VersaoMes, PowerShell $($PSVersionTable.PSVersion), porta $Port, $HostIP)") 'DarkGray' -Arquivo
if (-not $NaoAbrirNavegador -and $Endereco.Equals([System.Net.IPAddress]::Loopback)) {
    try { Start-Process "http://localhost:$Port" } catch { }
}

# Laco principal: Socket.Select atende quem ja enviou dados; conexoes abertas antecipadamente pelo navegador e
# ainda sem pedido (pre-conexao) nao travam o servidor.
$pendentes = New-Object System.Collections.ArrayList
$ultimaTrava = [DateTime]::UtcNow
try {
    while ($true) {
        $leitura = New-Object System.Collections.ArrayList
        [void]$leitura.Add($listener.Server)
        foreach ($p in $pendentes) { [void]$leitura.Add($p.c.Client) }
        try { [System.Net.Sockets.Socket]::Select($leitura, $null, $null, 1000000) } catch { Start-Sleep -Milliseconds 50; continue }
        foreach ($sock in $leitura) {
            if ([object]::ReferenceEquals($sock, $listener.Server)) {
                while ($listener.Pending()) {
                    $c = $listener.AcceptTcpClient()
                    $c.ReceiveTimeout = 30000
                    $c.SendTimeout = 600000
                    $c.NoDelay = $true
                    [void]$pendentes.Add(@{ c = $c; t = [DateTime]::UtcNow })
                    if ($Detalhado) { Escrever-Log ('conexão aceita de ' + $c.Client.RemoteEndPoint + ' (aguardando: ' + $pendentes.Count + ')') 'DarkGray' }
                }
                continue
            }
            $item = $null
            foreach ($p in $pendentes) { if ([object]::ReferenceEquals($p.c.Client, $sock)) { $item = $p; break } }
            if ($null -eq $item) { continue }
            $pendentes.Remove($item)
            Atender $item.c
        }
        $agora = [DateTime]::UtcNow
        foreach ($p in @($pendentes)) {
            if (($agora - $p.t).TotalSeconds -gt 120) { $pendentes.Remove($p); try { $p.c.Close() } catch { } }
        }
        if (($agora - $ultimaTrava).TotalSeconds -ge 60) { Gravar-Trava; $ultimaTrava = $agora }
    }
} finally {
    try { $listener.Stop() } catch { }
    try {
        $t = Ler-Trava
        if ($t -and [int]$t['pid'] -eq $PID -and [string]$t['computador'] -eq [Environment]::MachineName) { [System.IO.File]::Delete($ArqTrava) }
    } catch { }
    Escrever-Log 'Servidor encerrado.' 'DarkGray' -Arquivo
}
