# Flotas – automobilių sekimas

## Kaip tai veikia
1. Įmonė užsiregistruoja (el. paštas + slaptažodis) ir mato žemėlapį.
2. Įmonė prideda automobilį (numeris, vairuotojas) – sistema sugeneruoja 6 simbolių KODĄ.
3. Vadovas nusiunčia kodą vairuotojui.
4. Vairuotojas telefone atidaro `https://JŪSŲ-ADRESAS/driver.html`, įveda kodą ir leidžia GPS.
5. Įmonė realiu laiku mato: VAŽIUOJA / STOVI (kiek laiko) / NĖRA RYŠIO, greitį, maršrutą per 24 val.
Kodas vienkartinis. „Naujas kodas“ atjungia seną telefoną.

## Paleidimas
    npm install
    npm start        # http://localhost:3000
Reikia Node.js 22+. Duomenys – failas flotas.db.

## Svarbu
- Telefono GPS naršyklėje veikia TIK per HTTPS – serverį reikia talpinti su domenu (Render, Railway, Fly.io, VPS + Caddy).
- Naršyklės versija siunčia vietą, kol programėlė atidaryta ir ekranas įjungtas. Kad sektų išjungtu ekranu / fone – reikia Android programėlės (Capacitor + background-geolocation) – kitas žingsnis.
- Statusas „važiuoja“ – kai greitis ≥ 5 km/h (keičiama server.js: MOVING_KMH).

## Mobiliosios programėlės (Android + iOS)
Vairuotojo programėlė (Capacitor) siunčia vietą ir fone, ir išjungtu ekranu.
1. Įkelkite visą aplanką į GitHub saugyklą.
2. Settings → Secrets and variables → Actions → **Variables** → `SERVER_URL` = `https://jusu-domenas.lt`
3. Actions → „Mobiliosios programėlės“ → Run workflow. Android job atiduoda `flotas-android-apk` (įdiegiamas tiesiai į telefoną).
4. iOS: workflow tik patikrina, kad surenkama. Į iPhone ir App Store reikia Apple Developer paskyros (99 $/metus) ir pasirašymo – atskiras žingsnis.
Serverio dalis: `Dockerfile` (duomenys /data aplanke – prijunkite nuolatinį diską).

## Talpinimas (rekomenduojama – VPS ~4 €/mėn.)
1. VPS: https://www.hetzner.com/cloud (Ubuntu 24.04), įdiekite Docker: `curl -fsSL https://get.docker.com | sh`
2. Domenas .lt: https://www.domreg.lt/ → A įrašą nukreipkite į serverio IP.
3. Įkelkite aplanką į serverį, Caddyfile įrašykite savo domeną, paleiskite `docker compose up -d`. HTTPS gaunamas automatiškai.
4. Atsarginė kopija: kas naktį kopijuokite Docker tomą `flotas-data` (faile flotas.db yra visi duomenys).
5. Prieš skelbdami programėlę Google Play / App Store, `public/privacy.html` užpildykite savo rekvizitais.
