<#
  Construye el APK de Mi TV para Android / Android TV sin Gradle, con las herramientas del SDK.

    powershell -ExecutionPolicy Bypass -File tools\construir_apk.ps1

  Toma la app de app\ (la misma del TV LG y la web), la mete en un WebView (android\) y deja
  dist\mitv-<versión>.apk firmado. La primera vez crea la llave de firma en android\firma\:
  GUÁRDALA. Sin ella no podrás actualizar la app ya instalada (Android exige la misma firma).
#>
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Sdk  = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { 'C:\Android\Sdk' }
$Jdk  = if (Test-Path 'C:\android-tools\jdk\jdk-17.0.20+8') { 'C:\android-tools\jdk\jdk-17.0.20+8' } else { $env:JAVA_HOME }
$Bt   = Join-Path $Sdk 'build-tools\36.0.0'
$Jar  = Join-Path $Sdk 'platforms\android-35\android.jar'
$env:JAVA_HOME = $Jdk
$Out  = Join-Path $Root 'android\build'
$info = Get-Content (Join-Path $Root 'app\appinfo.json') -Raw | ConvertFrom-Json
$ver  = $info.version
$p    = $ver.Split('.'); $code = [int]$p[0] * 10000 + [int]$p[1] * 100 + [int]$p[2]

function Run($exe, [string[]]$a) { & $exe @a; if ($LASTEXITCODE -ne 0) { throw "Falló: $exe $($a -join ' ')" } }

Write-Host "Mi TV $ver (código $code)"
if (Test-Path $Out) { Remove-Item $Out -Recurse -Force }
New-Item -ItemType Directory -Force "$Out\assets\www", "$Out\gen", "$Out\classes", "$Out\dex" | Out-Null
Copy-Item (Join-Path $Root 'app\*') "$Out\assets\www" -Recurse

# 1) Recursos y manifiesto
Run "$Bt\aapt2.exe" @('compile', '--dir', (Join-Path $Root 'android\res'), '-o', "$Out\res.zip")
Run "$Bt\aapt2.exe" @('link', '-I', $Jar, '--manifest', (Join-Path $Root 'android\AndroidManifest.xml'),
  '--java', "$Out\gen", '--min-sdk-version', '21', '--target-sdk-version', '35',
  '--version-code', "$code", '--version-name', $ver, '-o', "$Out\base.apk", "$Out\res.zip")

# 2) Código Java -> DEX
$src = @(Get-ChildItem (Join-Path $Root 'android\src') -Recurse -Filter *.java | ForEach-Object FullName) + @(Get-ChildItem "$Out\gen" -Recurse -Filter *.java | ForEach-Object FullName)
Run "$Jdk\bin\javac.exe" (@('-nowarn', '-source', '1.8', '-target', '1.8', '-bootclasspath', $Jar, '-classpath', $Jar, '-d', "$Out\classes") + $src)
$classes = Get-ChildItem "$Out\classes" -Recurse -Filter *.class | ForEach-Object FullName
Run "$Bt\d8.bat" (@('--release', '--lib', $Jar, '--min-api', '21', '--output', "$Out\dex") + $classes)

# 3) Añadir classes.dex y la app web (assets/www) al APK, con rutas "/" que es lo que espera Android
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open("$Out\base.apk", 'Update')
[System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, "$Out\dex\classes.dex", 'classes.dex') | Out-Null
$base = (Resolve-Path "$Out\assets").Path
Get-ChildItem $base -Recurse -File | ForEach-Object {
  $rel = 'assets/' + $_.FullName.Substring($base.Length + 1).Replace('\', '/')
  [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $rel) | Out-Null
}
$zip.Dispose()

# 4) Alinear y firmar
Run "$Bt\zipalign.exe" @('-f', '-p', '4', "$Out\base.apk", "$Out\aligned.apk")
$KeyDir = Join-Path $Root 'android\firma'
$Ks = Join-Path $KeyDir 'mitv.jks'; $PassFile = Join-Path $KeyDir 'clave.txt'
if (-not (Test-Path $Ks)) {
  New-Item -ItemType Directory -Force $KeyDir | Out-Null
  $pass = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 24 | ForEach-Object { [char]$_ })
  Set-Content $PassFile $pass -NoNewline
  Run "$Jdk\bin\keytool.exe" @('-genkeypair', '-keystore', $Ks, '-alias', 'mitv', '-keyalg', 'RSA', '-keysize', '2048',
    '-validity', '10000', '-storepass', $pass, '-keypass', $pass, '-dname', 'CN=Mi TV, O=Mi TV, C=CL')
  Write-Host "Llave de firma creada en $KeyDir (haz una copia de seguridad)."
}
$pass = Get-Content $PassFile -Raw
New-Item -ItemType Directory -Force (Join-Path $Root 'dist') | Out-Null
$Apk = Join-Path $Root "dist\mitv-$ver.apk"
Run "$Bt\apksigner.bat" @('sign', '--ks', $Ks, '--ks-key-alias', 'mitv', '--ks-pass', "pass:$pass", '--key-pass', "pass:$pass", '--out', $Apk, "$Out\aligned.apk")
Run "$Bt\apksigner.bat" @('verify', $Apk)
Write-Host "APK listo: $Apk ($([math]::Round((Get-Item $Apk).Length / 1MB, 1)) MB)"
