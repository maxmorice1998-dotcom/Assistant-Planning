using System;
using System.Collections.Generic;
using System.IO;

// Répare les raccourcis visibles de l'utilisateur sans toucher au raccourci
// Startup qui lance l'agent invisible.
internal static class ShortcutRepair
{
    private static readonly string[] KnownNames = new[]
    {
        "Assistant Planning", "AssistantPlanning", "SDIS-Collegues", "SDIS Collegues",
        "SDIS-BOT", "SDIS BOT"
    };

    public static void Repair()
    {
        try
        {
            string root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
            string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
            string programs = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                "Microsoft", "Windows", "Start Menu", "Programs");
            RepairForRoots(desktop, programs, root);
        }
        catch
        {
            // Une réparation d'icône ne doit jamais empêcher le démarrage.
        }
    }

    // Public uniquement pour le test automatisé ; l'application utilise Repair().
    public static int RepairForRoots(string desktop, string programs, string installRoot)
    {
        string executable = Path.Combine(installRoot, "SDIS-Collegues.exe");
        if (!File.Exists(executable)) return 0;

        Type shellType = Type.GetTypeFromProgID("WScript.Shell");
        if (shellType == null) return 0;
        dynamic shell = Activator.CreateInstance(shellType);
        HashSet<string> seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        int repaired = 0;
        foreach (string location in new[] { desktop, programs })
        {
            if (!Directory.Exists(location)) continue;
            string[] links;
            try { links = Directory.GetFiles(location, "*.lnk", SearchOption.AllDirectories); }
            catch { continue; }
            foreach (string linkPath in links)
            {
                string full = Path.GetFullPath(linkPath);
                if (!seen.Add(full) || IsStartupShortcut(full)) continue;
                try
                {
                    dynamic shortcut = shell.CreateShortcut(full);
                    string target = Convert.ToString(shortcut.TargetPath);
                    string name = Path.GetFileNameWithoutExtension(full);
                    if (!IsAssistantShortcut(name, target)) continue;
                    shortcut.TargetPath = executable;
                    shortcut.WorkingDirectory = installRoot;
                    shortcut.IconLocation = executable + ",0";
                    shortcut.Save();
                    repaired++;
                }
                catch
                {
                    // Un raccourci inaccessible ne doit pas bloquer les autres.
                }
            }
        }
        return repaired;
    }

    private static bool IsStartupShortcut(string path)
    {
        string parent = Path.GetFileName(Path.GetDirectoryName(path) ?? "");
        return String.Equals(parent, "Startup", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsAssistantShortcut(string name, string target)
    {
        string normalizedName = Normalize(name);
        foreach (string known in KnownNames)
            if (normalizedName == Normalize(known)) return true;
        return String.Equals(Path.GetFileName(target ?? ""), "SDIS-Collegues.exe",
            StringComparison.OrdinalIgnoreCase);
    }

    private static string Normalize(string value)
    {
        return (value ?? "").Replace(" ", "").Replace("-", "").Replace("_", "").ToLowerInvariant();
    }

}
