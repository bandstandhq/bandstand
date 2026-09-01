# Security Review — August 2026

Vollständige Durchsicht des Codes vor einem Release, Schwerpunkt Sicherheit. Ursprünglich ein
reiner Prüfauftrag — der vollständige Bericht mit allen Ausnutzungswegen stand zunächst nur lokal,
nie committed, solange Befunde offen waren. Alle acht Befunde sind inzwischen behoben (siehe
Status pro Befund); dieses Dokument ist die nachträglich redigierte, dauerhafte Fassung: Ort,
Mechanismus und Behebung bleiben, die Schritt-für-Schritt-Ausnutzungswege sind entfernt oder
gekürzt, damit das Dokument im öffentlichen Repo als Nachweis dient, ohne selbst eine Anleitung zu
sein. Jeder Befund ab "mittel" hatte eine private Draft-Security-Advisory (GitHub Security-Tab,
nicht öffentlich, nicht veröffentlicht); alle sind nach Behebung geschlossen.

Methodik: Route für Route, Schema für Schema tatsächlich gelesen (nicht aus Erinnerung
rekonstruiert), inklusive `git log` über die volle Historie und `pnpm audit`. Eigene, in dieser
oder früheren Sessions gebaute Teile (Push, ICS-Feed, Calendar/Polls, Mobile-Pass) wurden mit
derselben Skepsis geprüft wie der Rest.

Schweregrade — bewusst streng ausgelegt:
- **kritisch**: sofort und ohne Vorbedingung ausnutzbar, kompromittiert die ganze Instanz.
- **hoch**: ein Angreifer kommt an fremde Daten (Lesezugriff über Mandantengrenzen, Account-Übernahme).
- **mittel**: Autorisierungs-/Integritätslücke ohne direkten Fremddatenzugriff, oder Datenzugriff nur
  unter zusätzlichen, aber realistischen Bedingungen.
- **niedrig**: Härtung, Performance-/DoS-Relevanz ohne direkte Ausnutzbarkeit durch Außenstehende.
- **kosmetisch**: Code-/Betriebsqualität ohne Sicherheitsauswirkung.

---

## Befunde

### 1. `BETTER_AUTH_SECRET` ist die einzige Kern-Geheimnis-Variable, die envGuard nicht erzwingt

**Schweregrad: hoch** — **Status: behoben in #119**

**Was**: `.env.example` liefert `BETTER_AUTH_SECRET=dev-only-secret-change-me` als Platzhalter —
öffentlich im Git-Repo sichtbar. `apps/server/src/lib/auth.ts` übernahm `process.env.BETTER_AUTH_SECRET`
ungeprüft. Für `MINIO_ACCESS_KEY`/`MINIO_SECRET_KEY` gab es exakt diesen Schutz bereits:
`apps/server/src/lib/storage.ts` ruft `assertNotDevPlaceholder(...)` auf, die den Prozess in
`NODE_ENV=production` hart beendet, falls der Platzhalter noch aktiv ist
(`apps/server/src/lib/envGuard.ts`). Für `BETTER_AUTH_SECRET` fehlte dieser Aufruf komplett.

**Wo**: `apps/server/src/lib/auth.ts`, `.env.example`, `apps/server/src/lib/envGuard.ts`.

**Mechanismus**: `BETTER_AUTH_SECRET` signiert Sessions und JWTs. Eine Instanz, die den
öffentlich bekannten Platzhalterwert nie ändert, signiert damit für jeden nachvollziehbar.

**Schaden**: Vollständiger Authentifizierungs-Bypass für jede Instanz, die diesen einen Wert nicht
geändert hat.

**Behebung**: `assertNotDevPlaceholder(...)` in `auth.ts` ergänzt, exakt nach dem MinIO-Muster.

---

### 2. Content-addressed File-Storage erlaubte bandübergreifenden Datenzugriff über `/confirm`

**Schweregrad: hoch** — **Status: behoben in #121**

**Was**: Objekte liegen global unter `blobs/<sha256>` (`apps/server/src/lib/storage.ts`) — der
Schlüssel enthält keine Band-ID. `POST /bands/:bandId/files/confirm` prüfte nur, dass ein Objekt an
diesem Schlüssel existierte und sein Inhalt zum behaupteten Hash passte, und trug es dann für die
aufrufende Band in die `attachments`-Tabelle ein. Es wurde **nicht** geprüft, ob für diesen
konkreten Aufruf überhaupt gerade ein echter, dieser Band zurechenbarer Upload stattgefunden hatte.

