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

        // 🚫 FILTRO ANTI-RODALIES: Ignora líneas R1, R2, R3...
        const regexRodalies = /^R\d+/i; 

        let rutasValidas = {};
        routes.forEach(r => {
            let routeIdLimpio = (r.route_id || "").trim(); // <-- ELIMINAMOS ESPACIOS BASURA
            let nombreCorto = (r.route_short_name || "").trim();
            if (regexRodalies.test(nombreCorto)) return; 

            rutasValidas[routeIdLimpio] = {
                p: tipoMalla === "Cercanías" ? "Cercanías" : "Media/Larga Distancia",
                f: tipoMalla === "Cercanías" ? `Cercanías (Línea ${nombreCorto})` : nombreCorto,
                l: nombreCorto,
                c: tipoMalla === "Cercanías"
            };
        });

        let viajes = {};
        // ⚖️ Limitamos a 45.000 viajes
        const tripsAceptados = trips.slice(0, 45000); 

        tripsAceptados.forEach(t => {
            let routeIdViaje = (t.route_id || "").trim(); // <-- ELIMINAMOS ESPACIOS BASURA
            let tripIdViaje = (t.trip_id || "").trim();
            
            if (!rutasValidas[routeIdViaje]) return; // ¡Ahora sí coincidirán!
            
            viajes[tripIdViaje] = { 
                ...rutasValidas[routeIdViaje], 
                n: (t.trip_short_name || t.trip_id).trim(), 
                s: (t.service_id || "").trim() 
            };
        });

        console.log(`✅ Viajes aceptados (Sin Rodalies): ${Object.keys(viajes).length}`);

        let estaciones = {};
        stops.forEach(s => { 
            estaciones[(s.stop_id || "").trim()] = (s.stop_name || "").trim(); 
        });

        let horarios = [];
        let limites = {};
        const stopTimesData = zip.getEntry('stop_times.txt').getData();
        const bufferStream = new Readable();
        bufferStream.push(stopTimesData);
        bufferStream.push(null);

        await new Promise((resolve) => {
            bufferStream.pipe(csv()).on('data', (st) => {
                let tripIdStop = (st.trip_id || "").trim();
                let stopId = (st.stop_id || "").trim();
                
                if (!viajes[tripIdStop]) return;
                
                let seq = parseInt(st.stop_sequence);
                horarios.push({ t: tripIdStop, s: stopId, a: st.arrival_time, d: st.departure_time, q: seq });
                
                if (!limites[tripIdStop]) {
                    limites[tripIdStop] = { min: seq, max: seq, o: stopId, d: stopId, h: st.arrival_time };
                } else {
                    if (seq < limites[tripIdStop].min) { limites[tripIdStop].min = seq; limites[tripIdStop].o = stopId; }
                    if (seq > limites[tripIdStop].max) { limites[tripIdStop].max = seq; limites[tripIdStop].d = stopId; limites[tripIdStop].h = st.arrival_time; }
                }
            }).on('end', resolve);
        });

        const final = { v: "1.4", e: estaciones, h: horarios, j: viajes, l: limites };
        fs.writeFileSync(archivoSalida, JSON.stringify(final));
        
        const pesoMB = Math.round(fs.statSync(archivoSalida).size / 1024 / 1024);
        console.log(`📦 Finalizado. Peso: ${pesoMB} MB`);

    } catch (e) { console.error("❌ Error grave:", e); }
}

async function start() {
    await procesarMalla(URL_CERCANIAS, "cercanias_opt.json", "Cercanías");
    await procesarMalla(URL_MDLD, "mdld_opt.json", "Larga Distancia");
}
start();
