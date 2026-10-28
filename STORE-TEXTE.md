# Store-Beschreibung (zum Kopieren)

## Kurzbeschreibung (max. 132 Zeichen – bereits im Manifest)

Wertpapierabrechnungen & Dividendenbelege aus Scalable Capital als PDF sammeln – markieren oder Zeitraum wählen. Inoffiziell, lokal.

*(exakt 132 Zeichen, synchron mit manifest.json 1.4.0)*

## Ausführliche Beschreibung

Scalable Capital bietet keinen Sammel-Download für Dokumente – wer mehrere Sparpläne hat, muss zum Monatsanfang jede Transaktion einzeln öffnen und jede Abrechnung einzeln speichern. Ich habe diese Erweiterung entwickelt, weil ich meine Dokumente selbst regelmäßig in Portfolio Performance und FIRE Cockpit importiere: Bei einer Vielzahl an Buchungen ist das von Hand extrem aufwändig. Diese Erweiterung macht daraus einen Klick.

SO FUNKTIONIERT'S
1. Auf scalable.capital einloggen und zu „Transaktionen" gehen
2. Die gewünschten Transaktionen mit den Checkboxen markieren – oder einfach einen Zeitraum festlegen
3. Im Panel „PDFs herunterladen" klicken
4. Fertig: Alle Belege landen als PDF sortiert in deinem Download-Ordner (Ordner frei wählbar)

FEATURES
• Checkboxen direkt an jeder Zeile der Transaktionsliste
• Wertpapierabrechnungen UND Dividendenbelege – einzeln oder zusammen
• Eigener Zeitraum (Von/Bis): Lade auch hunderte alte Dokumente nachträglich herunter – ganz ohne Scrollen und Einzelklicks
• Automatische Sortierung in Unterordner: nach Belegart (Abrechnungen/ und Dividenden/) und optional nach Jahr
• Ablageort einstellbar: eigener Ordnername im Download-Verzeichnis
• Sprechende, automatisch umbenannte Dateien: Wertpapiername_ISIN_Abrechnung[_Sparplan]_Datum.pdf bzw. …_Dividende_Datum.pdf
• Sparplan-Ausführungen werden automatisch erkannt und im Dateinamen markiert
• Optional Datum vorne im Dateinamen – chronologisch sortiert im Explorer
• Bereits geladene Belege werden automatisch übersprungen – ideal für den monatlichen Import
• Schnellwahl für den Zeitraum: Letzter Monat, Dieses Jahr, Letztes Jahr
• Download über deine bestehende Browser-Anmeldung – nichts muss neu eingeloggt werden
• Prüfung, dass wirklich ein PDF heruntergeladen wurde – keine kaputten Dateien
• Dezentes Panel im Scalable-Design, nur auf der Transaktions-Seite aktiv

PRIVATSPHÄRE
• Läuft zu 100 % lokal in deinem Browser
• Kein Server, kein Tracking, keine Analyse, keine Werbung
• Deine Zugangsdaten werden nie gelesen oder gespeichert
• Es werden keinerlei Daten an den Herausgeber oder Dritte übertragen
• Quellcode öffentlich auf GitHub: https://github.com/Tobi-KI/scalable-sammeldownload

VORAUSSETZUNGEN
• Google Chrome
• Ein Depot bei Scalable Capital

---

HAFTUNGSAUSSCHLUSS / DISCLAIMER
Diese Erweiterung ist ein privates, nicht-kommerzielles Projekt. Sie steht in keiner Verbindung zu, wird nicht unterstützt von und ist nicht mit der Scalable Capital Bank GmbH affiliiert. „Scalable Capital" ist eine Marke der Scalable Capital Bank GmbH; die Marke wird hier ausschließlich zur funktionalen Beschreibung der Kompatibilität verwendet. Die Erweiterung nutzt nicht dokumentierte Schnittstellen der Scalable-Capital-Webseite; diese können sich jederzeit ohne Vorankündigung ändern. Die Nutzung erfolgt auf eigene Verantwortung und kann gegen die Nutzungsbedingungen des Brokers verstoßen. Für Schäden oder Kontosperrungen wird keine Haftung übernommen.

## Was ist neu in Version 1.4.0 (für das Store-Änderungsprotokoll)

• Neue Einstellungen im Popup: Ordnername im Download-Verzeichnis, Unterordner nach Belegart und/oder Jahr, Datum vorne im Dateinamen
• Bereits geladene Belege werden übersprungen – keine Duplikate mehr beim monatlichen Laden
• Zeitraum-Schnellwahl: Letzter Monat, Dieses Jahr, Letztes Jahr
• „Ordner öffnen“: zeigt die gespeicherten PDFs direkt im Explorer
• Laufende Downloads lassen sich abbrechen; „Auswahl aufheben“ entfernt alle Haken
• Nach dem Download werden erledigte Zeilen automatisch abgehakt
• Hinweis, falls Scalable die Seite geändert hat und keine Zeilen mehr erkannt werden
• Zuverlässigere Zuordnung: Mehrere Sparpläne mit gleichem Datum und Betrag werden jetzt korrekt einzeln geladen
• Auch sehr alte markierte Zeilen werden gefunden
• Hinweis, wenn ein Zeitraum zu viele Transaktionen enthält; automatische Wiederholung bei Server-Überlast
• Schlanker: nicht benötigte Berechtigung „scripting“ und Hintergrund-Skript im Seitenkontext entfernt

## Was ist neu in Version 1.3.0

• Dividendenbelege (Ausschüttungen) können jetzt ebenfalls heruntergeladen werden
• Neuer Zeitraum-Filter: Hunderte Dokumente eines Zeitraums auf einmal herunterladen – auch rückwirkend für alte Buchungen
• Dokumente werden automatisch in Unterordner sortiert (Abrechnungen / Dividenden) und konsistent umbenannt
• Neues Panel im Scalable-Design, dauerhaft auf der Transaktions-Seite verfügbar
• Deutlich schneller: Dokumente werden direkt über die Web-App-Schnittstelle geladen, ohne jede Zeile einzeln anzuklicken

## Kategorie

Produktivität (Alternativ: „Tools" falls verfügbar)

## Berechtigungs-Begründungen (wird Google im Datenschutz-Tab abfragen)

- downloads: „Speichert die vom Nutzer ausgewählten PDF-Dokumente in den lokalen Download-Ordner."
- storage: „Speichert lokal auf dem Gerät, ob der Nutzer den Haftungsausschluss bestätigt hat, seine Einstellungen (Ablageort, Dateiname) sowie die IDs bereits geladener Dokumente, um Duplikate zu vermeiden. Keine anderen Daten."
- Host-Berechtigung scalable.capital: „Zeigt Checkboxen über der Transaktionsliste der Scalable-Capital-Webseite und lädt die vom Nutzer ausgewählten Dokumente mit dessen bestehender Browser-Anmeldung herunter."

## Sonstige Angaben im Datenschutz-Tab

- Einzelnutzung: Ja
- Daten weitergegeben: Nein
- Daten für andere Zwecke: Nein
- Datenschutzrichtlinien-URL: https://github.com/Tobi-KI/scalable-sammeldownload/blob/main/DATENSCHUTZ.md
