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
        
        const routes = await leerCSVdesdeZIP(zip, 'routes.txt');
        const trips = await leerCSVdesdeZIP(zip, 'trips.txt');
        const stops = await leerCSVdesdeZIP(zip, 'stops.txt');

        // 🚫 FILTRO ANTI-RODALIES (Ignora R1, R2, R3...)
        const regexRodalies = /^R\d+/i; 

        let rutasValidas = {};
        routes.forEach(r => {
            let nombreCorto = (r.route_short_name || "").trim();
            if (regexRodalies.test(nombreCorto)) return; // Salta Rodalies

            rutasValidas[r.route_id] = {
                p: tipoMalla === "Cercanías" ? "Cercanías" : "Media/Larga Distancia",
                f: tipoMalla === "Cercanías" ? `Cercanías (Línea ${nombreCorto})` : nombreCorto,
                l: nombreCorto,
                c: tipoMalla === "Cercanías"
            };
        });

        let viajes = {};
        // 🛡️ Limitamos a los primeros 15.000 para que GitHub no lo rechace
        const tripsAceptados = trips.slice(0, 15000); 

        tripsAceptados.forEach(t => {
            if (!rutasValidas[t.route_id]) return;
            viajes[t.trip_id] = { 
                ...rutasValidas[t.route_id], 
                n: t.trip_short_name || t.trip_id, 
                s: t.service_id 
            };
        });

        console.log(`✅ Viajes encontrados (Sin Rodalies): ${Object.keys(viajes).length}`);

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
        console.log(`📦 Finalizado. Peso: ${Math.round(fs.statSync(archivoSalida).size / 1024 / 1024)} MB`);

    } catch (e) { console.error(e); }
}

async function start() {
    await procesarMalla(URL_CERCANIAS, "cercanias_opt.json", "Cercanías");
    await procesarMalla(URL_MDLD, "mdld_opt.json", "Larga Distancia");
}
start();
