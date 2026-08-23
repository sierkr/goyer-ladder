# Dark-mode analyse — Goyer Golf MP Ladder

Datum: 18 april 2026
Versie app ten tijde van analyse: v3.0.0-11.14

Deze analyse onderzoekt hoe dark mode momenteel is geïmplementeerd in de app en waar
nog zwakheden zitten. Geen code is aangepast — dit is puur een inventarisatie.

---

## Hoe de dark mode nu is geïmplementeerd

De dark-mode is puur op CSS gebaseerd via `@media (prefers-color-scheme: dark)` in
`index.html`. Het blok herschrijft 7 CSS-variabelen (cream, dark, mid, light, white,
card-bg, border, input-bg, nav-bg, shadow, green-pale) en schakelt 9 specifieke
selectors om:

- `header`
- `.card`
- `input, select`
- `.modal`
- `nav`
- `.login-box`
- `#laad-overlay`
- `#login-scherm`

Alle andere elementen vertrouwen erop dat hun styling de CSS-variabelen gebruikt.

---

## Zwakheden en verbeterpunten

### 1. Dark mode is half-af en reactief gebouwd

Veel elementen hebben **hardcoded kleuren** in plaats van variabelen, waardoor ze
niet meedoen met dark mode:

- `index.html`: 5× `background: white` / `#fff`
- `index.html`: 10× `color: #fff` / `white`
- `js/toernooi.js`: 2× `background: white`, 6× `color: #fff`
- `js/auth.js`: 1× `background: white` (credentials-modal)
- Ongetelde hardcoded lichtgrijze achtergronden: `#fafaf7`, `#f0ede4`, `#f9f7f2`,
  `#f5f2ea`, `#f0f7f4`, `#fdecea`, etc.

Elke hardcoded lichte achtergrond blijft licht in dark mode. Als de tekst erop
`color: inherit` is (of via Safari's dark-mode-intervention een lichte kleur
krijgt), wordt het onleesbaar — wit op wit.

### 2. De v11.14-fix was puntsgewijs, niet systemisch

De speler-zoek-dropdown is gefixt (3 plekken: index.html CSS + twee in
toernooi.js). Maar er zijn andere plekken met hetzelfde probleem die nog op
testen wachten:

- **Google login knop** (`index.html` regel 630): `background:white;color:#444` —
  wit blijft wit in dark mode; contrasteert lelijk.
- **Credentials modal** (`js/auth.js` regel 765): `background:white` — witte
  kaart in dark mode, onvoorspelbare tekstkleur.
- **Flight-indeling select** (`js/toernooi.js` regel 388): `background:white`.
- **Info-boxes** met `background:#f9f7f2` en dergelijke — blijven crème in dark
  mode, donkere tekst erop wordt in Safari lichter geschilderd → onleesbaar.
- **Color-coded badges** (`.res-L`, `.res-T`, etc.) met hardcoded achtergrond +
  tekstkleur: beide hardcoded, dus ok in dark — maar lelijk, past niet bij
  rest van palette.

### 3. Ontbrekende `color-scheme` meta-declaration

Er is geen `<meta name="color-scheme">` of CSS `color-scheme: light dark`.
Daardoor weet de browser niet expliciet dat dark mode wordt ondersteund. iOS
Safari beslist dan zelf hoe hij form-velden, dropdowns en defaults interpreteert
— wat onvoorspelbaar gedrag bevordert.

### 4. Dark-palette is te smal

De 7 herdefinieerde variabelen zijn een minimum. Wat ontbreekt:

- Geen aparte kleur voor alert/error-achtergrond (`#fde8e8` is hardcoded,
  waarschijnlijk lelijk in dark).
- Geen variabele voor info/highlight-achtergrond (de info-boxes).
- Geen dark-specifieke schaduw (nu rgba(0,0,0,0.x) — minder zichtbaar in dark).
- `--green-pale` wordt wel herdefinieerd naar donker-groen, maar dat creëert
  inconsistentie: hover-states die `background: var(--green-pale)` gebruiken
  kunnen raar uitzien op een hardcoded witte achtergrond.

### 5. Inline-styles ondermijnen toekomstige overrides

Veel `style="..."` attributen in JS-generated HTML (`toernooi.js`, `auth.js`,
`admin.js`) bevatten kleuren direct. Inline-styles hebben hogere CSS-specifieke
dan classes, dus een toekomstige dark-mode-override via een class-selector kan
hier niet overheen. Eerst moeten die inline-styles opgeschoond worden.

### 6. Geen user-toggle voor dark mode

Dark mode activeert puur op `prefers-color-scheme: dark` van het OS. Gebruikers
kunnen niet handmatig kiezen. Voor een app met kleine lettertjes (ladder-rijen,
scorecards) is een manual toggle vaak gewenst.

---

## Verbeterlijnen (van belangrijk naar minder)

### 1. Hardcoded kleuren vervangen door variabelen

**Grootste winst, medium werk (2-3 uur).**

