# Årshjul

Et superenkelt årshjul for barnehagen. 12 måneder som kakestykker, fire ringer du
fyller inn selv. Norsk, utskrivbart, og laget for å vare evig uten vedlikehold.

## Slik virker det
- **Hold pekeren over hjulet** — infopanelet til høyre viser detaljer om måneden eller punktet du peker på.
- **Klikk** for å låse panelet; derfra åpner «Rediger» måneden for redigering.
- **Fire ringer** (standard: Arrangementer, Pedagogiske planer, Periodens fokus, Administrativt) — gi dem egne navn i innstillingene.
- **Periode** – et punkt kan gjelde fra–til en dato (f.eks. «Mummidalen» 1. sep – 8. okt) og vises da i alle månedene i perioden.
- **Klikk i midten** for innstillinger (navn, år, startmåned, ringnavn).
- Alt lagres automatisk i nettleseren din.
- **Kopier delingslenke** – åpne hjulet på en annen skjerm eller send til kolleger.
- **Vedlegg** – legg ved bilder, Word, Excel, PDF og tekstfiler på hver måned. Bilder vises som miniatyr; andre filer lastes ned.
- **Last ned sikkerhetskopi / Hent inn fil** – ta vare på en kopi av teksten.
- **Skriv ut / PDF** – skriver ut hjulet på én A4 (liggende); velg «Lagre som PDF».

## Sikkerhet og personvern
Laget for sensitive opplysninger (barn, helse). Viktig å vite:
- **Vedlegg ligger kun på enheten** (i nettleseren), aldri på en server. Ingen utenfra kan hente dem over nett.
- **Vedlegg er IKKE med i delingslenken eller sikkerhetskopien** – disse inneholder bare tekst. Vil du flytte filer til en annen enhet, må de kopieres manuelt.
- **Beskyttelsen er enheten selv**: filer lagres ukryptert i nettleseren. Stol på diskkryptering + skjermlås, og ikke lever fra deg en ulåst enhet.
- **Safari/iPad kan slette lagring** etter en stund – ta vare på egne kopier av viktige filer.
- Sletter du et vedlegg, fjernes selve filen fra enheten.

Se `docs/security-review-2026-06-28.md` for full sikkerhetsgjennomgang.

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
