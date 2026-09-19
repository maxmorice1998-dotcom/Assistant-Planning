using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;

internal sealed class InstallerForm : Form
{
    private readonly Label status = new Label();
    private readonly ProgressBar progress = new ProgressBar();
    private readonly Label spinner = new Label();
    private readonly Timer busyTimer = new Timer();
    private static readonly string InstallLog = Path.Combine(Path.GetTempPath(), "Assistant-Planning-install-" + Process.GetCurrentProcess().Id + ".log");
    private static void Log(string message) { try { File.AppendAllText(InstallLog, DateTime.UtcNow.ToString("o") + " " + message + Environment.NewLine, new UTF8Encoding(false)); } catch { } }
    private static Image LoadLogo() { try { using (Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("udsp14-logo.png")) { return stream == null ? null : new Bitmap(Image.FromStream(stream)); } } catch { return null; } }

    public InstallerForm()
    {
        string version = FileVersionInfo.GetVersionInfo(Process.GetCurrentProcess().MainModule.FileName).ProductVersion;
        Text = "Assistant Planning - Installation";
        ClientSize = new Size(640, 800);
        MinimumSize = new Size(656, 839);
        MaximumSize = new Size(656, 839);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(250, 250, 249);
        Font = new Font("Segoe UI", 11F);
        try { Icon = Icon.ExtractAssociatedIcon(Process.GetCurrentProcess().MainModule.FileName); } catch { }

        Panel header = new Panel { Bounds = new Rectangle(0, 0, 640, 126), BackColor = Color.White };
        Controls.Add(header);
        header.Controls.Add(new Panel { Dock = DockStyle.Bottom, Height = 4, BackColor = Color.FromArgb(232, 35, 42) });
        header.Controls.Add(new PictureBox { Image = LoadLogo(), Bounds = new Rectangle(26, 18, 92, 88), SizeMode = PictureBoxSizeMode.Zoom, BackColor = Color.Transparent });
        header.Controls.Add(new Label { Text = "UDSP 14", Font = new Font("Segoe UI", 12F, FontStyle.Bold), ForeColor = Color.FromArgb(3, 46, 66), AutoSize = true, Location = new Point(140, 22) });
        header.Controls.Add(new Label { Text = "Service Formation", Font = new Font("Segoe UI", 10F), ForeColor = Color.FromArgb(94, 107, 113), AutoSize = true, Location = new Point(141, 47) });
        header.Controls.Add(new Label { Text = "Assistant Planning", Font = new Font("Segoe UI", 25F, FontStyle.Bold), ForeColor = Color.FromArgb(3, 46, 66), AutoSize = true, Location = new Point(138, 63) });

        Controls.Add(new Label { Text = "Installation d'Assistant Planning", Bounds = new Rectangle(34, 148, 570, 32), ForeColor = Color.FromArgb(3, 46, 66), Font = new Font("Segoe UI", 11F, FontStyle.Bold) });
        Panel busyPanel = new Panel { Bounds = new Rectangle(34, 190, 570, 340), BackColor = Color.FromArgb(250, 250, 249) };
        Controls.Add(busyPanel);
        spinner.SetBounds(235, 62, 100, 70);
        spinner.Font = new Font("Segoe UI", 36F);
        spinner.ForeColor = Color.FromArgb(232, 35, 42);
        spinner.Text = "|";
        spinner.TextAlign = ContentAlignment.MiddleCenter;
        busyPanel.Controls.Add(spinner);
        Label title = new Label { Text = "Installation en cours — v" + version, Bounds = new Rectangle(40, 140, 490, 42), Font = new Font("Segoe UI", 12F, FontStyle.Bold), ForeColor = Color.FromArgb(3, 46, 66), TextAlign = ContentAlignment.MiddleCenter };
        busyPanel.Controls.Add(title);
        status.SetBounds(40, 194, 490, 30);
        status.Text = "Préparation des composants";
        status.ForeColor = Color.FromArgb(3, 46, 66);
        status.TextAlign = ContentAlignment.MiddleCenter;
        busyPanel.Controls.Add(status);
        progress.SetBounds(70, 245, 430, 18);
        progress.Style = ProgressBarStyle.Marquee;
        progress.MarqueeAnimationSpeed = 25;
        busyPanel.Controls.Add(progress);
        busyPanel.Controls.Add(new Label { Text = "Merci de patienter. Ne fermez pas Assistant Planning.", Bounds = new Rectangle(15, 282, 540, 38), ForeColor = Color.FromArgb(120, 128, 132), Font = new Font("Segoe UI", 9F), TextAlign = ContentAlignment.MiddleCenter });
        Controls.Add(new Label { Text = "Installation sécurisée pour ce compte Windows", Bounds = new Rectangle(34, 612, 570, 28), ForeColor = Color.FromArgb(94, 107, 113), TextAlign = ContentAlignment.MiddleCenter });
        Controls.Add(new Label { Text = "Assistant Planning - v" + version, Bounds = new Rectangle(34, 760, 570, 24), ForeColor = Color.FromArgb(120, 128, 132), Font = new Font("Segoe UI", 9F) });
        busyTimer.Interval = 120;
        busyTimer.Tick += (s, e) => { string[] frames = { "|", "/", "-", "\\" }; int index = busyTimer.Tag == null ? 0 : (int)busyTimer.Tag; index = (index + 1) % frames.Length; busyTimer.Tag = index; spinner.Text = frames[index]; };
        busyTimer.Start();
        Shown += BeginInstall;
    }

