const axios = require('axios');
const AdmZip = require('adm-zip');
const csv = require('csv-parser');
const fs = require('fs');
const { Readable } = require('stream');

const URL_CERCANIAS = "https://ssl.renfe.com/ftransit/Fichero_CER_FOMENTO/fomento_transit.zip"; 
const URL_MDLD = "https://ssl.renfe.com/gtransit/Fichero_AV_LD/google_transit.zip"; 

function leerCSVdesdeZIP(zip, fileName) {
    return new Promise((resolve, reject) => {
        const entry = zip.getEntry(fileName);
        if (!entry) return resolve([]);
        const results = [];
        const bufferStream = new Readable();
        bufferStream.push(entry.getData());
        bufferStream.push(null);
        bufferStream.pipe(csv()).on('data', (d) => results.push(d)).on('end', () => resolve(results)).on('error', reject);
    });
}

async function procesarMalla(url, archivoSalida, tipoMalla) {
    try {
        console.log(`\n🚀 Procesando: ${tipoMalla}`);
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        const zip = new AdmZip(response.data);
        
        const calendar = await leerCSVdesdeZIP(zip, 'calendar.txt');
        const routes = await leerCSVdesdeZIP(zip, 'routes.txt');
        const trips = await leerCSVdesdeZIP(zip, 'trips.txt');
        const stops = await leerCSVdesdeZIP(zip, 'stops.txt');

        // 📅 FILTRO: SOLO HOY (1 DÍA)
        let hoy = new Date();
        let fHoy = hoy.getFullYear() + String(hoy.getMonth()+1).padStart(2,'0') + String(hoy.getDate()).padStart(2,'0');

        let sidsHoy = new Set();
        calendar.forEach(c => { if (fHoy >= c.start_date && fHoy <= c.end_date) sidsHoy.add(c.service_id); });

        // 🚫 FILTRO ANTI-RODALIES (Evita R1, R2, R3...)
        const regexRodalies = /^R\d+/i; 

        let rutasValidas = {};
        routes.forEach(r => {
            let nombreLargo = (r.route_long_name || "").trim();
            let nombreCorto = (r.route_short_name || "").trim();
            
            // Si empieza por R + número, lo ignoramos
            if (regexRodalies.test(nombreCorto)) return;

            rutasValidas[r.route_id] = {
                p: tipoMalla === "Cercanías" ? "Cercanías" : "Media/Larga Distancia",
                f: tipoMalla === "Cercanías" ? `Cercanías (Línea ${nombreCorto})` : nombreCorto,
                l: nombreCorto,
                c: tipoMalla === "Cercanías"
            };
        });

        let viajes = {};
        trips.forEach(t => {
            if (!sidsHoy.has(t.service_id) || !rutasValidas[t.route_id]) return;
            viajes[t.trip_id] = { ...rutasValidas[t.route_id], n: t.trip_short_name || t.trip_id, s: t.service_id };
        });

        console.log(`✅ Viajes para hoy (sin Rodalies): ${Object.keys(viajes).length}`);

        let estaciones = {};
        stops.forEach(s => { estaciones[s.stop_id] = s.stop_name; });

        let horarios = [];
        let limites = {};
        const bufferStream = new Readable();
        bufferStream.push(zip.getEntry('stop_times.txt').getData());
        bufferStream.push(null);

        await new Promise((resolve) => {
            bufferStream.pipe(csv()).on('data', (st) => {
                if (!viajes[st.trip_id]) return;
                let seq = parseInt(st.stop_sequence);
                horarios.push({ t: st.trip_id, s: st.stop_id, a: st.arrival_time, d: st.departure_time, q: seq });
                
                if (!limites[st.trip_id]) limites[st.trip_id] = { min: seq, max: seq, o: st.stop_id, d: st.stop_id, h: st.arrival_time };
                if (seq < limites[st.trip_id].min) { limites[st.trip_id].min = seq; limites[st.trip_id].o = st.stop_id; }
                if (seq > limites[st.trip_id].max) { limites[st.trip_id].max = seq; limites[st.trip_id].d = st.stop_id; limites[st.trip_id].h = st.arrival_time; }
            }).on('end', resolve);
        });

        const final = { v: "1.4", e: estaciones, h: horarios, j: viajes, l: limites };
        fs.writeFileSync(archivoSalida, JSON.stringify(final));
        console.log(`📦 Peso final: ${Math.round(fs.statSync(archivoSalida).size / 1024 / 1024)} MB`);

    } catch (e) { console.error(e); }
}

async function start() {
    await procesarMalla(URL_CERCANIAS, "cercanias_opt.json", "Cercanías");
    await procesarMalla(URL_MDLD, "mdld_opt.json", "Larga Distancia");
}
start();