**Wo**: `apps/server/src/routes/files.ts`, `apps/server/src/lib/storage.ts` (globaler Namensraum
als Voraussetzung).

**Mechanismus**: Wer einen gültigen sha256-Wert kannte — realistisch etwa als Mitglied zweier
Bands auf derselben Selfhosting-Instanz — konnte Dateiinhalte einer fremden Band in die eigene
kopieren, ohne selbst je etwas hochzuladen.

**Schaden**: Übertragung von Datei-Inhalten (PDFs, Noten, ggf. sensibel) über Mandantengrenzen
hinweg, ohne dass die Quell-Band das bemerkt oder verhindern konnte.

**Behebung**: `/confirm` ist jetzt an einen tatsächlich stattgefundenen, dieser Anfrage
zurechenbaren Upload gebunden — eine kurzlebige `pending_uploads`-Zeile, angelegt von
`/presign-upload` mit dem Objektzustand vor dem Upload als Baseline, konsumiert und gelöscht von
`/confirm`, das eine seitdem tatsächlich erfolgte Neuschreibung verlangt.

---

### 3. Admin-only-Aktionen im Berechtigungs-Schema waren auf CRDT-Ebene nicht durchgesetzt

**Schweregrad: mittel** — **Status: behoben in #120**

**Was**: Die Berechtigungsmatrix (`packages/core/src/permissions/matrix.ts`) erklärt
`event:create`/`event:edit`, `anchor:edit` und `assignment:editOthers` zu `admin`-Aktionen. Für
Löschungen von `songs`/`voices`/`setlists` und für die Eigentümerschaft von
`availability`/`pollVotes` gab es einen echten serverseitigen Schutz
(`apps/server/src/lib/hocuspocus.ts`s `onChange`-Hook). Für Events/Anchors/Assignments existierte
**keine** entsprechende Prüfung — weder als REST-Route noch als CRDT-Guard.

**Wo**: `apps/server/src/lib/hocuspocus.ts`, `apps/server/src/routes/events.ts` (nur DELETE
existiert), `packages/core/src/yjs/assignments.ts`.

**Mechanismus**: `onAuthenticate` prüfte nur Bandmitgliedschaft, nicht die Rolle — jedes
Bandmitglied konnte über eine direkte WebSocket-Verbindung admin-only-Aktionen ausführen, die die
Web-UI nur aus Bequemlichkeit ausblendet.

**Schaden**: Kein Zugriff auf fremde Daten (jedes Bandmitglied sieht ohnehin alle Band-Inhalte),
aber eine dokumentierte Rollen-Grenze war serverseitig wirkungslos — Integrität, nicht
Vertraulichkeit.

**Behebung**: Drei neue Guard-Prädikate im bestehenden `onChange`-Hook (reiner Rollen-Guard für
`events`/`polls`, derselbe für das bandweite Anchor-Array pro Song, Self-oder-Admin-Guard für
Zuweisungen) — dokumentiert in ADR-0013, das eine falsche Aussage in ADR-0011 korrigiert.

---

### 4. `sha256`-Schema prüfte nur die Länge, nicht das Zeichenformat

**Schweregrad: mittel** — **Status: behoben in #119**

**Was**: `packages/core/src/files/schema.ts` definierte den Hash an drei Stellen als
`z.string().length(64)`, ohne Prüfung auf Hex-Zeichen. Dieser Wert wird direkt zum
Objektspeicher-Schlüssel `blobs/<sha256>`.

**Wo**: `packages/core/src/files/schema.ts`.

**Mechanismus**: Ein beliebiger 64 Zeichen langer String — nicht zwingend hexadezimal — konnte
über `/presign-upload` zu einer echten, gegen den Objektspeicher nutzbaren presignten PUT-URL
führen. Ob der eingesetzte Objektspeicher untypische Zeichen im Schlüssel sauber ablehnt, ist eine
Annahme über das Backend, keine Garantie des eigenen Codes.

**Schaden**: Im ungünstigsten Fall Path-Traversal-Schreibzugriff auf das Dateisystem des
Objektspeicher-Hosts, abhängig vom Backend-Verhalten.

**Behebung**: `.regex(/^[0-9a-f]{64}$/)` an allen drei Stellen statt `.length(64)`, zusammengezogen
in eine gemeinsame Konstante.

---

### 5. ICS-Feed: `escapeIcsText` entschärfte kein einzelnes `\r`

