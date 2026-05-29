# Årshjul

Et superenkelt årshjul for barnehagen. 12 måneder som kakestykker, tre ringer du
fyller inn selv. Norsk, utskrivbart, og laget for å vare evig uten vedlikehold.

## Slik virker det
- **Klikk på en måned** for å legge til i de tre ringene (ytterste / midterste / innerste).
- **Klikk i midten** for innstillinger (navn, år, startmåned, ringnavn).
- Alt lagres automatisk i nettleseren din.
- **Kopier delingslenke** – åpne hjulet på en annen skjerm eller send til kolleger.
- **Last ned sikkerhetskopi / Hent inn fil** – ta vare på en kopi.
- **Skriv ut / PDF** – skriver ut hjulet på én A4 (liggende); velg «Lagre som PDF».

## Teknisk
Ren statisk side: `index.html` + `styles.css` + `app.js`. Ingen rammeverk, ingen
byggesteg, ingen avhengigheter, ingen database. Kan åpnes rett fra fil eller hostes
gratis som statisk side (f.eks. Vercel).

### Kjøre lokalt
Åpne `index.html` i nettleseren, eller server mappa:
```
python3 -m http.server
```

### Deploye til Vercel
Importer repoet i Vercel og velg «Other» som framework (output = rotmappa).
Ingen miljøvariabler, ingen funksjoner.
