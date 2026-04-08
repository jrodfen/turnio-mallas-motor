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

// ✂️ 3. LA CINTA TRANSPORTADORA (FILTRO BLINDADO)
let horariosFiltrados = horariosBrutos.filter(h => {
    let idTren = String(h.t).toUpperCase();

    // 🛡️ CLÁUSULA RODALIES: Si el ID empieza por R o RT, se queda SÍ O SÍ
    if (idTren.startsWith('R')) return true;

    // 🛡️ CLÁUSULA DÍA DE LA SEMANA: Solo filtramos si detectamos una letra de día (L,M,X,J,V,S,D)
    // Buscamos que empiece por una letra de día seguida de números
    let match = idTren.match(/^([LMXJVSD])\d/);
    
    if (match) {
        let letraTren = match[1];
        // Solo guardamos si coincide con hoy o mañana
        return letraTren === letraHoy || letraTren === letraManana;
    }

    // 🛡️ CLÁUSULA DE SEGURIDAD: Si no tiene letra de día (solo números), lo dejamos pasar
    // para no perder trenes de Cercanías que no sigan el patrón de letras.
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
