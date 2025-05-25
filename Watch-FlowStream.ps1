# Watch-FlowStream.ps1
# ───────────────────
param(
    [string]$Url = 'http://localhost:3000/api/flowStream'
)

Add-Type -AssemblyName System.Net.Http

$http   = [System.Net.Http.HttpClient]::new()
$reqOpt = [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead

try {
    $resp   = $http.GetAsync($Url, $reqOpt).Result
    if (-not $resp.IsSuccessStatusCode) {
        throw "Server returned $($resp.StatusCode) $($resp.ReasonPhrase)"
    }

    $stream = $resp.Content.ReadAsStreamAsync().Result
    
    # -------- insert the two new lines right here --------
    $enc    = [Text.Encoding]::UTF8          # force UTF-8, avoids odd glyphs
    $reader = [System.IO.StreamReader]::new($stream, $enc)
    # ----------------------------------------------------

    Write-Host "⇣  Streaming from $Url  (Ctrl-C to stop)`n"

    while (-not $reader.EndOfStream) {
        $line = $reader.ReadLine()
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        Write-Host $line
    }
}
finally {
    $reader?.Dispose()
    $stream?.Dispose()
    $resp?.Dispose()
    $http?.Dispose()
}
