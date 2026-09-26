// ============================================================
//  Linter — laag 1b: namen die niet bestaan
// ============================================================
//  WAAROM DIT BESTAAT
//
//  Op 25 september 2026 werd bij het weghalen van een groen vinkje op de
//  scorekaart één regel verwijderd (`const merk = …`) terwijl het gebruik
//  ervan (`${merk}`) bleef staan. Gevolg: de hele toernooi-scorekaart werd niet
//  meer getekend. Alle 625 rekentests bleven groen — die raken de opmaak niet.
//  Alleen een browserproef ving het, en die duurt tien minuten en heeft een
//  emulator nodig.
//
//  `no-undef` vindt precies die fout, in een seconde, zonder browser. Dat is de
//  enige reden dat deze laag bestaat. De regels hieronder zijn daarom beperkt
//  tot dingen die ECHT fout zijn; smaakregels staan er bewust niet bij, want een
//  laag die ruis geeft wordt genegeerd en dan is hij waardeloos.
//
//  Wat hier NIET in staat, met opzet: `no-unused-vars`. Er staan ~350
//  ongebruikte invoerregels in de app (gemeten 16 september 2026, afgesproken
//  met Sierk: opruimen wanneer we tóch in dat bestand werken). Als fout zou dat
//  elke uitrol blokkeren; als waarschuwing zou het de echte fouten verbergen.
// ============================================================
import globals from 'globals';

export default [
  {
    files: ['js/**/*.js', 'sw.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      // De volledige lijst browsernamen uit het `globals`-pakket. Met een eigen
      // lijst mist er altijd iets (URLSearchParams, createImageBitmap, File) en
      // dan blokkeert deze laag een uitrol op een vals alarm.
      globals: { ...globals.browser, ...globals.serviceworker },
    },
    rules: {
      'no-undef': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-dupe-class-members': 'error',
      'no-redeclare': 'error',
      'no-const-assign': 'error',
      'no-unreachable': 'error',
      'no-self-assign': 'error',
      'no-self-compare': 'error',
      'no-sparse-arrays': 'error',
      'no-fallthrough': 'error',
      'no-cond-assign': 'error',
      'no-async-promise-executor': 'error',
      'no-unsafe-negation': 'error',
      'no-unsafe-finally': 'error',
      'use-isnan': 'error',
      'valid-typeof': 'error',
    },
  },
  {
    // ⚠ v5.44.0 — DE TESTS ZELF OOK. Bij het weghalen van de oude gastlogin bleef
    // in gastlogin.test.cjs een hulpfunctie in gebruik waarvan de definitie net
    // was verdwenen. Dezelfde fout als die van v5.43.0, nu in de tests: de suite
    // viel om met "komtUit is not defined" in plaats van te melden wat er mis
    // was. Deze laag ziet dat meteen.
    files: ['tests/**/*.cjs', 'tests/**/*.js'],
    ignores: ['tests/node_modules/**'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      'no-undef': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-redeclare': 'error',
      'no-const-assign': 'error',
      'no-unreachable': 'error',
      // ⚠ `no-self-compare` staat hier NIET bij, anders dan bij de app. Een test
      // vergelijkt met opzet twee aanroepen van dezelfde functie met dezelfde
      // invoer — `hashPin('123456') === hashPin('123456')` toetst dat de hash
      // stabiel is. Dat leest voor de linter als een zinloze vergelijking. Een
      // laag die ruis geeft wordt genegeerd, dus liever één regel minder.
      'use-isnan': 'error',
      'valid-typeof': 'error',
    },
  },
];