    private async void BeginInstall(object sender, EventArgs e)
    {
        try
        {
            await Task.Run(new Action(Install));
            progress.Style = ProgressBarStyle.Continuous;
            progress.Value = 100;
            status.Text = "Installation terminée. Assistant Planning va démarrer.";
            var timer = new Timer { Interval = 1400 };
            timer.Tick += (s, a) => { timer.Stop(); Close(); };
            timer.Start();
        }
        catch (Exception error)
        {
            busyTimer.Stop();
            Environment.ExitCode = 1;
            Log(error.ToString());
            progress.Style = ProgressBarStyle.Continuous;
            progress.Value = 0;
            status.Text = "L'installation n'a pas pu être terminée.";
            MessageBox.Show(this,
                "L'installation n'a pas pu être terminée. Fermez Assistant Planning s'il est ouvert, puis réessayez.\n\n" + error.Message + "\n\nJournal : " + InstallLog,
                "Assistant Planning",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }
    }

    private static string AppRoot
    {
        get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Assistant Planning"); }
    }

    private static string ReadPayloadToTemp()
    {
        const int footerSize = 16;
        string self = Process.GetCurrentProcess().MainModule.FileName;
        using (FileStream input = File.OpenRead(self))
        {
            if (input.Length < footerSize) throw new InvalidDataException("Package absent.");
            input.Seek(-footerSize, SeekOrigin.End);
            byte[] footer = new byte[footerSize];
            ReadFully(input, footer, 0, footer.Length);
            string magic = Encoding.ASCII.GetString(footer, 0, 8);
            if (magic != "SDISPKG1") throw new InvalidDataException("Package invalide.");
            long length = BitConverter.ToInt64(footer, 8);
            long start = input.Length - footerSize - length;
            if (length <= 0 || start < 0 || start > input.Length) throw new InvalidDataException("Package invalide.");

            string zip = Path.Combine(Path.GetTempPath(), "Assistant-Planning-package-" + Guid.NewGuid().ToString("N") + ".zip");
            input.Seek(start, SeekOrigin.Begin);
            using (FileStream output = File.Create(zip))
            {
                CopyBytes(input, output, length);
            }
            return zip;
        }
    }

    private static void ExtractSafe(string zip, string destination)
    {
        Directory.CreateDirectory(destination);
        string root = Path.GetFullPath(destination).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        using (FileStream file = File.OpenRead(zip))
        using (ZipArchive archive = new ZipArchive(file, ZipArchiveMode.Read))
        {
            foreach (ZipArchiveEntry entry in archive.Entries)
            {
                string target = Path.GetFullPath(Path.Combine(destination, entry.FullName.Replace('/', Path.DirectorySeparatorChar)));
                if (!target.StartsWith(root, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Package invalide.");
                if (String.IsNullOrEmpty(entry.Name))
                {
                    Directory.CreateDirectory(target);
                    continue;
                }
                Directory.CreateDirectory(Path.GetDirectoryName(target));
                using (Stream source = entry.Open())
                using (FileStream output = File.Create(target))
                {
                    source.CopyTo(output);
                }
            }
        }
    }

    private static void Install()
    {
        Log("START " + Process.GetCurrentProcess().MainModule.FileName);
        string tempZip = ReadPayloadToTemp();
        try
        {
            InstallPackage(tempZip, AppRoot, ShortcutPaths(), delegate(string app) {
                Process.Start(new ProcessStartInfo(app) { WorkingDirectory = AppRoot, UseShellExecute = true });
            });
            Log("SUCCESS " + AppRoot);
        }
        finally { TryDelete(tempZip); }
    }

    private static void InstallPackage(string zip, string destination, string[] shortcuts, Action<string> launch)
    {
        string tempRoot = destination + ".install-" + Guid.NewGuid().ToString("N");
        string backup = destination + ".backup-" + Guid.NewGuid().ToString("N");
        bool movedOld = false;
        bool installedNew = false;
        int touchedShortcuts = 0;
        byte[][] oldShortcuts = new byte[shortcuts.Length][];
        try
        {
            for (int i = 0; i < shortcuts.Length; i++)
                oldShortcuts[i] = File.Exists(shortcuts[i]) ? File.ReadAllBytes(shortcuts[i]) : null;
            ExtractSafe(zip, tempRoot);
            Log("EXTRACTED " + tempRoot);
            string app = Path.Combine(tempRoot, "SDIS-Collegues.exe");
            string node = Path.Combine(tempRoot, "runtime", "node", "node.exe");
            if (!File.Exists(app) || !File.Exists(node) || !Directory.Exists(Path.Combine(tempRoot, "runtime", "browser")))
                throw new InvalidDataException("Package incomplet.");

            if (Directory.Exists(destination))
            {
                StopInstalledProcesses(destination);
                MoveOldInstallation(destination, backup);
                movedOld = true;
            }
            Directory.Move(tempRoot, destination);
            installedNew = true;
            tempRoot = null;
            app = Path.Combine(destination, "SDIS-Collegues.exe");
            for (int i = 0; i < shortcuts.Length; i++)
            {
                touchedShortcuts = i + 1;
                bool isStartup = String.Equals(Path.GetFileName(Path.GetDirectoryName(shortcuts[i])), "Startup", StringComparison.OrdinalIgnoreCase);
                CreateShortcut(shortcuts[i], app);
            }
            ConfigureBackgroundTask(destination);
            Log("INSTALLED " + destination);
            launch(app);
            // Keep the previous installation for recovery; user data stays intact.
        }
        catch (Exception installError)
        {
            Exception rollbackError = null;
            try
            {
                if (installedNew && Directory.Exists(destination)) Directory.Delete(destination, true);
                if (movedOld) Directory.Move(backup, destination);
            }
            catch (Exception error) { rollbackError = error; }
            for (int i = 0; i < touchedShortcuts; i++)
            {
                try
                {
                    if (oldShortcuts[i] == null) File.Delete(shortcuts[i]);
                    else File.WriteAllBytes(shortcuts[i], oldShortcuts[i]);
                }
                catch (Exception error) { rollbackError = error; }
            }
            if (rollbackError != null)
                throw new IOException("Restauration incomplète. Sauvegarde conservée si présente : " + backup,
                    new AggregateException(installError, rollbackError));
            throw;
        }
        finally
        {
            TryDelete(tempRoot);
        }
    }

    private static void StopInstalledProcesses(string destination)
    {
        string root = Path.GetFullPath(destination).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        int self = Process.GetCurrentProcess().Id;
        foreach (Process process in Process.GetProcesses())
        {
            using (process)
            {
                try
                {
                    if (process.Id == self) continue;
                    string executable = Path.GetFullPath(process.MainModule.FileName);
                    if (!executable.StartsWith(root, StringComparison.OrdinalIgnoreCase)) continue;
                    Log("CLOSE " + executable + " PID=" + process.Id);
                    if (process.CloseMainWindow() && process.WaitForExit(2000)) continue;
                    if (!process.HasExited) process.Kill();
                    if (!process.WaitForExit(5000)) throw new IOException("Un processus de l'ancienne installation ne se ferme pas : " + executable);
                }
                catch (System.ComponentModel.Win32Exception) { }
                catch (InvalidOperationException) { }
            }
        }
    }

    private static void MoveOldInstallation(string destination, string backup)
    {
        for (int attempt = 0; ; attempt++)
        {
            try { Directory.Move(destination, backup); return; }
            catch (IOException) { if (attempt >= 9) throw; }
            catch (UnauthorizedAccessException error)
            {
                if (attempt >= 9) throw new IOException("Windows refuse le remplacement du dossier " + destination + ". Les fichiers de l'ancienne installation ont été conservés. Vérifiez les autorisations du dossier ou le blocage par l'antivirus.", error);
            }
            System.Threading.Thread.Sleep(300);
        }
    }


    private static string[] ShortcutPaths()
    {
        string programs = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Microsoft", "Windows", "Start Menu", "Programs");
        string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
        return new string[] { Path.Combine(programs, "Assistant Planning.lnk"),
            Path.Combine(desktop, "Assistant Planning.lnk") };
    }

    private static void CreateShortcut(string path, string target)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path));
        Type shellType = Type.GetTypeFromProgID("WScript.Shell");
        dynamic shell = Activator.CreateInstance(shellType);
        dynamic link = shell.CreateShortcut(path);
        link.TargetPath = target;
        link.WorkingDirectory = Path.GetDirectoryName(target);
        link.IconLocation = target + ",0";
        link.Description = "Assistant Planning";
        link.Save();
    }

