using System.Security.Cryptography;
using System.Text;

namespace MesLion.Server.Seguranca;

/// <summary>
/// Verificação de hashes bcrypt ($2a$/$2b$/$2y$) gerados pelo PostgreSQL (pgcrypto:
/// crypt(senha, gen_salt('bf'))) no MES LION PowerShell/PostgreSQL.
/// Permite migrar os usuários sem redefinir senhas. Após o primeiro login bem-sucedido,
/// o hash é atualizado para PBKDF2 (formato ASP.NET Core Identity V3).
/// </summary>
public static class BCryptLegado
{
    private const string Alfabeto = "./ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    private static readonly sbyte[] Indice = CriarIndice();
    // "OrpheanBeholderScryDoubt" em 6 palavras big-endian.
    private static readonly uint[] TextoInicial =
    [
        0x4F727068, 0x65616E42, 0x65686F6C, 0x64657253, 0x63727944, 0x6F756274,
    ];

    public static bool EhHashBcrypt(string? hash) =>
        hash is { Length: 60 } && hash[0] == '$' && hash[1] == '2' && hash[3] == '$' && hash[6] == '$';

    public static bool Verificar(string senha, string hash)
    {
        if (!EhHashBcrypt(hash)) return false;
        char variante = hash[2];
        // $2x$ (modo de compatibilidade com bug antigo) não é suportado.
        if (variante is not ('a' or 'b' or 'y')) return false;
        if (!int.TryParse(hash.AsSpan(4, 2), out int custo) || custo < 4 || custo > 31) return false;

        byte[] sal = DecodificarBase64(hash.AsSpan(7, 22), 16);
        if (sal.Length != 16) return false;

        // Chave = bytes UTF-8 da senha + terminador NUL; o bcrypt usa no máximo 72 bytes.
        byte[] senhaUtf8 = Encoding.UTF8.GetBytes(senha);
        byte[] chave = new byte[Math.Min(senhaUtf8.Length + 1, 72)];
        Array.Copy(senhaUtf8, chave, Math.Min(senhaUtf8.Length, chave.Length));

        byte[] resultado = CalcularHash(chave, sal, custo);
        string obtido = CodificarBase64(resultado, 23);
        byte[] a = Encoding.ASCII.GetBytes(obtido);
        byte[] b = Encoding.ASCII.GetBytes(hash.Substring(29, 31));
        return CryptographicOperations.FixedTimeEquals(a, b);
    }

    /// <summary>Gera um hash bcrypt (usado apenas em testes de compatibilidade).</summary>
    public static string GerarParaTeste(string senha, int custo = 6)
    {
        byte[] sal = RandomNumberGenerator.GetBytes(16);
        byte[] senhaUtf8 = Encoding.UTF8.GetBytes(senha);
        byte[] chave = new byte[Math.Min(senhaUtf8.Length + 1, 72)];
        Array.Copy(senhaUtf8, chave, Math.Min(senhaUtf8.Length, chave.Length));
        byte[] resultado = CalcularHash(chave, sal, custo);
        return $"$2a${custo:00}${CodificarBase64(sal, 16)}{CodificarBase64(resultado, 23)}";
    }

    private static byte[] CalcularHash(byte[] chave, byte[] sal, int custo)
    {
        uint[] p = (uint[])BlowfishConstantes.P.Clone();
        uint[] s = (uint[])BlowfishConstantes.S.Clone();

        ExpandirComSal(p, s, chave, sal);
        long rodadas = 1L << custo;
        for (long i = 0; i < rodadas; i++)
        {
            Expandir(p, s, chave);
            Expandir(p, s, sal);
        }

        uint[] dados = (uint[])TextoInicial.Clone();
        for (int i = 0; i < 64; i++)
        {
            for (int j = 0; j < 6; j += 2)
            {
                uint l = dados[j], r = dados[j + 1];
                Cifrar(p, s, ref l, ref r);
                dados[j] = l; dados[j + 1] = r;
            }
        }

        byte[] saida = new byte[24];
        for (int i = 0; i < 6; i++)
        {
            saida[i * 4] = (byte)(dados[i] >> 24);
            saida[i * 4 + 1] = (byte)(dados[i] >> 16);
            saida[i * 4 + 2] = (byte)(dados[i] >> 8);
            saida[i * 4 + 3] = (byte)dados[i];
        }
        return saida;
    }

    private static uint ProximaPalavra(byte[] dados, ref int pos)
    {
        uint palavra = 0;
        for (int i = 0; i < 4; i++)
        {
            palavra = (palavra << 8) | dados[pos];
            pos = (pos + 1) % dados.Length;
        }
        return palavra;
    }

