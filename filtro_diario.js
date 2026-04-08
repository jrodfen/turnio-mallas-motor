const fs = require('fs');

// 🕒 1. DETERMINAR QUÉ DÍAS SON HOY Y MAÑANA
const mapaDias = { 0: 'D', 1: 'L', 2: 'M', 3: 'X', 4: 'J', 5: 'V', 6: 'S' };
const hoy = new Date();
const letraHoy = mapaDias[hoy.getDay()];
const letraManana = mapaDias[(hoy.getDay() + 1) % 7];

console.log(`\n⚙️ INICIANDO FILTRO DE TURNIO`);
console.log(`📅 Conservando trenes de HOY (${letraHoy}) y MAÑANA (${letraManana})`);

// 📂 2. FUNCIÓN PARA LEER LOS ARCHIVOS GIGANTES
function procesarArchivo(ruta) {
    if (!fs.existsSync(ruta)) {
        console.log(`⚠️ No se encuentra ${ruta}`);
        return { e: {}, h: [], j: {}, l: {} };
    }
    const rawData = fs.readFileSync(ruta, 'utf8');
    return JSON.parse(rawData);
}

// Cargamos la memoria bruta
const cercanias = procesarArchivo('cercanias_opt.json');
const mdld = procesarArchivo('mdld_opt.json');

// Combinamos las estaciones
let estacionesUnificadas = { ...mdld.e, ...cercanias.e };
let horariosBrutos = [...(cercanias.h || []), ...(mdld.h || [])];
let viajesBrutos = { ...(cercanias.j || {}), ...(mdld.j || {}) };
let limitesBrutos = { ...(cercanias.l || {}), ...(mdld.l || {}) };

console.log(`📦 Datos brutos cargados: ${horariosBrutos.length} paradas totales en España.`);

// ✂️ 3. LA CINTA TRANSPORTADORA (FILTRO ANTI-TRAMPAS DE RENFE)
let laborables = ['L', 'M', 'X', 'J', 'V'];
let esDiaLaborable = laborables.includes(letraHoy) || laborables.includes(letraManana);

let horariosFiltrados = horariosBrutos.filter(h => {
    let idTren = String(h.t).toUpperCase();

    // 🛡️ CLÁUSULA 1: Rodalies (R) o RT pasan directamente
    if (idTren.startsWith('R')) return true;

    let match = idTren.match(/^([LMXJVSD])\d/);
    if (match) {
        let letraTren = match[1];

        // 🛡️ CLÁUSULA 2: Coincidencia exacta con Hoy o Mañana
        if (letraTren === letraHoy || letraTren === letraManana) return true;

        // 🛡️ CLÁUSULA 3: La trampa de Rodalies (L = Laborables)
        // Si el tren empieza por L, y hoy/mañana es entre Lunes y Viernes, lo guardamos
        if (letraTren === 'L' && esDiaLaborable) return true;

        // 🛡️ CLÁUSULA 4: La trampa de los Diarios (D = Diario / Domingo)
        // Guardamos los D por seguridad, porque en muchos sitios significa que circula siempre
        if (letraTren === 'D') return true;

        // Si es un tren que estamos 100% seguros de que no circula (ej: es un tren 'S' de Sábado y hoy es Martes), a la basura.
        return false;
    }

    // 🛡️ CLÁUSULA 5: Si solo son números (ej: 77524) sin letra delante, pasa siempre
    return true;
});

// 🧹 4. LIMPIEZA PROFUNDA (Borramos los datos de los trenes que hemos descartado)
let tripsUtiles = new Set(horariosFiltrados.map(h => h.t));
let viajesFiltrados = {};
let limitesFiltrados = {};

for (let tid of tripsUtiles) {
    if (viajesBrutos[tid]) viajesFiltrados[tid] = viajesBrutos[tid];
    if (limitesBrutos[tid]) limitesFiltrados[tid] = limitesBrutos[tid];
}

// 📦 5. EMPAQUETADO DEL ARCHIVO LIGERO
const operativaDiaria = {
    e: estacionesUnificadas,
    h: horariosFiltrados,
    j: viajesFiltrados,
    l: limitesFiltrados
};

// Guardamos el nuevo archivo que consumirá la App
fs.writeFileSync('operativa_diaria.json', JSON.stringify(operativaDiaria));

console.log(`✅ EXTRACCIÓN COMPLETADA.`);
console.log(`📉 Reducción: De ${horariosBrutos.length} a solo ${horariosFiltrados.length} paradas activas.`);
console.log(`🚀 Archivo 'operativa_diaria.json' listo para Turnio.\n`);
