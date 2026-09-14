using System;
using System.IO;
using System.Text;
using System.Security.Cryptography;

internal static class Bridge
{
    public static int Main(string[] args)
    {
        try
        {
            if (args.Length != 1 || (args[0] != "--protect" && args[0] != "--unprotect"))
                return 2;

            Console.InputEncoding = new UTF8Encoding(false);
            Console.OutputEncoding = new UTF8Encoding(false);
            string input = Console.In.ReadToEnd();

            if (args[0] == "--protect")
            {
                byte[] plain = Encoding.UTF8.GetBytes(input);
                try
                {
                    byte[] encrypted = ProtectedData.Protect(
                        plain, null, DataProtectionScope.CurrentUser);
                    Console.Write(Convert.ToBase64String(encrypted));
                    Array.Clear(encrypted, 0, encrypted.Length);
                }
                finally { Array.Clear(plain, 0, plain.Length); }
            }
            else
            {
                byte[] encrypted = Convert.FromBase64String(input);
                byte[] plain = ProtectedData.Unprotect(
                    encrypted, null, DataProtectionScope.CurrentUser);
                try { Console.Write(Encoding.UTF8.GetString(plain)); }
                finally
                {
                    Array.Clear(encrypted, 0, encrypted.Length);
                    Array.Clear(plain, 0, plain.Length);
                }
            }

            return 0;
        }
        catch { return 1; }
    }
}