**Schweregrad: mittel** — **Status: behoben in #119**

**Was**: `packages/core/src/calendar/ics.ts` escaped Backslash, Semikolon, Komma und `\n`, aber
kein einzelnes `\r` (Carriage Return ohne folgendes `\n`). Termin-Titel/-Ort fließen unverändert
aus dem geteilten Yjs-Dokument in den Feed.

**Wo**: `packages/core/src/calendar/ics.ts`.

**Mechanismus**: Ein rohes `\r` im Titel (über direkten API-/CRDT-Zugriff, nicht über ein
Browser-Textfeld) terminierte die aktuelle ICS-Property vorzeitig — viele reale Kalender-Parser
akzeptieren ein alleinstehendes `\r` als Zeilenende, was zusätzliche, frei gewählte ICS-Zeilen im
Feed jedes Abonnenten ermöglichte.

**Schaden**: Manipulation fremder, echter Kalendereinträge im externen Kalender-Client jedes
Abonnenten — kein Codeausführungsrisiko, aber ein reales Integritätsproblem über die App-Grenze
hinaus.

**Behebung**: `escapeIcsText` behandelt jetzt auch `\r` (und `\r\n` als eine Einheit), konsistent
mit der vorhandenen `\n`-Behandlung.

---

### 6. Keine Obergrenze für Nutzinhalte — weder Body-Size-Limit noch durchgängige Schema-`.max()`

**Schweregrad: mittel** — **Status: behoben in #122**

**Was**: Kein globales Body-Size-Limit in der Hono-App. Mehrere Zod-Schemas, die tatsächlich
`.parse()`t werden (u. a. `updateAnnotationLayerInputSchema`s `objects`-Array), hatten keine
Größenobergrenze. ChordPro-Songinhalt, Event-/Poll-Notizen und weiterer Freitext waren zusätzlich
als reiner CRDT-Schreibzugriff nie serverseitig validiert, bevor sie an alle verbundenen Clients
verteilt wurden — die Schema-Prüfung lief erst im nachgelagerten, debounced Persistenz-Hook.

**Wo**: `apps/server/src/index.ts`, `apps/server/src/routes/annotations.ts`,
`apps/server/src/lib/hocuspocus.ts`.

**Mechanismus**: Ein einzelnes, ganz normal authentifiziertes Bandmitglied konnte beliebig große
Payloads einreichen — per REST ungebremst gepuffert, per CRDT ungeprüft an alle verbundenen
Clients verteilt, bevor der Server überhaupt validierte.

**Schaden**: Speicher-/Bandbreiten-Erschöpfung auf dem Server und bei allen gerade verbundenen
Mitgliedern derselben Band durch eine einzelne authentifizierte Anfrage.

**Behebung**: Globales `hono/body-limit` (5MB) und ein `maxPayload` auf der Hocuspocus-WebSocket-
Verbindung (20MB) als Transport-Backstop; `.max()` auf alle betroffenen Freitext-/Array-Felder,
mit Werten deutlich über realistischer Nutzung (z. B. ChordPro-Inhalt bis 300.000 Zeichen,
Annotation-Objekte bis 5.000 pro Ebene — Details in den jeweiligen Schema-Kommentaren).

---

### 7. Fehlende Indizes auf mehrfach abgefragten Spalten

**Schweregrad: niedrig** — **Status: behoben in #119**

**Was**: Kein Index auf `bandMembers.userId` (nur als nicht-führende Spalte im
Verbund-Primärschlüssel), `invites.bandId`, `pushSubscriptions.userId` oder
`voiceAnnotationLayers.sourceLayerId`.

**Wo**: `apps/server/src/db/schema/bandMembers.ts`, `invites.ts`, `pushSubscriptions.ts`,
`voiceAnnotationLayers.ts`.

**Mechanismus**: Betraf konkret `GET /bands` und besonders den öffentlichen, tokenbasierten
ICS-Feed, der laut Design bewusst wiederholt und unauthentifiziert von Kalender-Apps abgerufen
wird — mit wachsender Tabelle ein Sequential Scan pro Anfrage.

**Schaden**: Kein direkter Datenzugriff, aber ein realer Skalierungs-/leichter DoS-Hebel gerade an
der einzigen unauthentifizierten Route der Anwendung.

**Behebung**: `index()` auf den vier genannten Spalten ergänzt.

---

### 8. Zod-Validierungsfehler landeten als generischer 500er, nicht als 400er

