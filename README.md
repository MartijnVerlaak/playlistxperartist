# Spotify artiesten naar playlist

Statische web-app voor GitHub Pages. Geen Python, npm, server of client secret nodig. De app gebruikt OAuth 2.0 Authorization Code met PKCE.

## Belangrijke beperking sinds februari 2026

Spotify heeft `GET /artists/{id}/top-tracks` verwijderd voor apps in Development Mode. Daarom:

1. probeert de app eerst de officiële top-tracks-endpoint, voor het geval je app Extended Quota Mode heeft;
2. gebruikt hij anders de hoogst gerangschikte resultaten van Spotify Search die exact bij de gevonden artiest horen.

Die fallback is een benadering en is niet hetzelfde als Spotify's officiële toptracks.

## Stap 1: bestanden op GitHub plaatsen

1. Maak een nieuwe GitHub-repository, bijvoorbeeld `spotify-playlistmaker`.
2. Pak het ZIP-bestand uit.
3. Upload `index.html`, `styles.css` en `app.js` in de hoofdmap van de repository.
4. Open in GitHub: **Settings > Pages**.
5. Kies bij **Build and deployment**: **Deploy from a branch**.
6. Kies branch **main** en map **/(root)** en klik **Save**.
7. Open de GitHub Pages-URL zodra GitHub die toont.

## Stap 2: exacte Redirect URI registreren

1. Open je gepubliceerde app.
2. Bovenaan toont de app de exacte Redirect URI.
3. Kopieer die URI.
4. Open het Spotify Developer Dashboard.
5. Open je app met Client ID `e4d1519af9694cc89525dcb33bc93ccf`.
6. Ga naar **Settings**.
7. Voeg de gekopieerde URL exact toe bij **Redirect URIs**. Let op hoofdletters, pad en afsluitende `/`.
8. Selecteer **Web API** als Spotify daarom vraagt.
9. Sla op.

Gebruik geen client secret in deze bestanden. Een client secret hoort nooit in een publieke GitHub Pages-repository.

## Stap 3: Development Mode controleren

Voor Development Mode moet de eigenaar van de Spotify-app Premium hebben. Alleen toegelaten gebruikers kunnen de API gebruiken. Voeg indien nodig je Spotify-account toe onder **Users Management** in de appinstellingen.

## Stap 4: gebruiken

1. Open je GitHub Pages-app.
2. Klik **Log in met Spotify** en geef toestemming.
3. Vul één artiest per regel in.
4. Kies 1 tot 10 tracks per artiest en een marktcode, bijvoorbeeld `BE`.
5. Kies een playlistnaam en openbaar/privé.
6. Klik **Maak playlist**.

## Fouten

- **INVALID_CLIENT / INVALID_REDIRECT_URI**: de Redirect URI in Spotify verschilt van de URI die de app toont.
- **401**: token verlopen of ongeldig. Log uit en opnieuw in.
- **403**: gebruiker niet toegelaten, scope ontbreekt, of endpoint niet beschikbaar in Development Mode.
- **429 met QUOTA_EXCEEDED**: het gedeelde Spotify-ontwikkelaarsquota is bereikt. Een nieuwe Client ID omzeilt dit niet, want Development Mode-apps van dezelfde developer delen het quota.
- **Gewone 429**: de app respecteert `Retry-After` en probeert maximaal drie keer opnieuw.
- Na een update op GitHub: voer een harde refresh uit met `Ctrl+Shift+R`.

## Veiligheid

Tokens worden alleen in `localStorage` van je browser bewaard. Publiceer nooit een Spotify client secret. Verwijder de toestemming in je Spotify-account als je de koppeling niet langer wilt gebruiken.
