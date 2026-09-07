# Veröffentlichung im Chrome Web Store – Schritt-für-Schritt

## Vorbereitung (lokal)

1. **Ordner aufräumen**: Im Ordner `scalable-sammeldownload` dürfen nur die Dateien liegen, die die Erweiterung braucht:
   `manifest.json`, `injector.js`, `content.js`, `background.js`, `popup.html`, `popup.js`, `icon128.png`
   → `README.md` und `DATENSCHUTZ.md` gehören **nicht** ins ZIP (nur als lokale Referenz / für den Store-Tab copy-pasten).
2. **ZIP erstellen**: Den Ordner-Inhalt (nicht den Ordner selbst!) als ZIP packen, z. B.:
   ```powershell
   Compress-Archive -Path scalable-sammeldownload\* -DestinationPath scalable-sammeldownload.zip
   ```

## Store-Konto anlegen (einmalig 5 USD)

3. https://chrome.google.com/webstore/devconsole öffnen, mit Google-Konto anmelden.
4. Einmalige Entwicklerregistrierung für **5 USD** bezahlen (Kreditkarte).

## Einreichung

5. **„Neues Element"** → ZIP hochladen.
6. Store-Eintrag ausfüllen:
   - **Name**: Scalable Sammeldownload – Wertpapierabrechnungen (inoffiziell)
   - **Kurzbeschreibung** (132 Zeichen): „Markiere Transaktionen in Scalable Capital und lade alle Wertpapierabrechnungen auf einmal als PDF. Inoffiziell, rein lokal."
   - **Ausführliche Beschreibung**: Funktion beschreiben + Haftungsausschluss (Text siehe unten).
   - **Kategorie**: Produktivität / Tools
   - **Sprache**: Deutsch
7. **Datenschutz-Tab** (kritisch!):
   - „Einzelnutzung" → ja
   - Frage nach Berechtigungs-Begründungen:
     - `downloads`: „Speichert die vom Nutzer ausgewählten PDF-Dokumente in den lokalen Download-Ordner."
     - `storage`: „Speichert lokal, ob der Nutzer den Haftungsausschluss bestätigt hat. Keine anderen Daten."
     - `scripting` + Host-Berechtigung `scalable.capital`: „Setzt Checkboxen in die Transaktionsliste der Scalable-Capital-Webseite und lädt die vom Nutzer ausgewählten Dokumente mit dessen bestehender Anmeldung herunter."
   - Frage „Daten weitergegeben?" → **Nein**
   - Frage „Daten für andere Zwecke verwendet?" → **Nein**
   - Bei den „gehörigen Berechtigungen": keine abgefragten sensiblen Berechtigungen vorhanden (keine tabs/cookies/identity).
8. **Vertrieb**: Alle Länder oder nach Wahl; Gebührenfrei (kostenlos).
9. **Zertifizierung / Einreichung**: Datenschutzrichtlinien-URL wird verlangt – hier有两种 Optionen:
   - a) GitHub Gist / GitHub Pages mit dem Inhalt von `DATENSCHUTZ.md` (empfohlen, kostenlose URL)
   - b) Falls nicht vorhanden: im Formular angeben, dass keine Daten gesammelt werden – Feld ist trotzdem Pflicht, also brauchst du eine öffentliche URL. Gist ist am schnellsten.

## Haftungsausschluss für die Store-Beschreibung

> **Haftungsausschluss / Disclaimer:** Diese Erweiterung ist ein privates, nicht-kommerzielles Projekt. Sie steht in keiner Verbindung zu, wird nicht unterstützt von und ist nicht mit der Scalable Capital Bank GmbH affiliert. „Scalable Capital" ist eine Marke der Scalable Capital Bank GmbH; die Marke wird hier ausschließlich zur funktionalen Beschreibung verwendet. Die Erweiterung nutzt nicht dokumentierte Schnittstellen der Scalable-Capital-Webseite; diese können sich jederzeit ändern. Die Nutzung erfolgt auf eigene Verantwortung und kann gegen die Nutzungsbedingungen des Brokers verstoßen. Es werden keine Daten an Dritte übertragen – alle Vorgänge laufen lokal im Browser. Für Schäden oder Kontosperrungen wird keine Haftung übernommen.

## Nach der Einreichung

10. Review durch Google: bei neuer Erweiterung meist 1–7 Tage. Bei Rückfragen/Fehlern meldet sich Google per E-Mail.
11. Nach Genehmigung: Link zum Store, Nutzer können installieren.

## Wichtige Hinweise / Restrisiken

- **Trademark-Risiko**: Der Name enthält „Scalable". Google kann Veröffentlichungen mit Fremdmarken im Titel ablehnen. Falls abgelehnt: Namen ändern auf z. B. „Broker Sammeldownload für Scalable-Seite" (immer noch beschreibend, aber geringeres Risiko). In der Beschreibung ist die Nennung als „kompatibel mit" üblich und meist unproblematisch, solange klar als inoffiziell gekennzeichnet.
- **AGB-Risiko**: Scalable könnte automatisierte Nutzung als Verstoß werten; im Disclaimer klar benannt.
- **Keine Garantie**: Diese Checkliste minimiert die Risiken, beseitigt sie aber nicht. Für eine juristisch belastbare Prüfung wäre ein Anwalt zuständig – bei einem kostenlosen Hobby-Projekt ist der Aufwand aber meist nicht gerechtfertigt.
