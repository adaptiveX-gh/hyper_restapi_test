<#
  test-obImbalance.ps1
  --------------------
  • POST /api/obImbalanceSnapshot   – one-off book-imbalance
  • POST /api/obImbalanceStream     – live stream
#>

$BaseUrl = 'http://localhost:3000'   # ⇐ change if server on another host/port

#───────────────────────────────────────────────────────────
function Invoke-ObImbalanceSnapshot {
    param(
        [string]$Coin        = 'WLD-PERP',
        [int]   $DepthLevels = 20
    )

    $body = @{ coin = $Coin; depthLevels = $DepthLevels } | ConvertTo-Json
    Write-Host "`n=== /api/obImbalanceSnapshot ==="

    try {
        Invoke-RestMethod -Uri "$BaseUrl/api/obImbalanceStream" `
                          -Method POST -ContentType 'application/json' `
                          -Body   $body |
        Format-List
    }
    catch { Write-Warning $_.Exception.Message }
}

#───────────────────────────────────────────────────────────
function Invoke-ObImbalanceStream {
    param(
        [string]$Coin        = 'WLD-PERP',
        [int]   $DepthLevels = 20,
        [int]   $PeriodSec   = 2,
        [int]   $DurationSec = 20
    )

    $body = @{
        coin        = $Coin
        depthLevels = $DepthLevels
        periodSec   = $PeriodSec
        durationSec = $DurationSec
    } | ConvertTo-Json

    Write-Host "`n=== /api/obImbalanceStream ($DurationSec s) ===`n"

    Add-Type -AssemblyName System.Net.Http

    $httpClient     = [System.Net.Http.HttpClient]::new()
    $reqMethod      = [System.Net.Http.HttpMethod]::Post
    $req            = [System.Net.Http.HttpRequestMessage]::new($reqMethod,
                          "$BaseUrl/api/obImbalanceStream")
    $req.Content    = [System.Net.Http.StringContent]::new(
                          $body, [Text.Encoding]::UTF8, 'application/json')

    $resp = $httpClient.SendAsync(
                $req,
                [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead
            ).Result

    if (-not $resp.IsSuccessStatusCode) {
        throw "server returned $($resp.StatusCode) $($resp.ReasonPhrase)"
    }

    $stream = $resp.Content.ReadAsStreamAsync().Result
    $reader = [System.IO.StreamReader]::new($stream)

    try {
        while (-not $reader.EndOfStream) {
            $line = $reader.ReadLine()
            if ([string]::IsNullOrWhiteSpace($line)) { continue }

            $obj  = $line | ConvertFrom-Json
            $flag = if ($obj.trigger) { '-->TRIGGER' } else { '' }

            '{0:HH:mm:ss}  ratio={1,-6}  bid={2,-10}  ask={3,-10}  {4}' -f `
                (Get-Date), $obj.ratio, $obj.bidDepth, $obj.askDepth, $flag |
            Write-Host
        }
    }
    finally {
        $reader.Dispose();  $stream.Dispose()
        $resp.Dispose();    $httpClient.Dispose()
    }
}

#───────────────── run both probes ─────────────────────────
Invoke-ObImbalanceSnapshot  -Coin 'BTC-PERP' -DepthLevels 20
Invoke-ObImbalanceStream    -Coin 'BTC-PERP' -DepthLevels 20 -PeriodSec 2 -DurationSec 30