    private static void ConfigureBackgroundTask(string destination)
    {
        try
        {
            string script = Path.Combine(destination, "configure-background-task.ps1");
            string windir = Environment.GetEnvironmentVariable("WINDIR") ?? "C:\\Windows";
            string powershell = Path.Combine(windir, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
            if (!File.Exists(script) || !File.Exists(powershell)) throw new IOException("Composant de démarrage automatique absent.");
            using(Process process=Process.Start(new ProcessStartInfo {
                FileName = powershell,
                Arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File \"" + script + "\" -InstallRoot \"" + destination + "\"",
                WorkingDirectory = destination,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden
            })) { process.WaitForExit(); if(process.ExitCode!=0) throw new IOException("Configuration du démarrage automatique impossible."); }
        }
        catch (Exception error) { throw new IOException("Installation du démarrage automatique impossible.",error); }
    }

    private static void ReadFully(Stream input, byte[] buffer, int offset, int count)
    {
        while (count > 0)
        {
            int read = input.Read(buffer, offset, count);
            if (read <= 0) throw new EndOfStreamException();
            offset += read;
            count -= read;
        }
    }

    private static void CopyBytes(Stream input, Stream output, long count)
    {
        byte[] buffer = new byte[1024 * 1024];
        while (count > 0)
        {
            int wanted = (int)Math.Min(buffer.Length, count);
            int read = input.Read(buffer, 0, wanted);
            if (read <= 0) throw new EndOfStreamException();
            output.Write(buffer, 0, read);
            count -= read;
        }
    }

    private static void TryDelete(string path)
    {
        if (String.IsNullOrEmpty(path)) return;
        try
        {
            if (File.Exists(path)) File.Delete(path);
            else if (Directory.Exists(path)) Directory.Delete(path, true);
        }
        catch { }
    }
}

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new InstallerForm());
    }
}