    private static void ExpandirComSal(uint[] p, uint[] s, byte[] chave, byte[] sal)
    {
        int posChave = 0;
        for (int i = 0; i < 18; i++) p[i] ^= ProximaPalavra(chave, ref posChave);

        int posSal = 0;
        uint l = 0, r = 0;
        for (int i = 0; i < 18; i += 2)
        {
            l ^= ProximaPalavra(sal, ref posSal);
            r ^= ProximaPalavra(sal, ref posSal);
            Cifrar(p, s, ref l, ref r);
            p[i] = l; p[i + 1] = r;
        }
        for (int i = 0; i < 1024; i += 2)
        {
            l ^= ProximaPalavra(sal, ref posSal);
            r ^= ProximaPalavra(sal, ref posSal);
            Cifrar(p, s, ref l, ref r);
            s[i] = l; s[i + 1] = r;
        }
    }

    private static void Expandir(uint[] p, uint[] s, byte[] chave)
    {
        int pos = 0;
        for (int i = 0; i < 18; i++) p[i] ^= ProximaPalavra(chave, ref pos);

        uint l = 0, r = 0;
        for (int i = 0; i < 18; i += 2)
        {
            Cifrar(p, s, ref l, ref r);
            p[i] = l; p[i + 1] = r;
        }
        for (int i = 0; i < 1024; i += 2)
        {
            Cifrar(p, s, ref l, ref r);
            s[i] = l; s[i + 1] = r;
        }
    }

    private static uint F(uint[] s, uint x) =>
        ((s[x >> 24] + s[256 + ((x >> 16) & 0xFF)]) ^ s[512 + ((x >> 8) & 0xFF)]) + s[768 + (x & 0xFF)];

    private static void Cifrar(uint[] p, uint[] s, ref uint l, ref uint r)
    {
        uint xl = l ^ p[0], xr = r;
        for (int i = 1; i <= 16; i += 2)
        {
            xr ^= F(s, xl) ^ p[i];
            xl ^= F(s, xr) ^ p[i + 1];
        }
        xr ^= p[17];
        l = xr; r = xl;
    }

    private static sbyte[] CriarIndice()
    {
        var idx = new sbyte[128];
        Array.Fill(idx, (sbyte)-1);
        for (int i = 0; i < Alfabeto.Length; i++) idx[Alfabeto[i]] = (sbyte)i;
        return idx;
    }

    private static int Valor(char c) => c < 128 ? Indice[c] : -1;

    private static string CodificarBase64(byte[] d, int tamanho)
    {
        var sb = new StringBuilder();
        int off = 0;
        while (off < tamanho)
        {
            int c1 = d[off++] & 0xFF;
            sb.Append(Alfabeto[(c1 >> 2) & 0x3F]);
            c1 = (c1 & 0x03) << 4;
            if (off >= tamanho) { sb.Append(Alfabeto[c1 & 0x3F]); break; }
            int c2 = d[off++] & 0xFF;
            c1 |= (c2 >> 4) & 0x0F;
            sb.Append(Alfabeto[c1 & 0x3F]);
            c1 = (c2 & 0x0F) << 2;
            if (off >= tamanho) { sb.Append(Alfabeto[c1 & 0x3F]); break; }
            c2 = d[off++] & 0xFF;
            c1 |= (c2 >> 6) & 0x03;
            sb.Append(Alfabeto[c1 & 0x3F]);
            sb.Append(Alfabeto[c2 & 0x3F]);
        }
        return sb.ToString();
    }

    private static byte[] DecodificarBase64(ReadOnlySpan<char> s, int maxBytes)
    {
        var saida = new List<byte>(maxBytes);
        int off = 0, slen = s.Length;
        while (off < slen - 1 && saida.Count < maxBytes)
        {
            int c1 = Valor(s[off++]), c2 = Valor(s[off++]);
            if (c1 < 0 || c2 < 0) break;
            saida.Add((byte)((c1 << 2) | ((c2 & 0x30) >> 4)));
            if (saida.Count >= maxBytes || off >= slen) break;
            int c3 = Valor(s[off++]);
            if (c3 < 0) break;
            saida.Add((byte)(((c2 & 0x0F) << 4) | ((c3 & 0x3C) >> 2)));
            if (saida.Count >= maxBytes || off >= slen) break;
            int c4 = Valor(s[off++]);
            if (c4 < 0) break;
            saida.Add((byte)(((c3 & 0x03) << 6) | c4));
        }
        return saida.ToArray();
    }
}