- Systematisch `background: white` → `background: var(--card-bg)` in HTML én JS
- `color: #444` / `#721c24` enz. → semantische variabelen introduceren
  (`--text-on-light`, `--text-on-alert`, ...)
- Inline-styles in JS waar nodig uitpakken naar CSS-classes
- Ongeveer 40-60 plekken doorlopen

### 2. `color-scheme` metadata toevoegen

**Klein werk (5 min), helpt veel.**

- `<meta name="color-scheme" content="light dark">` in `<head>`
- CSS `html { color-scheme: light dark; }`
- Signaleert aan Safari dat dark-ondersteuning bestaat → minder heavy-handed
  "help" van iOS

### 3. Dark palette uitbreiden

**Klein werk (15 min), goede winst.**

- Extra variabelen: `--alert-bg`, `--info-bg`, `--warning-bg`,
  `--soft-highlight`, `--text-on-colored`
- Ook in dark-mode-blok overschrijven
- Zorgt dat info-boxes en alerts ook in dark werken

### 4. Dark-mode toggle voor gebruiker

**Medium werk (1 uur), quality-of-life feature.**

- Knop in profiel / settings
- Schakelt `.dark` class op `<html>`
- CSS-overrides via `.dark`-selector in plaats van alleen `@media`
- `localStorage` voor voorkeur bewaren
- Drie opties: Auto (volg OS), Licht, Donker

### 5. Systematische audit + visuele test

**Groot werk (3-4 uur), meest betrouwbaar resultaat.**

- Checklist maken: elke tab en elk modaal scherm openen in dark mode
- Per bevinding: noteren en fixen
- Alleen zinvol als dark mode een first-class feature moet worden

---

## Aanbeveling

Dark mode **goed** ondersteunen is een aparte refactor van 2-4 sessies, niet
iets om tussendoor te doen. Drie opties:

### Optie A: Fix dark mode grondig
Pak een dedicated sessie(s) voor dark-mode audit + refactor. Start met punt 1 en
2, dan punt 3. Punt 4 en 5 zijn optioneel.

### Optie B: Zet dark mode uit
Verwijder het `@media (prefers-color-scheme: dark)` blok. Puur light-mode, geen
verwarrende gedeeltelijke ondersteuning. Wat nu bestaat is "deels dark mode" —
en dat is vaak slechter dan "geen dark mode", omdat de 30-40% iOS-gebruikers
met dark mode aan tegen willekeurige onleesbare plekken aanlopen.

### Optie C: Pragmatische middenweg
Behoud dark mode voor de paar plekken die er goed uitzien (hoofdtabs,
ladder-weergave). Zet een "dit werkt nog niet overal lekker"-melding in de
Help-file. Los op wat echt stuk is, laat de rest met rust.

---

## Nuttige inventaris voor latere actie

### Bestanden met hardcoded light kleuren

| Bestand | Aantal `background: white/#fff` | Aantal `color: #fff/white` |
|---------|----------------------------------|-----------------------------|
| `index.html` | 5 | 10 |
| `js/auth.js` | 1 | 1 |
| `js/archief.js` | 0 | 2 |
| `js/toernooi.js` | 2 | 6 |
| `js/uitslagen.js` | 0 | 4 |

### Specifieke lokaties (top prioriteit voor fix)

| Bestand | Regel | Context | Severity |
|---------|-------|---------|----------|
| `index.html` | 630 | Google login button | Laag (knop meestal verborgen) |
| `index.html` | 668, 1324 | Toernooi-speler-zoek dropdown (2e en 3e exemplaar) | Medium |
| `js/auth.js` | 765 | Credentials-modal na speler-aanmaak | Hoog (wordt vaak gezien) |
| `js/toernooi.js` | 388 | Flight-select in toernooi-indeling | Laag |
| `index.html` | 591, 610, 886, 1470 | Info-boxes met `#f0f7f4` / `#f9f7f2` | Medium |
| `index.html` | 555 | Delete-button background `#fde8e8` | Laag |

### Palette-variabelen die overschreven worden in dark mode

```
--cream:      #f8f4e9 → #0f1a14
--dark:       #1a1a1a → #f0f0f0
--mid:        #4a4a4a → #b0b0b0
--light:      #9a9a9a → #666666
--white:      #ffffff → #1e2d24
--card-bg:    #ffffff → #1a2820
--border:     #f0ede4 → #2a3d30
--input-bg:   #ffffff → #1a2820
--nav-bg:     #ffffff → #152010
--shadow:     rgba(0,0,0,0.10) → rgba(0,0,0,0.4)
--green-pale: #d8f3dc → #1a3d2a
```

### Palette-variabelen die NIET overschreven worden (blijven gelijk in dark)

```
--green, --green-light, --gold, --gold-light, --red, --blue
```

Dat is OK (branding-kleuren blijven consistent), maar let op dat tekst op deze
achtergronden (bv. `var(--green)` button met wit text) in beide modes leesbaar
moet blijven.
