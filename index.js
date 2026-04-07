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
        
        const trips = await leerCSVdesdeZIP(zip, 'trips.txt');
        const stops = await leerCSVdesdeZIP(zip, 'stops.txt');
        const routes = await leerCSVdesdeZIP(zip, 'routes.txt');

        console.log(`📊 Total viajes en el ZIP: ${trips.length}`);

        // 🛡️ LIMITADOR DE SEGURIDAD (Para no pasar de 100MB en GitHub)
        // Cogemos solo los primeros 15.000 viajes para asegurar que no esté vacío
        const viajesLimitados = trips.slice(0, 15000);

        let estaciones = {};
        stops.forEach(s => { estaciones[s.stop_id] = s.stop_name; });
        let rutasMap = {};
        routes.forEach(r => { rutasMap[r.route_id] = r.route_short_name || r.route_long_name; });

        let viajes = {};
        viajesLimitados.forEach(t => {
            viajes[t.trip_id] = {
                n: t.trip_short_name || t.trip_id,
                l: rutasMap[t.route_id] || "",
                s: t.service_id,
                c: tipoMalla === "Cercanías"
            };
        });

        console.log(`✅ Procesando ${Object.keys(viajes).length} viajes seleccionados...`);

        let horarios = [];
        let limites = {};
        
        await new Promise((resolve) => {
            const entry = zip.getEntry('stop_times.txt');
            const bufferStream = new Readable();
            bufferStream.push(entry.getData());
            bufferStream.push(null);

            bufferStream.pipe(csv()).on('data', (st) => {
                if (!viajes[st.trip_id]) return; // Solo paradas de los viajes que hemos aceptado
                
                let seq = parseInt(st.stop_sequence);
                horarios.push({ t: st.trip_id, s: st.stop_id, a: st.arrival_time, d: st.departure_time, q: seq });
                
                if (!limites[st.trip_id]) limites[st.trip_id] = { min: seq, max: seq, o: st.stop_id, d: st.stop_id };
                if (seq < limites[st.trip_id].min) { limites[st.trip_id].min = seq; limites[st.trip_id].o = st.stop_id; }
                if (seq > limites[st.trip_id].max) { 
                    limites[st.trip_id].max = seq; 
                    limites[st.trip_id].d = st.stop_id; 
                    limites[st.trip_id].h = st.arrival_time;
                }
            }).on('end', resolve);
        });

        const final = { v: "1.2", u: new Date().toLocaleString('es-ES'), e: estaciones, h: horarios, j: viajes, l: limites };
        fs.writeFileSync(archivoSalida, JSON.stringify(final));
        console.log(`📦 Finalizado. Peso: ${Math.round(fs.statSync(archivoSalida).size / 1024 / 1024)} MB`);

    } catch (e) { console.error("❌ ERROR:", e); }
}

async function start() {
    await procesarMalla(URL_CERCANIAS, "cercanias_opt.json", "Cercanías");
    await procesarMalla(URL_MDLD, "mdld_opt.json", "Larga Distancia");
}
start();
