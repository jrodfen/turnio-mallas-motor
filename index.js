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
        bufferStream.pipe(csv())
            .on('data', (data) => results.push(data))
            .on('end', () => resolve(results))
            .on('error', reject);
    });
}

async function procesarMalla(url, archivoSalida, tipoMalla) {
    try {
        console.log(`\n🚀 Iniciando procesamiento de: ${tipoMalla}`);
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        const zip = new AdmZip(response.data);
        
        const stops = await leerCSVdesdeZIP(zip, 'stops.txt');
        const routes = await leerCSVdesdeZIP(zip, 'routes.txt');
        const trips = await leerCSVdesdeZIP(zip, 'trips.txt');
        const calendar = await leerCSVdesdeZIP(zip, 'calendar.txt');
        const calendarDates = await leerCSVdesdeZIP(zip, 'calendar_dates.txt');

        // Filtro 30 días a futuro para evitar el límite de GitHub
        let hoy = new Date();
        let fechaHoyStr = hoy.getFullYear() + String(hoy.getMonth()+1).padStart(2,'0') + String(hoy.getDate()).padStart(2,'0');
        let maxDate = new Date();
        maxDate.setDate(maxDate.getDate() + 30);
        let fechaMaxStr = maxDate.getFullYear() + String(maxDate.getMonth()+1).padStart(2,'0') + String(maxDate.getDate()).padStart(2,'0');

        let validServiceIds = new Set();
        let calendarios = {};
        
        calendar.forEach(c => {
            if (c.end_date >= fechaHoyStr && c.start_date <= fechaMaxStr) {
                validServiceIds.add(c.service_id);
                calendarios[c.service_id] = { start: c.start_date, end: c.end_date };
            }
        });

        calendarDates.forEach(cd => {
            if (cd.date >= fechaHoyStr && cd.date <= fechaMaxStr) {
                validServiceIds.add(cd.service_id);
            }
        });

        let estaciones = {};
        stops.forEach(s => { estaciones[s.stop_id] = s.stop_name; });

        let rutasMap = {};
        routes.forEach(r => { rutasMap[r.route_id] = r; });

        let viajes = {};
        trips.forEach(t => {
            if (!validServiceIds.has(t.service_id)) return; 
            let r = rutasMap[t.route_id] || {};
            viajes[t.trip_id] = {
                numero_tren: t.trip_short_name || t.trip_id,
                nombreVisualFrontal: r.route_short_name || tipoMalla,
                productoFiltro: r.route_long_name || tipoMalla,
                lineaTren: r.route_short_name || "",
                accesible: t.wheelchair_accessible === "1",
                unidad: "N/D",
                service_id: t.service_id,
                esCercanias: tipoMalla === "Cercanías"
            };
        });

        let paradasPorViaje = {};
        await new Promise((resolve, reject) => {
            const entry = zip.getEntry('stop_times.txt');
            if (!entry) return resolve();

            const bufferStream = new Readable();
            bufferStream.push(entry.getData());
            bufferStream.push(null);

            bufferStream.pipe(csv())
                .on('data', (st) => {
                    if (!viajes[st.trip_id]) return; 
                    if (!paradasPorViaje[st.trip_id]) paradasPorViaje[st.trip_id] = [];
                    paradasPorViaje[st.trip_id].push({
                        trip_id: st.trip_id,
                        stop_id: st.stop_id,
                        arrival_time: st.arrival_time,
                        departure_time: st.departure_time,
                        stop_sequence: parseInt(st.stop_sequence)
                    });
                })
                .on('end', resolve)
                .on('error', reject);
        });

        let horariosFiltrados = [];
        let limitesViajes = {};
        
        for (let tripId in paradasPorViaje) {
            let paradas = paradasPorViaje[tripId];
            paradas.sort((a, b) => a.stop_sequence - b.stop_sequence); 
            
            let pOrigen = paradas[0];
            let pDestino = paradas[paradas.length - 1];

            limitesViajes[tripId] = {
                min: pOrigen.stop_sequence,
                max: pDestino.stop_sequence,
                origen: pOrigen.stop_id,
                destino: pDestino.stop_id,
                hora_llegada_destino: pDestino.arrival_time || pDestino.departure_time
            };
            
            horariosFiltrados.push(...paradas);
        }

        const jsonFinal = {
            ultimaActualizacion: new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid' }),
            estaciones: estaciones,
            horarios: horariosFiltrados,
            viajes: viajes,
            calendarios: calendarios,
            limitesViajes: limitesViajes
        };

        fs.writeFileSync(archivoSalida, JSON.stringify(jsonFinal));
        console.log(`✅ ${tipoMalla} finalizado. Peso: ${Math.round(fs.statSync(archivoSalida).size / 1024 / 1024)} MB`);

    } catch (error) {
        console.error(`❌ Error en ${tipoMalla}:`, error);
    }
}

async function ejecutarTodo() {
    console.log("🚂 INICIANDO MOTOR GTFS 🚂");
    await procesarMalla(URL_CERCANIAS, "cercanias_opt.json", "Cercanías");
    await procesarMalla(URL_MDLD, "mdld_opt.json", "Larga y Media Distancia");
    console.log("🏁 FIN.");
}

ejecutarTodo();
