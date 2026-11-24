# ============================================================
#  Сборка «Калькулятора каркасного дома»
#  Требуется: Windows, .NET Framework 4.x (csc входит в состав),
#  установленный Microsoft Edge WebView2 Runtime.
#  Запуск: powershell -ExecutionPolicy Bypass -File build.ps1
#  Результат: build\out\УстановитьКалькуляторКаркасногоДома.exe
#             build\out\app\  (портативная версия)
# ============================================================
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$deps = Join-Path $root 'deps'
$csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = 'C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe' }

# Имя приложения собирается из кодов символов (скрипт в ASCII)
$codes = 0x041A,0x0430,0x043B,0x044C,0x043A,0x0443,0x043B,0x044F,0x0442,0x043E,0x0440,0x0020,0x043A,0x0430,0x0440,0x043A,0x0430,0x0441,0x043D,0x043E,0x0433,0x043E,0x0020,0x0434,0x043E,0x043C,0x0430
$appName = (-join ($codes | ForEach-Object { [char]$_ })) + '.exe'

$out = Join-Path $root 'build\out'
$app = Join-Path $out 'app'
New-Item -ItemType Directory -Force -Path $app, (Join-Path $app 'www\data'), (Join-Path $app 'www\vendor') | Out-Null

Write-Host '== 1. Compile app (WebView2 host) =='
$appArgs = @(
    '/nologo',
    '/codepage:65001',
    '/target:winexe',
    '/platform:x64',
    '/optimize+',
    ('/win32icon:' + (Join-Path $root 'deps\app.ico')),
    ('/r:' + (Join-Path $deps 'Microsoft.Web.WebView2.Core.dll')),
    ('/r:' + (Join-Path $deps 'Microsoft.Web.WebView2.WinForms.dll')),
    '/r:System.dll',
    '/r:System.Core.dll',
    '/r:System.Drawing.dll',
    '/r:System.Net.Http.dll',
    '/r:System.Windows.Forms.dll',
    ('/out:' + (Join-Path $app $appName)),
    (Join-Path $root 'app\CalcHost.cs')
)
& $csc @appArgs
if ($LASTEXITCODE -ne 0) { throw 'csc failed for CalcHost' }

# Наполнить портативную папку
Copy-Item (Join-Path $deps '*.dll') $app -Force
if (Test-Path (Join-Path $root 'deps\app.ico')) { Copy-Item (Join-Path $root 'deps\app.ico') $app -Force }
Copy-Item (Join-Path $root 'www\index.html') (Join-Path $app 'www') -Force
Copy-Item (Join-Path $root 'www\styles.css') (Join-Path $app 'www') -Force
Copy-Item (Join-Path $root 'www\app.js') (Join-Path $app 'www') -Force
Copy-Item (Join-Path $root 'www\vendor\*.js') (Join-Path $app 'www\vendor') -Force
Copy-Item (Join-Path $root 'www\data\*.js') (Join-Path $app 'www\data') -Force
Write-Host 'Portable build done.'

Write-Host '== 2. Compile installer =='
$instArgs = @(
    '/nologo',
    '/codepage:65001',
    '/target:winexe',
    '/platform:anycpu',
    '/optimize+',
    ('/win32icon:' + (Join-Path $root 'deps\app.ico')),
    '/r:System.dll',
    '/r:System.Core.dll',
    '/r:System.Drawing.dll',
    '/r:System.Windows.Forms.dll',
    '/r:Microsoft.CSharp.dll',
    ('/res:' + (Join-Path $app $appName) + ',KarkasInst.CalcApp.exe'),
    ('/res:' + (Join-Path $root 'deps\app.ico') + ',KarkasInst.app.ico'),
    ('/res:' + (Join-Path $deps 'Microsoft.Web.WebView2.Core.dll') + ',KarkasInst.wv_Core_dll'),
    ('/res:' + (Join-Path $deps 'Microsoft.Web.WebView2.WinForms.dll') + ',KarkasInst.wv_WinForms_dll'),
    ('/res:' + (Join-Path $deps 'WebView2Loader.dll') + ',KarkasInst.wv_Loader_dll'),
    ('/res:' + (Join-Path $app 'www\index.html') + ',KarkasInst.www_index_html'),
    ('/res:' + (Join-Path $app 'www\styles.css') + ',KarkasInst.www_styles_css'),
    ('/res:' + (Join-Path $app 'www\app.js') + ',KarkasInst.www_app_js'),
    ('/res:' + (Join-Path $app 'www\vendor\xlsx.full.min.js') + ',KarkasInst.www_vendor_xlsx_js'),
    ('/res:' + (Join-Path $app 'www\data\default-dataset.js') + ',KarkasInst.www_data_dataset_js'),
    ('/out:' + (Join-Path $out 'SetupKarkasCalculator.exe')),
    (Join-Path $root 'installer\Installer.cs')
)
& $csc @instArgs
if ($LASTEXITCODE -ne 0) { throw 'csc failed for Installer' }

Write-Host '== Done =='
Get-ChildItem $out -Recurse -File | ForEach-Object { $_.FullName.Replace($out, '') + '  ' + $_.Length }
