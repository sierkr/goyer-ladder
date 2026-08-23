# ============================================================
#  Nieuwe Anthropic API-sleutel plaatsen — goyer-ladder
#  Firebase-project: goyer-golf-mp-ladder
#
#  DOE DIT EERST, IN DE BROWSER (platform.claude.com):
#    1. API keys  -> beide 'goyer-ladder' sleutels REVOKE
#    2. Settings -> Limits -> maandlimiet op US$ 5
#    3. Betaal het openstaande bedrag van US$ 9,42
#       (zonder dit blijft de API geblokkeerd)
#    4. API keys -> Create Key -> naam: goyer-ladder-2
#       KOPIEER de sleutel meteen. Hij wordt maar een keer getoond.
#
#  DAARNA: rechtermuisknop op dit bestand -> "Run with PowerShell"
#  of plak de regels hieronder een voor een in PowerShell.
# ============================================================

$ErrorActionPreference = 'Stop'

# De map waaruit jij je functions deployt (volgens je eigen
# 'werkende deploy methode goyer-ladder.txt'). Klopt dit niet,
# verander 'test' hieronder in 'Live'.
$map = 'C:\Users\sierk\OneDrive\Apps\goyer-ladder\test'

Write-Host ""
Write-Host "=== Nieuwe API-sleutel plaatsen ===" -ForegroundColor Cyan
Write-Host "Map: $map"
Write-Host ""

if (-not (Test-Path $map)) {
    Write-Host "FOUT: map niet gevonden: $map" -ForegroundColor Red
    Read-Host "Enter om te sluiten"
    exit 1
}

# --- Stap 1: dependencies -----------------------------------
Write-Host "[1/4] Dependencies installeren..." -ForegroundColor Yellow
Set-Location "$map\functions"
npm install

# --- Stap 2: de sleutel opslaan als Firebase-secret ----------
# Hierna vraagt Firebase: "Enter a value for ANTHROPIC_API_KEY"
# Plak daar je nieuwe sleutel en druk op Enter.
# LET OP: je ziet niets terwijl je plakt. Dat hoort zo.
Write-Host ""
Write-Host "[2/4] Sleutel opslaan." -ForegroundColor Yellow
Write-Host "      Plak zo je nieuwe sleutel en druk Enter." -ForegroundColor Yellow
Write-Host "      Je ziet niets tijdens het plakken - dat hoort zo." -ForegroundColor DarkGray
Set-Location $map
firebase functions:secrets:set ANTHROPIC_API_KEY

# --- Stap 3: alleen de scanfunctie opnieuw uitrollen ---------
# Bewust alleen scanScorekaart, zodat de rest van je functies
# onaangeroerd blijft.
Write-Host ""
Write-Host "[3/4] Functie uitrollen (scanScorekaart)..." -ForegroundColor Yellow
$env:FUNCTIONS_DISCOVERY_TIMEOUT = 120
firebase deploy --only functions:scanScorekaart

# --- Stap 4: controle ---------------------------------------
# 'get' toont de versie en de status, NIET de sleutel zelf.
# (Gebruik nooit 'secrets:access' - dat drukt je sleutel leesbaar af.)
Write-Host ""
Write-Host "[4/4] Controle - status van de secret:" -ForegroundColor Yellow
firebase functions:secrets:get ANTHROPIC_API_KEY

Write-Host ""
Write-Host "KLAAR." -ForegroundColor Green
Write-Host "Test nu in de app: nieuwe baan -> scorekaart-foto scannen."
Write-Host ""
Write-Host "LET OP: verwijder daarna 'goyer-ladder key.txt' uit je projectmap." -ForegroundColor Yellow
Write-Host ""
Read-Host "Enter om te sluiten"
