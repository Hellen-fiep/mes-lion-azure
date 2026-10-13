using System.Buffers.Binary;
using System.Security.Cryptography;

namespace MesLion.Server.Seguranca;

/// <summary>
/// Hash de senhas compatível com o formato V3 do ASP.NET Core Identity
/// (PBKDF2-HMAC-SHA512, 100.000 iterações, sal de 128 bits, subchave de 256 bits).
/// Também verifica hashes bcrypt herdados do PostgreSQL (pgcrypto).
/// </summary>
public static class SenhaHasher
{
    /// <summary>Marcador de usuário sem senha local (ex.: autenticado só pelo Microsoft Entra ID).</summary>
    public const string SemSenhaLocal = "!SEM_SENHA_LOCAL";

    private const int Iteracoes = 100_000;
    private const int TamanhoSal = 16;
    private const int TamanhoSubchave = 32;

    public static string Gerar(string senha)
    {
        byte[] sal = RandomNumberGenerator.GetBytes(TamanhoSal);
        byte[] subchave = Rfc2898DeriveBytes.Pbkdf2(senha, sal, Iteracoes, HashAlgorithmName.SHA512, TamanhoSubchave);
        byte[] saida = new byte[13 + TamanhoSal + TamanhoSubchave];
        saida[0] = 0x01; // formato V3
        BinaryPrimitives.WriteUInt32BigEndian(saida.AsSpan(1), 2); // HMACSHA512
        BinaryPrimitives.WriteUInt32BigEndian(saida.AsSpan(5), Iteracoes);
        BinaryPrimitives.WriteUInt32BigEndian(saida.AsSpan(9), TamanhoSal);
        sal.CopyTo(saida, 13);
        subchave.CopyTo(saida, 13 + TamanhoSal);
        return Convert.ToBase64String(saida);
    }

    public enum ResultadoVerificacao { Falhou, Sucesso, SucessoRequerAtualizacao }

    public static ResultadoVerificacao Verificar(string senha, string? hash)
    {
        if (string.IsNullOrEmpty(hash) || hash.StartsWith('!')) return ResultadoVerificacao.Falhou;
        if (BCryptLegado.EhHashBcrypt(hash))
            return BCryptLegado.Verificar(senha, hash) ? ResultadoVerificacao.SucessoRequerAtualizacao : ResultadoVerificacao.Falhou;
        return VerificarV3(senha, hash) ? ResultadoVerificacao.Sucesso : ResultadoVerificacao.Falhou;
    }

    private static bool VerificarV3(string senha, string hash)
    {
        byte[] dados;
        try { dados = Convert.FromBase64String(hash); }
        catch (FormatException) { return false; }
        if (dados.Length < 13 || dados[0] != 0x01) return false;

        uint prf = BinaryPrimitives.ReadUInt32BigEndian(dados.AsSpan(1));
        int iteracoes = (int)BinaryPrimitives.ReadUInt32BigEndian(dados.AsSpan(5));
        int tamanhoSal = (int)BinaryPrimitives.ReadUInt32BigEndian(dados.AsSpan(9));
        if (tamanhoSal < 16 || iteracoes < 1 || 13 + tamanhoSal >= dados.Length) return false;

        HashAlgorithmName alg = prf switch
        {
            0 => HashAlgorithmName.SHA1,
            1 => HashAlgorithmName.SHA256,
            2 => HashAlgorithmName.SHA512,
            _ => default
        };
        if (alg == default) return false;

        byte[] sal = dados.AsSpan(13, tamanhoSal).ToArray();
        byte[] esperado = dados.AsSpan(13 + tamanhoSal).ToArray();
        if (esperado.Length < 16) return false;
        byte[] obtido = Rfc2898DeriveBytes.Pbkdf2(senha, sal, iteracoes, alg, esperado.Length);
        return CryptographicOperations.FixedTimeEquals(obtido, esperado);
    }
}
