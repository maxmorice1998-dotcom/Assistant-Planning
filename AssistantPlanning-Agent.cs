using System;
using System.Diagnostics;
using System.IO;
using System.Threading;

internal static class AssistantPlanningAgent
{
    private static int Main()
    {
        string root = AppDomain.CurrentDomain.BaseDirectory;
        string node = Path.Combine(root, "runtime", "node", "node.exe");
        string runner = Path.Combine(root, "colleague-runner.js");
        string gui = Path.Combine(root, "SDIS-Collegues.exe");
        if (!File.Exists(node) || !File.Exists(runner)) return 0;

        // Laisser Windows initialiser le reseau et le profil utilisateur.
        Thread.Sleep(3000);
        // Le runner porte le verrou : un agent secondaire ou une mise a jour en cours quitte.
        string dataDir = Environment.GetEnvironmentVariable("SDIS_COLLEAGUES_TEST_DIR");
        if (String.IsNullOrEmpty(dataDir)) dataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "SDIS-Bot-Collegues");
        if (File.Exists(Path.Combine(dataDir, "simulation.lock")) || File.Exists(Path.Combine(dataDir, "update.lock"))) return 0;

        ProcessStartInfo info = new ProcessStartInfo
        {
            FileName = node,
            Arguments = "\"" + runner + "\" --real",
            WorkingDirectory = root,
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
            RedirectStandardOutput = false,
            RedirectStandardError = false
        };
        // L'environnement est herite par le runtime Node ; modifier le
        // processus lanceur evite le blocage de EnvironmentVariables sous
        // certaines versions du .NET Framework.
        Environment.SetEnvironmentVariable("SDIS_AGENT", "1");
        Environment.SetEnvironmentVariable("SDIS_ASSISTANT_EXE", gui);
        try
        {
            using (Process process = Process.Start(info))
            {
                process.WaitForExit();
                if (process.ExitCode == 0) return 0;
            }
        }
        catch
        {
            // L'interface donnera le message de reconnexion ou de disponibilite.
        }
        if (File.Exists(gui))
        {
            try
            {
                Process.Start(new ProcessStartInfo(gui)
                {
                    WorkingDirectory = root,
                    UseShellExecute = true,
                    WindowStyle = ProcessWindowStyle.Normal
                });
            }
            catch { }
        }
        return 0;
    }
}
