// Калькулятор каркасного дома — оболочка на WebView2 (.NET Framework 4.x)
using System;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace KarkasCalc
{
    static class Program
    {
        [STAThread]
        static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            string wwwDir = Path.Combine(baseDir, "www");
            if (!Directory.Exists(Path.Combine(wwwDir, "data")))
            {
                MessageBox.Show("Не найдена папка с интерфейсом приложения:\n" + wwwDir +
                    "\n\nПереустановите приложение.", "Калькулятор каркасного дома",
                    MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            string browserVersion = null;
            try
            {
                browserVersion = CoreWebView2Environment.GetAvailableBrowserVersionString();
            }
            catch (WebView2RuntimeNotFoundException) { }
            catch (Exception) { }

            if (string.IsNullOrEmpty(browserVersion))
            {
                var r = MessageBox.Show(
                    "На компьютере не найдена среда выполнения Microsoft Edge WebView2.\n" +
                    "Она нужна для работы интерфейса приложения.\n\n" +
                    "Скачать среду выполнения сейчас?",
                    "Калькулятор каркасного дома",
                    MessageBoxButtons.YesNo, MessageBoxIcon.Information);
                if (r == DialogResult.Yes)
                {
                    try
                    {
                        Process.Start("https://go.microsoft.com/fwlink/p/?LinkId=2124703");
                    }
                    catch { }
                }
                return;
            }

            Application.Run(new MainForm(wwwDir, baseDir));
        }
    }

    public class MainForm : Form
    {
        private readonly WebView2 _web = new WebView2();
        private CoreWebView2Environment _env;
        private const string YandexPublicUrl = "https://disk.yandex.ru/i/f027lR2bCUJseA";
        private static readonly HttpClient _http = CreateHttp();

        public MainForm(string wwwDir, string baseDir)
        {
            Text = "Калькулятор каркасного дома";
            StartPosition = FormStartPosition.CenterScreen;
            MinimumSize = new System.Drawing.Size(1080, 680);
            Size = new System.Drawing.Size(1460, 920);
            WindowState = FormWindowState.Maximized;
            BackColor = System.Drawing.Color.FromArgb(11, 13, 18);
            Font = new System.Drawing.Font("Segoe UI", 9.5f);

            string iconPath = Path.Combine(baseDir, "app.ico");
            if (File.Exists(iconPath))
            {
                try { Icon = new System.Drawing.Icon(iconPath); } catch { }
            }

            _web.Dock = DockStyle.Fill;
            Controls.Add(_web);

            Load += async (s, e) =>
            {
                string userData = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "KarkasDomCalculator", "WebView2");
                var env = await CoreWebView2Environment.CreateAsync(null, userData);
                _env = env;
                await _web.EnsureCoreWebView2Async(env);

                var st = _web.CoreWebView2.Settings;
                st.AreDefaultContextMenusEnabled = false;
                st.AreDevToolsEnabled = false;
                st.IsZoomControlEnabled = false;
                st.IsStatusBarEnabled = false;
                st.AreBrowserAcceleratorKeysEnabled = false;

                _web.CoreWebView2.DocumentTitleChanged += (s2, e2) =>
                {
                    Text = string.IsNullOrEmpty(_web.CoreWebView2.DocumentTitle)
                        ? "Калькулятор каркасного дома"
                        : _web.CoreWebView2.DocumentTitle;
                };

                // Локальный виртуальный хост: запросы https://app.karkas-dom.local/*
                // обслуживаются файлами из папки www (без реального HTTP-сервера)
                const string Host = "https://app.karkas-dom.local/";
                _web.CoreWebView2.AddWebResourceRequestedFilter(
                    Host + "*", CoreWebView2WebResourceContext.All);
                _web.CoreWebView2.WebResourceRequested += (s2, e2) =>
                {
                    var reqUri = new Uri(e2.Request.Uri);

                    // /api/yandex — скачивание актуального прайса с Яндекс.Диска
                    if (reqUri.AbsolutePath.StartsWith("/api/yandex", StringComparison.OrdinalIgnoreCase))
                    {
                        var deferral = e2.GetDeferral();
                        Log("yandex: запрос получен");
                        Task.Run(() =>
                        {
                            byte[] bytes = null;
                            string fname = "yandex.xlsx";
                            string error = null;
                            try
                            {
                                FetchYandexFile(out bytes, out fname);
                                Log("yandex: скачано " + bytes.Length + " байт (" + fname + ")");
                            }
                            catch (Exception ex)
                            {
                                error = ex.Message;
                                Log("yandex: ошибка скачивания — " + error);
                            }

                            // Объекты WebView2 привязаны к UI-потоку — назначаем ответ оттуда
                            try
                            {
                                BeginInvoke((Action)(() =>
                                {
                                    try
                                    {
                                        if (error != null)
                                        {
                                            byte[] msg = Encoding.UTF8.GetBytes("Yandex error: " + error);
                                            e2.Response = env.CreateWebResourceResponse(new MemoryStream(msg), 502, "Bad Gateway",
                                                "Content-Type: text/plain; charset=utf-8");
                                        }
                                        else
                                        {
                                            e2.Response = env.CreateWebResourceResponse(new MemoryStream(bytes), 200, "OK",
                                                "Content-Type: application/octet-stream\r\nX-Yandex-File-Name: " +
                                                Uri.EscapeDataString(fname));
                                        }
                                    }
                                    catch (Exception ex2)
                                    {
                                        Log("yandex: ошибка формирования ответа — " + ex2.Message);
                                    }
                                    finally
                                    {
                                        deferral.Complete();
                                    }
                                }));
                            }
                            catch (Exception ex3)
                            {
                                Log("yandex: ошибка вызова UI-потока — " + ex3.Message);
                                try { deferral.Complete(); } catch { }
                            }
                        });
                        return;
                    }

                    try
                    {
                        string rel = Uri.UnescapeDataString(reqUri.AbsolutePath).TrimStart('/');
                        if (rel.Length == 0) rel = "index.html";
                        string path = Path.GetFullPath(Path.Combine(wwwDir, rel.Replace('/', Path.DirectorySeparatorChar)));
                        if (!path.StartsWith(wwwDir, StringComparison.OrdinalIgnoreCase) ||
                            !File.Exists(path))
                        {
                            e2.Response = env.CreateWebResourceResponse(
                                System.IO.Stream.Null, 404, "Not Found", "Content-Type: text/plain");
                            return;
                        }
                        string ct = GetContentType(Path.GetExtension(path));
                        var fs = new FileStream(path, FileMode.Open, FileAccess.Read,
                            FileShare.ReadWrite | FileShare.Delete);
                        e2.Response = env.CreateWebResourceResponse(
                            fs, 200, "OK", "Content-Type: " + ct);
                    }
                    catch
                    {
                        e2.Response = env.CreateWebResourceResponse(
                            System.IO.Stream.Null, 500, "Error", "Content-Type: text/plain");
                    }
                };

                _web.CoreWebView2.Navigate(Host + "index.html");
            };
        }

        /* Скачивание актуального прайса с Яндекс.Диска.
           Файл размещён в новом хранилище «Яндекс Документов», где cloud-api
           отдаёт пустую ссылку скачивания, поэтому используем цепочку:
           страница публичной ссылки → WOPI-идентификатор и токен → файл. */
        /* Журнал диагностики — помогает разобраться, если кнопка обновления не сработает */
        private static void Log(string msg)
        {
            try
            {
                string dir = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "KarkasDomCalculator");
                Directory.CreateDirectory(dir);
                File.AppendAllText(Path.Combine(dir, "host.log"),
                    DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + msg + "\r\n");
            }
            catch { }
        }

        private static HttpClient CreateHttp()
        {
            var h = new HttpClient { Timeout = TimeSpan.FromSeconds(60) };
            h.DefaultRequestHeaders.UserAgent.ParseAdd("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36");
            h.DefaultRequestHeaders.Accept.ParseAdd("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
            h.DefaultRequestHeaders.AcceptLanguage.ParseAdd("ru-RU,ru;q=0.9");
            return h;
        }

        private static void FetchYandexFile(out byte[] bytes, out string fname)
        {
            string html = _http.GetStringAsync(YandexPublicUrl + "?download=1")
                .GetAwaiter().GetResult();

            var mId = Regex.Match(html,
                @"WOPISrc=https%3A%2F%2Foffice-online\.disk\.yandex\.net%2Fv1%2Fdisk%2Fwopi%2Ffiles%2F([A-Za-z0-9_\-]+)");
            var mTok = Regex.Match(html, "\"access_token\":\"([^\"]+)\"");
            var mTtl = Regex.Match(html, "\"access_token_ttl\":\"?(\\d+)\"?");
            if (!mId.Success || !mTok.Success)
                throw new Exception("Не удалось получить доступ к файлу на Яндекс.Диске");

            fname = "yandex.xlsx";
            try
            {
                string meta = _http.GetStringAsync(
                    "https://cloud-api.yandex.net/v1/disk/public/resources?public_key=" +
                    Uri.EscapeDataString(YandexPublicUrl)).GetAwaiter().GetResult();
                var mN = Regex.Match(meta, "\"name\":\"([^\"]+)\"");
                if (mN.Success) fname = mN.Groups[1].Value.Replace("\\/", "/");
            }
            catch { }

            string url = "https://office-online.disk.yandex.net/v1/disk/wopi/files/" +
                mId.Groups[1].Value + "/contents?access_token=" +
                Uri.EscapeDataString(mTok.Groups[1].Value);
            if (mTtl.Success) url += "&access_token_ttl=" + mTtl.Groups[1].Value;

            bytes = _http.GetByteArrayAsync(url).GetAwaiter().GetResult();
            if (bytes.Length < 100)
                throw new Exception("Получен пустой файл с Яндекс.Диска");
        }

        private static string GetContentType(string ext)
        {
            switch ((ext ?? "").ToLowerInvariant())
            {
                case ".html": case ".htm": return "text/html; charset=utf-8";
                case ".css": return "text/css; charset=utf-8";
                case ".js": return "application/javascript; charset=utf-8";
                case ".json": return "application/json";
                case ".png": return "image/png";
                case ".ico": return "image/x-icon";
                case ".svg": return "image/svg+xml";
                case ".csv": return "text/csv";
                default: return "application/octet-stream";
            }
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            base.OnFormClosing(e);
        }
    }
}
