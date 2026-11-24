// Установщик «Калькулятор каркасного дома» — одиночный exe, устанавливает приложение
// в профиль пользователя (%LOCALAPPDATA%), создаёт ярлыки и запись «Установка и удаление программ».
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

namespace KarkasInst
{
    static class Program
    {
        [STAThread]
        static int Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            if (args.Length > 0 && string.Equals(args[0], "/uninstall", StringComparison.OrdinalIgnoreCase))
                return UninstallForm.Run();

            // Тихая установка без интерфейса: /silent
            if (args.Length > 0 && string.Equals(args[0], "/silent", StringComparison.OrdinalIgnoreCase))
            {
                string resultFile = Path.Combine(Path.GetTempPath(), "karkas_install_result.txt");
                try
                {
                    Pkg.Install(true, null);
                    File.WriteAllText(resultFile, "OK " + Pkg.InstallRoot);
                    return 0;
                }
                catch (Exception ex)
                {
                    try { File.WriteAllText(resultFile, "ERROR " + ex.Message); } catch { }
                    return 1;
                }
            }

            Application.Run(new InstallForm());
            return 0;
        }
    }

    public static class Pkg
    {
        public const string AppFileName = "Калькулятор каркасного дома.exe";
        public const string InstallDirName = "KarkasDomCalculator";
        public const string AppTitle = "Калькулятор каркасного дома";
        public const string Version = "1.0.0";

        public static string InstallRoot
        {
            get
            {
                return Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    InstallDirName);
            }
        }

        public static string AppExePath
        {
            get { return Path.Combine(InstallRoot, AppFileName); }
        }

        // Все файлы пакета: имя ресурса -> относительный путь
        public static readonly Dictionary<string, string> Files = new Dictionary<string, string>
        {
            { "KarkasInst.CalcApp.exe", AppFileName },
            { "KarkasInst.app.ico", "app.ico" },
            { "KarkasInst.wv_Core_dll", "Microsoft.Web.WebView2.Core.dll" },
            { "KarkasInst.wv_WinForms_dll", "Microsoft.Web.WebView2.WinForms.dll" },
            { "KarkasInst.wv_Loader_dll", "WebView2Loader.dll" },
            { "KarkasInst.www_index_html", "www\\index.html" },
            { "KarkasInst.www_styles_css", "www\\styles.css" },
            { "KarkasInst.www_app_js", "www\\app.js" },
            { "KarkasInst.www_vendor_xlsx_js", "www\\vendor\\xlsx.full.min.js" },
            { "KarkasInst.www_data_dataset_js", "www\\data\\default-dataset.js" },
        };

        public static byte[] Read(string resourceName)
        {
            var asm = Assembly.GetExecutingAssembly();
            using (var s = asm.GetManifestResourceStream(resourceName))
            {
                if (s == null)
                    throw new FileNotFoundException("Ресурс не найден: " + resourceName);
                var buf = new byte[s.Length];
                using (var ms = new MemoryStream(buf))
                {
                    s.CopyTo(ms);
                    return buf;
                }
            }
        }

        // Установка: распаковка файлов, ярлыки, запись об удалении
        public static void Install(bool makeShortcuts, Action<string, int> status)
        {
            Directory.CreateDirectory(InstallRoot);

            try
            {
                foreach (var p in Process.GetProcessesByName(Path.GetFileNameWithoutExtension(AppFileName)))
                {
                    p.Kill();
                    p.WaitForExit(3000);
                }
            }
            catch { }

            // Дочерние процессы WebView2 приложения могут держать папку данных —
            // завершаем их, чтобы следующая установка и запуск прошли корректно
            try
            {
                foreach (var p in Process.GetProcessesByName("msedgewebview2"))
                {
                    string cmd = "";
                    try { cmd = GetCommandLine(p.Id); } catch { }
                    if (cmd.IndexOf(InstallDirName, StringComparison.OrdinalIgnoreCase) >= 0)
                    {
                        p.Kill();
                    }
                }
            }
            catch { }

            int n = 0, total = Files.Count;
            foreach (var kv in Files)
            {
                n++;
                if (status != null) status("Установка: " + kv.Value, 10 + (int)((double)n / total * 70));
                var target = Path.Combine(InstallRoot, kv.Value);
                Directory.CreateDirectory(Path.GetDirectoryName(target));
                File.WriteAllBytes(target, Read(kv.Key));
            }

            string iconPath = Path.Combine(InstallRoot, "app.ico");

            if (makeShortcuts)
            {
                if (status != null) status("Создание ярлыков...", 90);
                string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                string startMenu = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.StartMenu), "Programs");
                MakeShortcut(Path.Combine(desktop, AppTitle + ".lnk"), AppExePath, InstallRoot, iconPath);
                MakeShortcut(Path.Combine(startMenu, AppTitle + ".lnk"), AppExePath, InstallRoot, iconPath);
            }

            if (status != null) status("Регистрация в системе...", 95);
            RegisterUninstall(iconPath);
        }

        private static string GetCommandLine(int pid)
        {
            var p = new System.Diagnostics.ProcessStartInfo
            {
                FileName = "wmic",
                Arguments = "process where processid=" + pid + " get commandline /format:list",
                UseShellExecute = false,
                RedirectStandardOutput = true,
                CreateNoWindow = true
            };
            using (var pr = System.Diagnostics.Process.Start(p))
            {
                string outp = pr.StandardOutput.ReadToEnd();
                pr.WaitForExit(5000);
                return outp;
            }
        }

        public static void MakeShortcut(string lnkPath, string target, string workDir, string iconPath)
        {
            var shellType = Type.GetTypeFromProgID("WScript.Shell");
            object shell = Activator.CreateInstance(shellType);
            object shortcut = shellType.InvokeMember("CreateShortcut",
                BindingFlags.InvokeMethod, null, shell, new object[] { lnkPath });
            var shType = shortcut.GetType();
            shType.InvokeMember("TargetPath", BindingFlags.SetProperty, null, shortcut, new object[] { target });
            shType.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, shortcut, new object[] { workDir });
            shType.InvokeMember("IconLocation", BindingFlags.SetProperty, null, shortcut, new object[] { iconPath + ",0" });
            shType.InvokeMember("Description", BindingFlags.SetProperty, null, shortcut, new object[] { AppTitle + " — расчёт стоимости строительства" });
            shType.InvokeMember("Save", BindingFlags.InvokeMethod, null, shortcut, null);
        }

        public static void RegisterUninstall(string iconPath)
        {
            using (var key = Microsoft.Win32.Registry.CurrentUser.CreateSubKey(
                @"Software\Microsoft\Windows\CurrentVersion\Uninstall\" + InstallDirName))
            {
                key.SetValue("DisplayName", AppTitle);
                key.SetValue("DisplayVersion", Version);
                key.SetValue("Publisher", AppTitle);
                key.SetValue("InstallLocation", InstallRoot);
                key.SetValue("DisplayIcon", iconPath);
                key.SetValue("UninstallString", "\"" + Assembly.GetExecutingAssembly().Location + "\" /uninstall");
                key.SetValue("NoModify", 1, Microsoft.Win32.RegistryValueKind.DWord);
                key.SetValue("NoRepair", 1, Microsoft.Win32.RegistryValueKind.DWord);
            }
        }
    }

    public class DarkForm : Form
    {
        protected System.Drawing.Color Bg = System.Drawing.Color.FromArgb(11, 13, 18);
        protected System.Drawing.Color Panel = System.Drawing.Color.FromArgb(21, 25, 35);
        protected System.Drawing.Color Accent = System.Drawing.Color.FromArgb(240, 169, 59);
        protected System.Drawing.Color Accent2 = System.Drawing.Color.FromArgb(255, 196, 107);
        protected System.Drawing.Color Txt = System.Drawing.Color.FromArgb(233, 236, 243);
        protected System.Drawing.Color Txt2 = System.Drawing.Color.FromArgb(154, 163, 182);

        protected Button AccentButton(string text)
        {
            var b = new Button();
            b.Text = text;
            b.AutoSize = true;
            b.FlatStyle = FlatStyle.Flat;
            b.Font = new System.Drawing.Font("Segoe UI", 10f, System.Drawing.FontStyle.Bold);
            b.ForeColor = System.Drawing.Color.FromArgb(23, 19, 10);
            b.BackColor = Accent;
            b.FlatAppearance.BorderSize = 0;
            b.Cursor = Cursors.Hand;
            b.Padding = new Padding(14, 8, 14, 8);
            b.MouseEnter += (s, e) => { b.BackColor = Accent2; };
            b.MouseLeave += (s, e) => { b.BackColor = Accent; };
            return b;
        }
    }

    public class InstallForm : DarkForm
    {
        private readonly System.Windows.Forms.Label _status = new Label();
        private readonly ProgressBar _bar = new ProgressBar();
        private readonly Button _installBtn;
        private readonly Button _runBtn;
        private readonly CheckBox _shortcuts = new CheckBox();
        private bool _installed;

        public InstallForm()
        {
            Text = Pkg.AppTitle + " — установка";
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            MinimizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new System.Drawing.Size(620, 430);
            BackColor = Bg;
            Font = new System.Drawing.Font("Segoe UI", 9.5f);

            string iconRes = Path.GetTempFileName();
            try
            {
                System.IO.File.WriteAllBytes(iconRes, Pkg.Read("KarkasInst.app.ico"));
                using (var ic = new System.Drawing.Icon(iconRes)) Icon = (System.Drawing.Icon)ic.Clone();
            }
            catch { }
            finally { try { System.IO.File.Delete(iconRes); } catch { } }

            // Заголовок
            var title = new Label();
            title.Text = Pkg.AppTitle;
            title.Font = new System.Drawing.Font("Segoe UI", 20f, System.Drawing.FontStyle.Bold);
            title.ForeColor = Txt;
            title.Location = new System.Drawing.Point(36, 30);
            title.AutoSize = true;

            var sub = new Label();
            sub.Text = "Установка на компьютер · версия " + Pkg.Version;
            sub.Font = new System.Drawing.Font("Segoe UI", 10.5f);
            sub.ForeColor = Accent2;
            sub.Location = new System.Drawing.Point(38, 74);
            sub.AutoSize = true;

            var desc = new Label();
            desc.Text = "Приложение будет установлено в профиль пользователя:\r\n" +
                Pkg.InstallRoot + "\r\n\r\n" +
                "Права администратора не требуются. Интернет-соединение после установки не нужно.";
            desc.Font = new System.Drawing.Font("Segoe UI", 9.5f);
            desc.ForeColor = Txt2;
            desc.Location = new System.Drawing.Point(38, 118);
            desc.Size = new System.Drawing.Size(540, 66);

            _shortcuts.Text = "Создать ярлыки на рабочем столе и в меню «Пуск»";
            _shortcuts.Checked = true;
            _shortcuts.ForeColor = Txt;
            _shortcuts.Location = new System.Drawing.Point(38, 196);
            _shortcuts.AutoSize = true;

            _bar.Location = new System.Drawing.Point(38, 246);
            _bar.Size = new System.Drawing.Size(540, 22);
            _bar.Style = ProgressBarStyle.Continuous;
            _bar.Minimum = 0;
            _bar.Maximum = 100;
            _bar.Value = 0;

            _status.ForeColor = Txt2;
            _status.Location = new System.Drawing.Point(38, 278);
            _status.Size = new System.Drawing.Size(540, 44);

            _installBtn = AccentButton("Установить");
            _installBtn.Location = new System.Drawing.Point(38, 350);
            _installBtn.Click += (s, e) => DoInstall();

            _runBtn = AccentButton("Запустить приложение");
            _runBtn.Location = new System.Drawing.Point(38, 350);
            _runBtn.Visible = false;
            _runBtn.Click += (s, e) =>
            {
                try { Process.Start(Pkg.AppExePath); } catch { }
                Close();
            };

            var doneBtn = new Button();
            doneBtn.Text = "Готово";
            doneBtn.AutoSize = true;
            doneBtn.FlatStyle = FlatStyle.Flat;
            doneBtn.Font = new System.Drawing.Font("Segoe UI", 10f);
            doneBtn.ForeColor = Txt;
            doneBtn.BackColor = Panel;
            doneBtn.FlatAppearance.BorderColor = System.Drawing.Color.FromArgb(60, 66, 84);
            doneBtn.Cursor = Cursors.Hand;
            doneBtn.Padding = new Padding(14, 8, 14, 8);
            doneBtn.Location = new System.Drawing.Point(190, 350);
            doneBtn.Visible = false;
            doneBtn.Click += (s, e) => Close();

            Controls.Add(title);
            Controls.Add(sub);
            Controls.Add(desc);
            Controls.Add(_shortcuts);
            Controls.Add(_bar);
            Controls.Add(_status);
            Controls.Add(_installBtn);
            Controls.Add(_runBtn);
            Controls.Add(doneBtn);

            _doneBtn = doneBtn;
        }

        private Button _doneBtn;

        private void DoInstall()
        {
            _installBtn.Enabled = false;
            _shortcuts.Enabled = false;
            try
            {
                SetStatus("Подготовка папки установки...", 5);
                Pkg.Install(_shortcuts.Checked, (text, pct) => SetStatus(text, pct));

                SetStatus("Установка завершена!", 100);
                _installed = true;
                _installBtn.Visible = false;
                _runBtn.Visible = true;
                _doneBtn.Visible = true;
                _doneBtn.Location = new System.Drawing.Point(_runBtn.Right + 12, 350);
            }
            catch (Exception ex)
            {
                SetStatus("Ошибка установки: " + ex.Message, 0);
                _installBtn.Enabled = true;
                _shortcuts.Enabled = true;
                MessageBox.Show(ex.ToString(), "Ошибка", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private void SetStatus(string text, int pct)
        {
            _status.Text = text;
            _bar.Value = Math.Min(100, Math.Max(0, pct));
            Application.DoEvents();
        }
    }

    public class UninstallForm : DarkForm
    {
        public static int Run()
        {
            var r = MessageBox.Show(
                "Удалить «" + Pkg.AppTitle + "» и все его файлы?\n\n" +
                "Папка: " + Pkg.InstallRoot,
                "Удаление приложения",
                MessageBoxButtons.YesNo, MessageBoxIcon.Question);
            if (r != DialogResult.Yes) return 0;

            try
            {
                foreach (var p in Process.GetProcessesByName(Path.GetFileNameWithoutExtension(Pkg.AppFileName)))
                {
                    try { p.Kill(); p.WaitForExit(3000); } catch { }
                }

                string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                string startMenu = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.StartMenu), "Programs");
                TryDelete(Path.Combine(desktop, Pkg.AppTitle + ".lnk"));
                TryDelete(Path.Combine(startMenu, Pkg.AppTitle + ".lnk"));

                try
                {
                    Microsoft.Win32.Registry.CurrentUser.DeleteSubKeyTree(
                        @"Software\Microsoft\Windows\CurrentVersion\Uninstall\" + Pkg.InstallDirName, false);
                }
                catch { }

                try { Directory.Delete(Pkg.InstallRoot, true); } catch { }

                MessageBox.Show("Приложение удалено.", "Удаление",
                    MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
            catch (Exception ex)
            {
                MessageBox.Show("Ошибка удаления: " + ex.Message, "Удаление",
                    MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
            return 0;
        }

        private static void TryDelete(string path)
        {
            try { if (System.IO.File.Exists(path)) System.IO.File.Delete(path); } catch { }
        }
    }
}
