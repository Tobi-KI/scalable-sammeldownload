# Scalable Sammeldownload (inoffiziell)

Chrome-Erweiterung: Markiere Transaktionen in Scalable Capital und lade
**Wertpapierabrechnungen und Dividendenbelege** auf einmal als PDF herunter –
optional pro Zeitraum, auch für alte Dokumente.

![Version](https://img.shields.io/badge/version-1.2.1-blue) ![Lizenz](https://img.shields.io/badge/Lizenz-MIT-green) ![inoffiziell](https://img.shields.io/badge/Status-inoffiziell-orange)

## Features

- Checkboxen erscheinen automatisch an jeder Zeile der Transaktionsliste
- Panel blendet ein, sobald du mindestens eine Zeile anhakst
- Belege wählbar: **Wertpapierabrechnungen** und/oder **Dividendenbelege**
- Optionaler **Zeitraum** (Von/Bis) – lädt alle passenden Belege im Zeitraum nach, auch alte
- Dateinamen nach Schema `Wertpapiername_ISIN_Abrechnung[_Sparplan]_Datum.pdf` bzw. `…_Dividende_Datum.pdf`
- Download über die normale Scalable-Web-Session (Cookies bleiben im Browser)
- Läuft komplett lokal – keine Server, kein Tracking, keine Datenübertragung

## Installation

### Aus dem Chrome Web Store

*(Link folgt nach Veröffentlichung)*

### Manuell (Entwicklermodus)

1. Dieses Repository herunterladen (Code → Download ZIP) und entpacken
2. Chrome öffnen → `chrome://extensions`
3. Entwicklermodus (rechts oben) aktivieren
4. „Entpackte Erweiterung laden“ → entpackten Ordner auswählen

## Nutzung

1. Auf scalable.capital einloggen → **Transaktionen**
2. Checkboxen an den Zeilen erscheinen automatisch
3. Gewünschte Transaktionen anhaken → unten rechts öffnet sich das Panel
4. Belege + ggf. Zeitraum wählen → „PDFs herunterladen“ → PDFs landen in `Downloads/scalable-dokumente/`

## Haftungsausschluss

> Diese Erweiterung ist ein privates, nicht-kommerzielles Projekt. Sie steht in
> keiner Verbindung zu und wird nicht unterstützt von der Scalable Capital Bank
> GmbH. „Scalable Capital“ ist eine Marke der Scalable Capital Bank GmbH; die
> Marke wird hier ausschließlich zur funktionalen Beschreibung verwendet. Die
> Erweiterung nutzt nicht dokumentierte Schnittstellen der
> Scalable-Capital-Webseite; diese können sich jederzeit ändern. Die Nutzung
> erfolgt auf eigene Verantwortung und kann gegen die Nutzungsbedingungen des
> Brokers verstoßen. Für Schäden oder Kontosperrungen wird keine Haftung
> übernommen.

## Datenschutz

Es werden **keine personenbezogenen Daten gesammelt, gespeichert oder
übertragen**. Details: [DATENSCHUTZ.md](DATENSCHUTZ.md).

## Lizenz

[MIT](LICENSE)