**Schweregrad: kosmetisch** — **Status: behoben in #119**

**Was**: Kein `app.onError(...)` in `apps/server/src/index.ts`. Ein werfender
`schema.parse(...)`-Aufruf fiel auf Honos Standard-Fehlerbehandler zurück (generisches
`"Internal Server Error"`, 500) — kein Leck von Interna, aber jede normale Falscheingabe sah in
Logs/Monitoring aus wie ein echter Serverfehler.

**Wo**: `apps/server/src/index.ts`.

**Schaden**: Keine Sicherheitsauswirkung. Erschwerte Monitoring/Debugging.

**Behebung**: `app.onError` beantwortet `ZodError` jetzt explizit mit 400 und einer minimalen
Liste aus Feldpfad und Fehlertyp — bewusst ohne den empfangenen Wert, den einzelne Zod-Codes sonst
mitliefern, damit die Antwort keine Anleitung fürs Austesten akzeptierter Werte wird.

**Nachtrag (behoben in #124)**: Die ursprüngliche Behebung war unverifiziert — jede
Integrationstest-Datei sprach ihren jeweiligen Sub-Router direkt an (`bandsRoute.request(...)`
statt der vollen `app`), umging damit `app.onError` (und ebenso CORS und das Body-Limit aus
Befund 6) vollständig und testete eine Anwendung, die im echten Betrieb so nie läuft. Die
Hono-App-Konstruktion wurde aus `index.ts` in ein eigenes, seiteneffektfreies `app.ts` ausgelagert
(`index.ts` bleibt nur noch für den tatsächlichen Serverstart zuständig), und alle zehn
Integrationstest-Dateien sprechen jetzt diese echte, vollständig zusammengesetzte `app` an. Zwei
bestehende Tests (`userPrefs.integration.test.ts`, `annotations.integration.test.ts`) erwarteten
wegen des Bypasses bislang 500 statt 400 — beide korrigiert, nachdem der reale Pfad die 400er
tatsächlich liefert. Zwei neue Tests in `app.integration.test.ts` beweisen den Zod-400-Pfad und
das Body-Limit gezielt gegen die echte `app`; beide wurden vor der Korrektur nachweislich rot
verifiziert (400/413 durch den jeweiligen Fix ersetzt gegen 500/401 ohne ihn).

---

## Was in Ordnung ist (geprüft, nichts gefunden)

- **Autorisierung der REST-Routen**: Jede band-bezogene Route wurde einzeln durchgesehen
  (`bands`, `invites`, `members`, `songs`, `setlists`, `annotations`, `events`, `polls`, `files`,
  `push`, `userPrefs`, `icsToken`, `calendarFeed`). Durchgängiges Muster: `requireBandRole` prüft
  echte Mitgliedschaft über den `:bandId`-Pfadparameter, gefolgt von einem expliziten `can()`/
  `canRemoveMember()`-Check aus der einen zentralen Matrix. Keine Route gefunden, die eine ID aus
  dem Pfad nimmt, ohne ihre Zugehörigkeit zur Band des Aufrufers zu prüfen (der klassische IDOR-Fall,
  nach dem gezielt gesucht wurde) — auch nicht bei `annotations.ts`s Sonderfällen (geteilte Layer,
  Konfliktkopien) oder `members.ts`s Owner-Transfer.
- **CSRF**: Kein explizites CSRF-Token, aber die Kombination aus striktem CORS-Origin-Allowlist
  (`apps/server/src/index.ts`, `origin: [WEB_ORIGIN]`) und dem Zwang zu `Content-Type: application/json`
  auf jeder zustandsändernden Route verhindert die klassischen formularbasierten CSRF-Varianten
  wirksam (ein HTML-Formular kann diesen Content-Type nicht ohne Preflight setzen, der Preflight
  scheitert an der Origin-Prüfung).
- **Login-/Passwort-Reset-Rate-Limiting**: better-auth bringt eigene, sinnvolle Standard-Limits mit
  (3 Versuche/10s für Login/Sign-up/Change-Password, 3/60s für Passwort-Reset-Anfragen), automatisch
  aktiv sobald `NODE_ENV=production` — was `docker/Dockerfile.server` bereits setzt. Verifiziert
  direkt im `better-auth`-Paketcode, nicht angenommen.
- **ICS-Feed-Token**: 32 zufällige Bytes (`randomBytes(32).toString('hex')`,
  `apps/server/src/routes/icsToken.ts`) — praktisch nicht erratbar. Mitgliedschaft wird bei
  jedem einzelnen Abruf frisch aus Postgres nachgeprüft (nicht gecacht), Regenerierung invalidiert
  den alten Token sofort und vollständig. Rate-Limiting greift (10/Minute/IP).
- **CRDT-Manipulationsschutz für Löschungen und Antwort-Eigentümerschaft**: Der
  `hocuspocus.ts`-Guard für `songs`/`voices`/`setlists`-Löschungen und für
  `availability`/`pollVotes`-Schlüsseleigentümerschaft ist real, getestet (Integrationstest mit
  echter manipulierter Client-Verbindung, nicht nur ein Mock) und funktioniert wie dokumentiert —
  siehe Befund 3 für die inzwischen geschlossenen Lücken außerhalb dieses ursprünglich engen
  Anwendungsbereichs.
- **SQL-Injection**: Kein einziger Fund. Jede `sql`\`-Verwendung im gesamten Server-Code nutzt
  Drizzles parametrisierte Platzhalter, keine Stringverkettung.
- **XSS/Output-Encoding**: Kein `dangerouslySetInnerHTML` im gesamten Web-Client. ChordPro-Rendering
  läuft vollständig über React-Kinder, nie über rohes HTML. Geo-/Karten-Links werden korrekt
  URL-kodiert bzw. sind durch numerische Zod-Schemas gegen Schema-Injektion abgesichert. Push-Payloads
  laufen sauber durch `JSON.stringify`.
- **Offline-Cache-Scoping**: Der IndexedDB-Cache pro Band ist per `userId`+`bandId` geschlüsselt
  (`apps/web/src/lib/yjs.ts`, dokumentiert in ADR-0006) und wird beim serverseitig bestätigten
  Mitgliedschaftsverlust aktiv geleert (`apps/web/src/hooks/useBandDoc.ts`, ausgelöst durch
  Hocuspocus' `notAMember`-Fehler) — nicht nur beim expliziten "Lokale Daten löschen".
- **Abhängigkeiten**: `pnpm audit` meldet 0 Schwachstellen (geprüft, nicht nur ausgeführt). Keine
  unüblichen, verwaisten oder Typosquatting-verdächtigen Pakete in den drei `package.json`-Dateien.
- **Geheimnisse in der Git-Historie**: Vollständige Historie durchsucht (Pickaxe-Suche über
  bekannte Secret-Muster, jede je hinzugefügte Datei geprüft) — nirgends ein echtes Secret gefunden,
  nur die erwarteten Dev-Platzhalter. Eine einzelne, längst wieder entfernte Diagnose-Logging-Zeile
  in einem CI-Fix-Commit hat ausschließlich Platzhalter-Werte ausgegeben, kein echtes Secret.
- **Kaskaden beim Löschen**: Jeder Fremdschlüssel im Schema hat ein explizites `onDelete`
  (`cascade` oder `set null` bei reinen Audit-Spalten) — kein verlassener Datensatz, keine
  überraschenden `RESTRICT`-Fehler bei normalen Löschvorgängen.
- **Zeitfenster-Angriffe/Fehlermeldungen bei Auth**: Kein Hinweis auf unterschiedliche Antworten
  oder Timing-Unterschiede, die Kontoexistenz verraten würden — better-auth behandelt das intern.

---

## Nebenschauplatz (ohne Sicherheitsbezug)

- `apps/server/src/routes/files.ts` und `apps/server/src/lib/hocuspocus.ts` sind noch nicht
  kritisch groß, aber `hocuspocus.ts` trägt inzwischen vier fachlich unterschiedliche
  Zuständigkeiten (Persistenz, Manipulationsschutz, Push-Benachrichtigung, jetzt auch die
  Rollen-Guards aus Befund 3) in einer Datei — ein künftiger fünfter Anwendungsfall sollte das
  eher in eigene Module aufteilen als eine weitere Zuständigkeit anhängen.
- Die drei ursprünglich identischen `z.string().length(64)`-Definitionen (Befund 4) wurden bei der
  Behebung bereits zu einer gemeinsamen Konstante zusammengezogen.
- Befund 8s Nachtrag (#124) betraf nicht nur diesen einen Fix: Sub-Router-Tests umgingen auch
  CORS und das Body-Limit aus Befund 6 vollständig. Für künftige app-weite Middleware gilt jetzt
  durchgängig, dass ein Test gegen die echte `app` (`apps/server/src/app.ts`) laufen muss, nicht
  gegen einen einzelnen Sub-Router.

---

## Nachtrag 2026-09: Passwort-Implementierung (im Zuge der Account-Settings-Erweiterung geprüft)

Kein Teil des ursprünglichen August-Reviews — eine gezielte Nachprüfung der Passwort-Mechanik vor
dem Bau von Anzeigename-/Passwort-/E-Mail-Änderung in den Kontoeinstellungen.

- **Hashing**: better-auth nutzt scrypt (`@better-auth/utils`, N=16384, r=16, p=1, 64-Byte-Derivat)
  — ein solides, mitgeliefertes Standard-Setup, von Bandstand nicht überschrieben. Kein Befund.
- **Mindestlänge**: 8 Zeichen, server- und clientseitig — better-auths eigener Default, von
  Bandstand nicht angehoben. Das ist NIST 800-63B als absolutes Minimum konform, nicht die dort
  empfohlenen ≥12. Bewusst nicht angehoben in diesem Zuge (reine Policy-Entscheidung, kein Bug) —
  vorgemerkt als mögliche künftige Härtung, keine offene Advisory.
- **Bekannt kompromittierte Passwörter**: werden nicht geprüft (kein HaveIBeenPwned-Abgleich, kein
  zxcvbn, keine Deny-Liste). Echte, aber eigenständige Lücke — nicht im Rahmen dieser
  Account-Settings-Arbeit behoben, da sie einen neuen externen Abgleich erfordert statt einer
  lokalen Korrektur. Vorgemerkt als offener Punkt für ein künftiges Review.
- **Sitzungs-Invalidierung bei Passwortänderung — Status: behoben in #166**: Weder der bestehende
  Passwort-Reset-Flow noch das (zu diesem Zeitpunkt noch nicht existierende) Ändern-Passwort-Flow
  invalidierten andere Sitzungen serverseitig — better-auth lässt das standardmäßig aus
  (`revokeSessionsOnPasswordReset` global unset, `revokeOtherSessions` pro Aufruf optional und
  nirgends gesetzt). Eine gestohlene Sitzung/ein gestohlenes Bearer-Token hätte sowohl einen
  Reset als auch eine Änderung unbeschadet überlebt. Behoben: `revokeSessionsOnPasswordReset: true`
  in `apps/server/src/lib/auth.ts`, sowie `revokeOtherSessions: true` beim neuen
  Ändern-Passwort-Aufruf (`apps/web/src/components/ChangePasswordForm.tsx`).
- **Logging**: keine Stelle gefunden, an der ein Klartext-Passwort geloggt werden könnte (kein
  Request-Body-Logging, Zod-Fehler geben nie den Wert zurück). Kein Befund.

---

## Zusammenfassung

**Was in Ordnung ist**: Die REST-Autorisierungsschicht ist durchgängig sauber (kein einziger IDOR
gefunden trotz gezielter Suche), SQL-Injection und XSS sind nicht vorhanden, Abhängigkeiten und
Git-Historie sind sauber, und die bereits als sicherheitskritisch bekannten Mechanismen
(ICS-Token, Offline-Cache-Scoping, CRDT-Löschschutz, Rate-Limiting) funktionieren tatsächlich wie
dokumentiert.

**Was zum Zeitpunkt des Reviews beunruhigen musste**: Zwei Befunde (1 und 2) waren auf einer
realistisch konfigurierten Selfhosting-Instanz ohne besondere Angreiferfähigkeiten ausnutzbar und
gaben Zugriff auf fremde Daten bzw. auf die gesamte Instanz. Befund 3 zeigte außerdem, dass die
Berechtigungsmatrix an mehreren Stellen dokumentiertes Verhalten behauptete ("admin-gated"), das
serverseitig gar nicht existierte — ein Muster, auf das bei jedem neuen, rein-CRDT-basierten
Feature erneut zu achten ist.

**Alle acht Befunde sind behoben** (#119, #120, #121, #122, #124 — siehe Status pro Befund), keine
offene Anschlussarbeit mehr. Befund 8s ursprünglicher Fix war zunächst unverifiziert, weil jede
Integrationstest-Datei einen Sub-Router statt der echten, vollständig zusammengesetzten `app`
ansprach — das betraf nicht nur den Error-Handler, sondern auch CORS und das Body-Limit aus
Befund 6, die auf demselben Weg ebenso ungetestet blieben. #124 hat das für alle zehn
Integrationstest-Dateien behoben.
