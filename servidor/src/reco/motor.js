// GENERADO desde src/reco/servidor.ts — no editar a mano.
// src/library/fuzzy.ts
/**
* Búsqueda tolerante: no hace falta escribir el nombre exacto.
* - Ignora tildes, mayúsculas y signos ("satelite" → "Satélite").
* - Las palabras pueden ir en cualquier orden ("ciudad luces" → "Luces de Ciudad").
* - Basta el comienzo de una palabra ("medi" → "Medianoche").
* - Perdona errores de escritura ("medianoxe", "arecifes", "lusez", "espreso" → "Espresso"),
*   con distancia de edición (Levenshtein, contando también letras cambiadas de lugar).
* - Ignora puntos y espacios dentro de siglas: "nwa" → "N.W.A.", "acdc" → "AC/DC".
*/
function normalize(s) {
	return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
function tokenize(s) {
	const n = normalize(s);
	return n ? n.split(" ") : [];
}
/** Distancia de edición (con transposiciones: "lsua" ≈ "luas"), cortando pronto si supera `max`. */
let filaA = /* @__PURE__ */ new Int32Array(64);
let filaB = /* @__PURE__ */ new Int32Array(64);
let filaC = /* @__PURE__ */ new Int32Array(64);
function editDistance(a, b, max) {
	if (Math.abs(a.length - b.length) > max) return max + 1;
	const n = b.length + 1;
	if (filaA.length < n) {
		filaA = new Int32Array(n * 2);
		filaB = new Int32Array(n * 2);
		filaC = new Int32Array(n * 2);
	}
	let prev2 = filaA;
	let prev = filaB;
	let cur = filaC;
	for (let j = 0; j < n; j++) {
		prev[j] = j;
		prev2[j] = 0;
	}
	for (let i = 1; i <= a.length; i++) {
		cur[0] = i;
		let rowMin = i;
		const ai = a.charCodeAt(i - 1);
		const ai1 = i > 1 ? a.charCodeAt(i - 2) : -1;
		for (let j = 1; j < n; j++) {
			const bj = b.charCodeAt(j - 1);
			const cost = ai === bj ? 0 : 1;
			let v = prev[j] + 1;
			if (cur[j - 1] + 1 < v) v = cur[j - 1] + 1;
			if (prev[j - 1] + cost < v) v = prev[j - 1] + cost;
			if (i > 1 && j > 1 && ai === b.charCodeAt(j - 2) && ai1 === bj && prev2[j - 2] + 1 < v) v = prev2[j - 2] + 1;
			cur[j] = v;
			if (v < rowMin) rowMin = v;
		}
		if (rowMin > max) return max + 1;
		const t = prev2;
		prev2 = prev;
		prev = cur;
		cur = t;
	}
	return prev[n - 1];
}
/** Errores permitidos según el largo de lo que escribiste. */
function allowedTypos(len) {
	return len <= 3 ? 0 : len <= 6 ? 1 : 2;
}
/**
* Cómo "suena" una palabra en español, para perdonar errores de ortografía:
* "lusez" = "luces", "biaje" = "viaje", "kiero" = "quiero", "yuvia" = "lluvia", "ola" = "hola".
*/
function phonetic(w) {
	return w.replace(/ch/g, "x").replace(/h/g, "").replace(/qu/g, "k").replace(/c([ei])/g, "s$1").replace(/c/g, "k").replace(/z/g, "s").replace(/v/g, "b").replace(/w/g, "u").replace(/ll/g, "y").replace(/g([ei])/g, "j$1").replace(/y$/, "i").replace(/(.)\1+/g, "$1");
}
/** Qué tan bien coincide una palabra buscada con una palabra del texto (0 = nada, 1 = perfecto). */
function wordScore(q, w) {
	const exact = spellingScore(q, w);
	if (exact >= .9) return exact;
	const pq = phoneticMemo(q);
	if (q.length < 3 || pq.length < 3) return exact;
	return Math.max(exact, spellingScore(pq, phoneticMemo(w)) * .95);
}
function spellingScore(q, w) {
	if (!q || !w) return 0;
	if (w === q) return 1;
	if (w.startsWith(q)) return .9;
	if (q.length >= 3 && w.includes(q)) return .7;
	const max = allowedTypos(q.length);
	if (max === 0) return 0;
	const full = editDistance(q, w, max);
	const prefix = w.length > q.length ? editDistance(q, w.slice(0, q.length), max) : max + 1;
	const d = Math.min(full, prefix);
	return d <= max ? .6 - d * .15 : 0;
}
/**
* Comparación "todo junto", sin espacios: así "nwa" encuentra "N.W.A." (que queda como "n w a"),
* "acdc" encuentra "AC/DC" y "badbunny" encuentra "Bad Bunny".
*/
function compactScore(qCompact, fCompact) {
	if (qCompact.length < 3 || !fCompact) return 0;
	if (fCompact === qCompact) return 1.2;
	if (fCompact.startsWith(qCompact)) return .95;
	if (qCompact.length >= 5 && fCompact.includes(qCompact)) return .75;
	const max = allowedTypos(qCompact.length);
	if (!max) return 0;
	const d = Math.min(editDistance(qCompact, fCompact, max), fCompact.length > qCompact.length ? editDistance(qCompact, fCompact.slice(0, qCompact.length), max) : max + 1);
	return d <= max ? .6 - d * .15 : 0;
}
/**
* Puntaje de un elemento para una búsqueda. 0 = no coincide.
* Todas las palabras buscadas deben aparecer en algún campo (o la búsqueda entera, junta, en un campo).
*/
/** Los textos de la biblioteca se preparan una sola vez (en el servidor se busca en miles en cada letra). */
const preparados = /* @__PURE__ */ new Map();
function preparar(text) {
	let p = preparados.get(text);
	if (!p) {
		const norm = normalize(text);
		p = {
			words: tokenize(text),
			norm,
			compact: norm.replace(/ /g, "")
		};
		if (preparados.size > 5e4) preparados.clear();
		preparados.set(text, p);
	}
	return p;
}
/**
* Recuerdo de la búsqueda en curso: en miles de canciones se repiten las mismas palabras (el artista, el
* álbum), así que cada comparación palabra-buscada × palabra-del-texto se calcula una sola vez por búsqueda.
*/
let memoQuery = "";
let memoPalabra = /* @__PURE__ */ new Map();
let memoCompacto = /* @__PURE__ */ new Map();
function recordar(query) {
	if (query === memoQuery) return;
	memoQuery = query;
	if (memoPalabra.size > 60) memoPalabra = /* @__PURE__ */ new Map();
	memoCompacto = /* @__PURE__ */ new Map();
}
function wordScoreMemo(m, q, w) {
	let s = m.get(w);
	if (s === void 0) m.set(w, s = wordScore(q, w));
	return s;
}
function memoDe(q) {
	let m = memoPalabra.get(q);
	if (!m) memoPalabra.set(q, m = /* @__PURE__ */ new Map());
	return m;
}
/** El sonido de cada palabra de la biblioteca se calcula una vez (son siempre las mismas). */
const sonidos = /* @__PURE__ */ new Map();
function phoneticMemo(w) {
	let p = sonidos.get(w);
	if (p === void 0) {
		if (sonidos.size > 2e5) sonidos.clear();
		sonidos.set(w, p = phonetic(w));
	}
	return p;
}
function compactScoreMemo(q, f) {
	let s = memoCompacto.get(f);
	if (s === void 0) memoCompacto.set(f, s = compactScore(q, f));
	return s;
}
function fuzzyScore(query, fields) {
	const qWords = tokenize(query);
	if (!qWords.length) return 0;
	recordar(qWords.join(" "));
	const fWords = fields.map((f) => {
		const p = preparar(f.text);
		return {
			words: p.words,
			norm: p.norm,
			compact: p.compact,
			weight: f.weight
		};
	});
	const qCompact = qWords.join("");
	let compact = 0;
	for (const f of fWords) compact = Math.max(compact, compactScoreMemo(qCompact, f.compact) * f.weight);
	let total = 0;
	for (const q of qWords) {
		let best = 0;
		const m = memoDe(q);
		for (const f of fWords) for (const w of f.words) {
			const s = wordScoreMemo(m, q, w) * f.weight;
			if (s > best) best = s;
		}
		if (best === 0) {
			total = -1;
			break;
		}
		total += best;
	}
	let score = total < 0 ? 0 : total / qWords.length;
	score = Math.max(score, compact);
	if (score === 0) return 0;
	const qNorm = qWords.join(" ");
	for (const f of fWords) if (f.norm === qNorm) score += .5 * f.weight;
	else if (f.norm.startsWith(qNorm)) score += .3 * f.weight;
	return score;
}
function anotar(m, k, i) {
	const l = m.get(k);
	if (!l) m.set(k, [i]);
	else if (l[l.length - 1] !== i) l.push(i);
}
function crearIndice(campos) {
	const palabras = /* @__PURE__ */ new Map();
	const compactos = /* @__PURE__ */ new Map();
	campos.forEach((fs, i) => {
		for (const f of fs) {
			const p = preparar(f.text);
			for (const w of p.words) anotar(palabras, w, i);
			if (p.compact) anotar(compactos, p.compact, i);
		}
	});
	const ordenar = (m) => [...m.keys()].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
	return {
		palabras,
		compactos,
		palabrasOrden: ordenar(palabras),
		compactosOrden: ordenar(compactos)
	};
}
/** Cada clave que empieza con `pre`, sacada del arreglo ordenado sin recorrerlo entero. */
function* conPrefijo(orden, pre) {
	let lo = 0;
	let hi = orden.length;
	while (lo < hi) {
		const mid = lo + hi >> 1;
		if (orden[mid] < pre) lo = mid + 1;
		else hi = mid;
	}
	for (let i = lo; i < orden.length && orden[i].startsWith(pre); i++) yield orden[i];
}
/**
* Los elementos que `exactMatch` acepta (ni uno más, ni uno menos), en orden: cada palabra buscada es el
* comienzo de alguna palabra del elemento, o la búsqueda junta es el comienzo de un campo. Sin errores de
* tipeo, así que no calcula distancias: es lo que hace instantáneo al buscador mientras escribes.
*/
function candidatosExactos(ind, query) {
	const qWords = tokenize(query);
	if (!qWords.length) return [];
	let todas = null;
	for (const q of [...new Set(qWords)].sort((a, b) => b.length - a.length)) {
		const con = /* @__PURE__ */ new Set();
		for (const w of conPrefijo(ind.palabrasOrden, q)) for (const i of ind.palabras.get(w)) if (!todas || todas.has(i)) con.add(i);
		todas = con;
		if (!todas.size) break;
	}
	const out = todas ?? /* @__PURE__ */ new Set();
	const qCompact = qWords.join("");
	if (qCompact.length >= 3) for (const c of conPrefijo(ind.compactosOrden, qCompact)) for (const i of ind.compactos.get(c)) out.add(i);
	return [...out].sort((a, b) => a - b);
}
/**
* Los elementos que `fuzzyScore` puntuaría con más de 0 (ni uno más, ni uno menos), en orden. Sigue la misma
* regla: cada palabra buscada coincide con alguna palabra del elemento, o la búsqueda junta coincide con un campo.
*/
function candidatos(ind, query) {
	const qWords = tokenize(query);
	if (!qWords.length) return [];
	recordar(qWords.join(" "));
	let todas = null;
	for (const q of [...new Set(qWords)].sort((a, b) => b.length - a.length)) {
		const m = memoDe(q);
		const con = /* @__PURE__ */ new Set();
		for (const [w, ids] of ind.palabras) {
			if (wordScoreMemo(m, q, w) <= 0) continue;
			if (todas) {
				for (const i of ids) if (todas.has(i)) con.add(i);
			} else for (const i of ids) con.add(i);
		}
		todas = con;
		if (!todas.size) break;
	}
	const out = todas ?? /* @__PURE__ */ new Set();
	const qCompact = qWords.join("");
	if (qCompact.length >= 3) {
		for (const [c, ids] of ind.compactos) if (compactScoreMemo(qCompact, c) > 0) for (const i of ids) out.add(i);
	}
	return [...out].sort((a, b) => a - b);
}
/**
* ¿Coincide SIN adivinar? Cada palabra buscada tiene que estar tal cual (o ser el comienzo de una palabra) en
* algún campo: "abba" coincide con "ABBA" y "abb" con "ABBA", pero no con "Gabba" ni con "Alba".
* También vale todo junto: "acdc" con "AC/DC". Se usa para que, si hay resultados exactos, no se mezclen con
* parecidos; los parecidos (errores de tipeo) solo aparecen cuando no hay ninguno exacto.
*/
function exactMatch(query, fields) {
	const qWords = tokenize(query);
	if (!qWords.length) return false;
	const fs = fields.map((f) => preparar(f.text));
	const qCompact = qWords.join("");
	if (qCompact.length >= 3 && fs.some((f) => f.compact.startsWith(qCompact))) return true;
	return qWords.every((q) => fs.some((f) => f.words.some((w) => w.startsWith(q))));
}
// src/reco/bpm.ts
/** Lleva un tempo a 90–180 BPM (el doble o la mitad cuentan como el mismo pulso). */
function foldBpm(bpm) {
	if (!bpm) return 0;
	while (bpm < 90) bpm *= 2;
	while (bpm >= 180) bpm /= 2;
	return bpm;
}
// src/reco/escenas.ts
const URBANO$1 = [
	"hip hop",
	"rap",
	"trap",
	"pop rap",
	"gangsta rap",
	"reggaeton",
	"urbano latino",
	"latin urban",
	"r&b",
	"contemporary r&b",
	"k pop",
	"kpop"
];
const HOUSE = [
	"house",
	"deep house",
	"french house",
	"tech house",
	"electro house",
	"progressive house"
];
const electronico = (v) => v.electronica >= .4;
const ESCENAS = [
	{
		id: "electronica-actual",
		nombre: "Electrónica actual",
		desde: 2008,
		hasta: 2100,
		sonido: electronico,
		excluye: URBANO$1,
		fuertes: [
			...HOUSE,
			"edm",
			"future bass",
			"big room",
			"big room house",
			"dubstep",
			"brostep",
			"melodic dubstep",
			"tropical house",
			"future house",
			"complextro",
			"bass house",
			"slap house",
			"hardstyle",
			"moombahton",
			"drum and bass",
			"trance",
			"progressive trance",
			"electro"
		],
		apoyo: [
			"electronic",
			"dance",
			"electronica",
			"club dance"
		]
	},
	{
		id: "club-clasico",
		nombre: "Clásicos de club",
		desde: 1988,
		hasta: 2007,
		sonido: electronico,
		excluye: URBANO$1,
		fuertes: [
			...HOUSE,
			"euro house",
			"techno",
			"trance",
			"eurodance",
			"rave",
			"happy hardcore",
			"acid house",
			"big beat",
			"breakbeat",
			"jungle",
			"drum and bass",
			"hardcore techno",
			"gabber",
			"progressive trance",
			"vocal trance",
			"italo dance"
		],
		apoyo: [
			"electronic",
			"dance",
			"electronica",
			"club dance"
		]
	},
	{
		id: "disco",
		nombre: "Disco",
		desde: 1973,
		hasta: 1986,
		sonido: (v) => v.bailable >= .35,
		fuertes: [
			"disco",
			"euro disco",
			"eurodisco",
			"italo disco",
			"post disco",
			"boogie"
		],
		apoyo: [
			"funk",
			"dance",
			"hi nrg"
		]
	},
	{
		id: "synth",
		nombre: "Synth y new wave",
		desde: 1978,
		hasta: 1992,
		fuertes: [
			"synth pop",
			"synthpop",
			"new wave",
			"new romantic",
			"electropop"
		],
		apoyo: [
			"pop",
			"electronic",
			"post punk"
		]
	},
	{
		id: "indie-pop",
		nombre: "Indie y dream pop",
		desde: 2005,
		hasta: 2100,
		excluye: [
			...URBANO$1,
			"dance pop",
			"electropop",
			"teen pop"
		],
		fuertes: [
			"indie pop",
			"dream pop",
			"bedroom pop",
			"indietronica",
			"chillwave",
			"lo fi",
			"indie folk"
		],
		apoyo: [
			"indie",
			"alternative",
			"psychedelic pop"
		]
	},
	{
		id: "indie-rock",
		nombre: "Indie rock",
		desde: 2e3,
		hasta: 2100,
		excluye: [
			...URBANO$1,
			"dream pop",
			"indie pop"
		],
		fuertes: [
			"indie rock",
			"garage rock revival",
			"post punk revival",
			"dance punk",
			"garage rock"
		],
		apoyo: [
			"rock",
			"alternative",
			"indie",
			"alternative rock"
		]
	},
	{
		id: "rock-clasico",
		nombre: "Rock clásico",
		desde: 1960,
		hasta: 1994,
		fuertes: [
			"classic rock",
			"album rock",
			"hard rock",
			"blues rock",
			"progressive rock",
			"arena rock",
			"southern rock",
			"glam rock",
			"art rock",
			"folk rock"
		],
		apoyo: ["rock", "heavy metal"]
	},
	{
		id: "rock-alternativo",
		nombre: "Rock alternativo",
		desde: 1988,
		hasta: 2015,
		excluye: [
			...URBANO$1,
			"dance pop",
			"teen pop",
			"pop"
		],
		fuertes: [
			"alternative rock",
			"grunge",
			"post grunge",
			"britpop",
			"modern rock",
			"pop punk",
			"emo",
			"punk rock",
			"nu metal"
		],
		apoyo: [
			"rock",
			"alternative",
			"alternative metal"
		]
	},
	{
		id: "rock-espanol",
		nombre: "Rock en español",
		desde: 1975,
		hasta: 2100,
		fuertes: [
			"rock en espanol",
			"rock latino",
			"latin rock",
			"rock nacional",
			"rock chileno",
			"rock argentino"
		],
		apoyo: [
			"rock",
			"alternative rock",
			"latin"
		]
	},
	{
		id: "metal",
		nombre: "Metal",
		desde: 1970,
		hasta: 2100,
		fuertes: [
			"heavy metal",
			"thrash metal",
			"death metal",
			"black metal",
			"power metal",
			"metalcore",
			"doom metal",
			"progressive metal",
			"alternative metal",
			"nu metal",
			"speed metal"
		],
		apoyo: ["metal", "hard rock"]
	},
	{
		id: "baladas",
		nombre: "Baladas y soft rock",
		desde: 1970,
		hasta: 2012,
		excluye: [
			"hard rock",
			"heavy metal",
			"dance pop",
			"synth pop",
			"new wave",
			"disco"
		],
		fuertes: [
			"soft rock",
			"ballad",
			"easy listening",
			"yacht rock"
		],
		apoyo: [
			"adult contemporary",
			"pop",
			"pop rock"
		]
	},
	{
		id: "pop-clasico",
		nombre: "Pop 90s y 2000s",
		desde: 1990,
		hasta: 2009,
		excluye: URBANO$1,
		fuertes: [
			"dance pop",
			"teen pop",
			"bubblegum pop",
			"europop"
		],
		apoyo: [
			"pop",
			"pop rock",
			"contemporary pop rock"
		]
	},
	{
		id: "pop-actual",
		nombre: "Pop actual",
		desde: 2010,
		hasta: 2100,
		excluye: URBANO$1,
		fuertes: [
			"dance pop",
			"electropop",
			"teen pop",
			"synth pop",
			"alt pop",
			"art pop",
			"pop rock"
		],
		apoyo: ["pop"]
	},
	{
		id: "hiphop-clasico",
		nombre: "Hip hop clásico",
		desde: 1985,
		hasta: 2005,
		fuertes: [
			"hip hop",
			"rap",
			"golden age hip hop",
			"gangsta rap",
			"east coast hip hop",
			"west coast hip hop",
			"g funk",
			"boom bap",
			"hardcore hip hop"
		],
		apoyo: ["pop rap"]
	},
	{
		id: "hiphop-actual",
		nombre: "Hip hop actual",
		desde: 2006,
		hasta: 2100,
		fuertes: [
			"hip hop",
			"rap",
			"trap",
			"drill",
			"cloud rap",
			"pop rap",
			"southern hip hop",
			"conscious hip hop"
		],
		apoyo: []
	},
	{
		id: "soul",
		nombre: "Soul y funk",
		desde: 1960,
		hasta: 1985,
		fuertes: [
			"soul",
			"funk",
			"motown",
			"northern soul",
			"southern soul",
			"philly soul"
		],
		apoyo: ["r&b"]
	},
	{
		id: "rnb",
		nombre: "R&B",
		desde: 1986,
		hasta: 2100,
		fuertes: [
			"contemporary r&b",
			"r&b",
			"neo soul",
			"new jack swing",
			"alternative r&b",
			"quiet storm"
		],
		apoyo: ["soul", "r&b soul"]
	},
	{
		id: "urbano-latino",
		nombre: "Reggaetón y urbano",
		desde: 2e3,
		hasta: 2100,
		fuertes: [
			"reggaeton",
			"urbano latino",
			"latin urban",
			"dembow",
			"trap latino",
			"latin trap",
			"perreo"
		],
		apoyo: ["latin"]
	},
	{
		id: "pop-latino",
		nombre: "Pop latino",
		desde: 1980,
		hasta: 2100,
		excluye: [
			"reggaeton",
			"urbano latino",
			"latin urban",
			"rock en espanol"
		],
		fuertes: [
			"latin pop",
			"pop latino",
			"pop en espanol",
			"balada",
			"salsa",
			"bachata",
			"merengue",
			"cumbia"
		],
		apoyo: ["latin", "pop"]
	},
	{
		id: "kpop",
		nombre: "K-pop",
		desde: 2e3,
		hasta: 2100,
		fuertes: [
			"k pop",
			"kpop",
			"korean pop",
			"k rap",
			"k r&b"
		],
		apoyo: ["korean", "pop"]
	},
	{
		id: "country",
		nombre: "Country y folk",
		desde: 1960,
		hasta: 2100,
		fuertes: [
			"country",
			"americana",
			"bluegrass",
			"folk",
			"contemporary country",
			"country pop"
		],
		apoyo: []
	},
	{
		id: "jazz",
		nombre: "Jazz y chill",
		desde: 1940,
		hasta: 2100,
		excluye: [
			"rock",
			"hip hop",
			"reggaeton",
			"electronic"
		],
		fuertes: [
			"jazz",
			"smooth jazz",
			"vocal jazz",
			"jazz fusion",
			"bossa nova"
		],
		apoyo: [
			"lounge",
			"chill",
			"downtempo",
			"trip hop"
		]
	}
];
const tag = (s) => s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[-_/]+/g, " ").replace(/\s+/g, " ").trim();
const artistaPrincipal$1 = (a) => tag(a.split(/,|\s+(?:feat\.?|ft\.?|con|with|&|y|x)\s+/i)[0] ?? a);
const PREPARADAS = ESCENAS.map((e) => ({
	e,
	fuertes: new Set(e.fuertes),
	apoyo: new Set(e.apoyo),
	excluye: new Set(e.excluye ?? [])
}));
/** Correcciones por artista, para cuando sus etiquetas públicas no describen bien su música. */
const CORRECCIONES = {
	"melanie martinez": "pop-actual",
	airbag: "rock-espanol",
	"chancho en piedra": "rock-espanol",
	"beach house": "indie-pop",
	"wonder girls": "kpop",
	"eddy grant": ""
};
const MARGEN = 1.25;
const IDENTIDAD_ARTISTA = .35;
const EXCLUSION_ARTISTA = .3;
/** Una escena debe ser al menos esta parte de lo clasificado del artista: evita canciones sueltas fuera de lugar. */
const COHERENCIA_ARTISTA = .2;
const REEDICION = 15;
/** A qué escena pertenece cada canción del catálogo (las dudosas no aparecen). */
function clasificarEscenas(tracks) {
	const artistas = /* @__PURE__ */ new Map();
	const tagsDe = /* @__PURE__ */ new Map();
	for (const t of tracks) {
		const tags = [...new Set(t.genres.map(tag))];
		tagsDe.set(t.id, tags);
		const k = artistaPrincipal$1(t.artist);
		const a = artistas.get(k) ?? {
			n: 0,
			tags: /* @__PURE__ */ new Map(),
			fuertes: /* @__PURE__ */ new Map(),
			anios: []
		};
		a.n++;
		if (t.year) a.anios.push(t.year);
		for (const g of tags) a.tags.set(g, (a.tags.get(g) ?? 0) + 1);
		for (const p of PREPARADAS) if (tags.some((g) => p.fuertes.has(g))) a.fuertes.set(p.e.id, (a.fuertes.get(p.e.id) ?? 0) + 1);
		artistas.set(k, a);
	}
	const out = /* @__PURE__ */ new Map();
	for (const t of tracks) {
		if (t.categorias?.length || t.contexto?.length || !t.year) continue;
		const tags = tagsDe.get(t.id);
		const a = artistas.get(artistaPrincipal$1(t.artist));
		const parte = (g) => (a.tags.get(g) ?? 0) / a.n;
		const anios = [...a.anios].sort((x, y) => x - y);
		const habitual = anios[anios.length >> 1];
		const anio = a.n >= 5 && t.year - habitual > REEDICION ? habitual : t.year;
		const corregida = CORRECCIONES[artistaPrincipal$1(t.artist)];
		if (corregida !== void 0) {
			const e = ESCENAS.find((x) => x.id === corregida);
			if (e && anio >= e.desde && anio <= e.hasta) out.set(t.id, e);
			continue;
		}
		const opciones = [];
		for (const p of PREPARADAS) {
			if (anio < p.e.desde || anio > p.e.hasta) continue;
			if (tags.some((g) => p.excluye.has(g))) continue;
			if ([...p.excluye].some((g) => parte(g) >= EXCLUSION_ARTISTA)) continue;
			if (t.vibe && p.e.sonido && !p.e.sonido(t.vibe)) continue;
			const identidad = (a.fuertes.get(p.e.id) ?? 0) / a.n;
			if (!tags.some((g) => p.fuertes.has(g)) && identidad < IDENTIDAD_ARTISTA) continue;
			const puntos = tags.reduce((x, g) => x + (p.fuertes.has(g) ? 3 : p.apoyo.has(g) ? 1 : 0), 0) + 3 * identidad;
			opciones.push([p, puntos]);
		}
		opciones.sort((x, y) => y[1] - x[1]);
		const [uno, dos] = opciones;
		if (uno && (!dos || uno[1] >= MARGEN * dos[1])) out.set(t.id, uno[0].e);
	}
	const cuenta = /* @__PURE__ */ new Map();
	const artistaDe = new Map(tracks.map((t) => [t.id, artistaPrincipal$1(t.artist)]));
	for (const [id, e] of out) {
		const k = artistaDe.get(id);
		const m = cuenta.get(k) ?? /* @__PURE__ */ new Map();
		m.set(e.id, (m.get(e.id) ?? 0) + 1);
		cuenta.set(k, m);
	}
	for (const [id, e] of [...out]) {
		const m = cuenta.get(artistaDe.get(id));
		const total = [...m.values()].reduce((x, y) => x + y, 0);
		if (total >= 4 && m.get(e.id) / total < COHERENCIA_ARTISTA) out.delete(id);
	}
	return out;
}
// src/reco/engine.ts
const ESCENAS_POR_NOMBRE = new Map(ESCENAS.map((e) => [e.nombre, e]));
const MOODS = [
	{
		id: "trending",
		label: "Tendencia"
	},
	{
		id: "activate",
		label: "Actívate"
	},
	{
		id: "relax",
		label: "Relajación"
	},
	{
		id: "feelgood",
		label: "Para sentirte bien"
	},
	{
		id: "romance",
		label: "Romance"
	},
	{
		id: "sad",
		label: "Triste"
	},
	{
		id: "party",
		label: "Fiesta"
	},
	{
		id: "workout",
		label: "Entrenamiento"
	},
	{
		id: "focus",
		label: "Concentración"
	},
	{
		id: "sleep",
		label: "Sueño"
	}
];
const DAY = 864e5;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const GENRE_GROUPS = {
	energetic: [
		"rock",
		"metal",
		"punk",
		"edm",
		"electronic",
		"electro",
		"hip hop",
		"hip-hop",
		"rap",
		"trap",
		"reggaeton",
		"drum and bass",
		"dubstep",
		"hard",
		"grunge"
	],
	workout: [
		"edm",
		"hip hop",
		"hip-hop",
		"rap",
		"trap",
		"metal",
		"rock",
		"reggaeton",
		"dance",
		"electro",
		"house",
		"drum and bass",
		"dubstep"
	],
	party: [
		"dance",
		"pop",
		"latin",
		"reggaeton",
		"house",
		"disco",
		"funk",
		"hip hop",
		"hip-hop",
		"electropop",
		"k-pop",
		"dancehall",
		"cumbia",
		"salsa",
		"merengue",
		"bachata"
	],
	calm: [
		"acoustic",
		"ambient",
		"chill",
		"jazz",
		"soul",
		"r&b",
		"rnb",
		"folk",
		"lofi",
		"lo-fi",
		"bossa",
		"ballad",
		"singer-songwriter",
		"downtempo",
		"trip hop",
		"classical"
	],
	focus: [
		"ambient",
		"classical",
		"instrumental",
		"lofi",
		"lo-fi",
		"jazz",
		"piano",
		"soundtrack",
		"post-rock",
		"downtempo",
		"chillout",
		"new age"
	],
	happy: [
		"pop",
		"funk",
		"disco",
		"soul",
		"motown",
		"k-pop",
		"dance-pop",
		"electropop",
		"reggae",
		"latin",
		"new jack swing"
	],
	romance: [
		"r&b",
		"rnb",
		"soul",
		"neo-soul",
		"quiet storm",
		"slow jam",
		"ballad",
		"bolero",
		"bachata",
		"soft rock",
		"adult contemporary",
		"smooth",
		"love"
	],
	sad: [
		"sad",
		"emo",
		"blues",
		"ballad",
		"singer-songwriter",
		"slowcore",
		"melanchol",
		"dream pop",
		"shoegaze",
		"downtempo",
		"trip hop"
	],
	sleep: [
		"ambient",
		"new age",
		"piano",
		"lullaby",
		"classical",
		"downtempo",
		"acoustic",
		"meditation",
		"chillout",
		"lo-fi",
		"lofi"
	]
};
/** Palabras del título que delatan el tema de la canción (en inglés y español). */
const TITLE_WORDS = {
	romance: /(?<!\p{L})(love|lover|kiss|heart|baby|darling|honey|amor|beso|besos|corazón|corazon|cariño|enamora|te quiero|mi vida|smile)(?!\p{L})/iu,
	sad: /(?<!\p{L})(cry|crying|tears|alone|lonely|goodbye|sad|miss|missing|lost|broken|sorry|hurt|without you|llorar|lágrimas|triste|soledad|adiós|adios|sin ti|dolor|olvidar|perdí)(?!\p{L})/iu
};
const titleScore = (t, k) => TITLE_WORDS[k].test(t.title) ? 1 : 0;
function genreScore(t, group) {
	const words = GENRE_GROUPS[group];
	return t.genres.map((x) => x.toLowerCase()).some((x) => words.some((w) => x.includes(w))) ? 1 : 0;
}
function percentile(values) {
	const sorted = [...values].sort((a, b) => a - b);
	return (v) => {
		if (sorted.length < 2) return .5;
		let lo = 0;
		let hi = sorted.length;
		while (lo < hi) {
			const mid = lo + hi >> 1;
			if (sorted[mid] < v) lo = mid + 1;
			else hi = mid;
		}
		return lo / (sorted.length - 1);
	};
}
/** Ruido estable por día: los empates cambian de un día a otro, pero no cada vez que abres la app. */
function dailyNoise(id, now) {
	let h = 2166136261 ^ Math.floor(now / DAY);
	for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
	return (h >>> 0) % 1e3 / 1e3;
}
function buildModel(input) {
	const { tracks, plays, ratings, features, billboard, now } = input;
	const byId = new Map(tracks.map((t) => [t.id, t]));
	const stats = /* @__PURE__ */ new Map();
	const transitions = /* @__PURE__ */ new Map();
	const saltosTras = /* @__PURE__ */ new Map();
	const hourHist = /* @__PURE__ */ new Map();
	const nowHour = new Date(now).getHours();
	for (const p of plays) {
		const s = stats.get(p.trackId) ?? {
			plays: 0,
			completes: 0,
			skips: 0,
			recentCompletes: 0,
			lastPlayed: 0
		};
		const w = Math.min(1, (p.duration || 0) / 60);
		s.plays += Math.max(w, p.skipped ? 1 : 0);
		if (p.completed) s.completes += w;
		if (p.skipped) s.skips++;
		if (p.completed && now - p.startedAt < 30 * DAY) s.recentCompletes += w;
		s.lastPlayed = Math.max(s.lastPlayed, p.startedAt);
		stats.set(p.trackId, s);
		if (p.prevTrackId && !p.skipped) {
			const k = `${p.prevTrackId}>${p.trackId}`;
			transitions.set(k, (transitions.get(k) ?? 0) + 1);
		}
		if (p.prevTrackId && p.skipped) {
			const k = `${p.prevTrackId}>${p.trackId}`;
			saltosTras.set(k, (saltosTras.get(k) ?? 0) + 1);
		}
		const t = byId.get(p.trackId);
		if (t && !p.skipped) {
			const h = hourHist.get(t.artist) ?? new Array(24).fill(0);
			h[new Date(p.startedAt).getHours()]++;
			hourHist.set(t.artist, h);
		}
	}
	const own = /* @__PURE__ */ new Map();
	for (const t of tracks) {
		const s = stats.get(t.id);
		let a = 0;
		if (s) {
			a += .8 * Math.log1p(s.completes) + .4 * Math.log1p(s.recentCompletes) - .7 * Math.log1p(s.skips);
			if (s.plays) a += .6 * (s.completes / s.plays - .5);
		}
		if (ratings[t.id] === 1) a += 2.5;
		if (ratings[t.id] === -1) a -= 5;
		own.set(t.id, a);
	}
	const groupAff = (keyOf) => {
		const sum = /* @__PURE__ */ new Map();
		const n = /* @__PURE__ */ new Map();
		for (const t of tracks) {
			const a = own.get(t.id) ?? 0;
			if (!a) continue;
			for (const k of keyOf(t)) {
				sum.set(k, (sum.get(k) ?? 0) + a);
				n.set(k, (n.get(k) ?? 0) + 1);
			}
		}
		const out = /* @__PURE__ */ new Map();
		for (const [k, v] of sum) out.set(k, v / ((n.get(k) ?? 0) + 2));
		return out;
	};
	const artistAff = groupAff((t) => [normalize(t.artist)]);
	const genreAff = groupAff((t) => t.genres.map((g) => g.toLowerCase()));
	const baseAffinity = /* @__PURE__ */ new Map();
	const affinity = /* @__PURE__ */ new Map();
	for (const t of tracks) {
		let a = own.get(t.id) ?? 0;
		a += .6 * (artistAff.get(normalize(t.artist)) ?? 0);
		const gs = t.genres.map((g) => genreAff.get(g.toLowerCase()) ?? 0);
		if (gs.length) a += .3 * Math.max(...gs);
		const h = hourHist.get(t.artist);
		if (h) {
			const total = h.reduce((x, y) => x + y, 0);
			let near = 0;
			for (let d = -2; d <= 2; d++) near += h[(nowHour + d + 24) % 24];
			if (total >= 3) a += .5 * (near / total - 5 / 24);
		}
		const rank = billboard.get(t.id);
		if (rank) a += .6 * (1 - (rank - 1) / 100);
		if (!stats.get(t.id)) a += .2;
		a += .25 * dailyNoise(t.id, now);
		baseAffinity.set(t.id, a);
		const last = stats.get(t.id)?.lastPlayed ?? 0;
		affinity.set(t.id, a - (now - last < 108e5 ? 1.2 : 0));
	}
	const usable = tracks.map((t) => features.get(t.id)).filter((f) => !!f && !f.silent && !f.failed);
	const pE = percentile(usable.map((f) => f.energy));
	const pA = percentile(usable.map((f) => f.activity));
	const pB = percentile(usable.map((f) => f.beat));
	const pZ = percentile(usable.map((f) => f.brightness));
	const pD = percentile(usable.map((f) => f.dynamics));
	const sound = /* @__PURE__ */ new Map();
	for (const t of tracks) {
		const f = features.get(t.id);
		if (!f || f.silent || f.failed) continue;
		const bpm = foldBpm(f.bpm);
		sound.set(t.id, {
			energy: pE(f.energy),
			activity: pA(f.activity),
			beat: pB(f.beat),
			brightness: pZ(f.brightness),
			dynamics: pD(f.dynamics),
			fast: clamp01((bpm - 95) / 70),
			dance: clamp01(1 - Math.abs(bpm - 123) / 28)
		});
	}
	const mood = {};
	for (const m of MOODS) mood[m.id] = /* @__PURE__ */ new Map();
	for (const t of tracks) {
		const v = sound.get(t.id);
		const E = v?.energy ?? .5;
		const A = v?.activity ?? .5;
		const B = v?.beat ?? .5;
		const Z = v?.brightness ?? .5;
		const D = v?.dynamics ?? .5;
		const F = v?.fast ?? .5;
		const DN = v?.dance ?? .5;
		const liked = ratings[t.id] === 1 ? 1 : 0;
		mood.activate.set(t.id, .35 * E + .3 * A + .15 * F + .1 * B + .1 * Z + .2 * genreScore(t, "energetic"));
		mood.workout.set(t.id, .3 * E + .3 * A + .2 * F + .2 * B + .2 * genreScore(t, "workout"));
		mood.party.set(t.id, .3 * DN + .25 * B + .2 * E + .15 * A + .1 * Z + .25 * genreScore(t, "party"));
		mood.relax.set(t.id, .35 * (1 - E) + .3 * (1 - A) + .15 * (1 - B) + .1 * (1 - Z) + .1 * (1 - F) + .25 * genreScore(t, "calm"));
		mood.focus.set(t.id, .3 * (1 - A) + .25 * (1 - E) + .2 * (1 - D) + .1 * (1 - Z) + .15 * (1 - B) + .35 * genreScore(t, "focus"));
		const rank = billboard.get(t.id);
		if (rank) mood.trending.set(t.id, 1 - (rank - 1) / 100);
		mood.feelgood.set(t.id, .25 * E + .2 * Z + .25 * DN + .1 * A + .15 * liked + .25 * genreScore(t, "happy"));
		const mid = 1 - Math.abs(E - .45) * 2;
		mood.romance.set(t.id, .2 * (1 - F) + .15 * mid + .1 * (1 - A) + .35 * genreScore(t, "romance") + .25 * titleScore(t, "romance") + .1 * liked);
		mood.sad.set(t.id, .2 * (1 - E) + .15 * (1 - Z) + .15 * (1 - F) + .1 * (1 - B) + .1 * (1 - DN) + .3 * genreScore(t, "sad") + .3 * titleScore(t, "sad") - .15 * genreScore(t, "party"));
		mood.sleep.set(t.id, .3 * (1 - E) + .25 * (1 - A) + .2 * (1 - B) + .1 * (1 - Z) + .15 * (1 - F) + .3 * genreScore(t, "sleep") - .3 * genreScore(t, "energetic"));
		const vb = t.vibe;
		if (vb) {
			const mezclar = (k, x) => mood[k].set(t.id, .5 * (mood[k].get(t.id) ?? 0) + .7 * x);
			mezclar("activate", .4 * vb.agresiva + .3 * vb.bailable + .3 * vb.fiesta);
			mezclar("workout", .4 * vb.agresiva + .3 * vb.bailable + .3 * vb.fiesta);
			mezclar("party", .5 * vb.fiesta + .5 * vb.bailable);
			mezclar("relax", vb.relajada * (1 - vb.agresiva));
			mezclar("focus", .5 * vb.instrumental + .5 * vb.relajada);
			mezclar("feelgood", .7 * vb.feliz + .3 * vb.bailable);
			mezclar("sad", vb.triste * (1 - .5 * vb.fiesta));
			mezclar("sleep", vb.relajada * (1 - vb.bailable) * (1 - vb.agresiva));
		}
	}
	return {
		input,
		byId,
		stats,
		baseAffinity,
		affinity,
		sound,
		mood,
		transitions,
		saltosTras
	};
}
/** Silencio (archivos de prueba) o demasiado corta para recomendarla (intros, skits). */
const isTestSilence = (m, id) => m.input.features.get(id)?.silent === true || (m.byId.get(id)?.duration ?? 0) < 20;
const catsDe = (t) => t?.categorias ?? [];
/** El "mundo" de una canción para la radio y las recomendaciones: su categoría confirmada o la probable. */
const mundoDe = (t) => t?.categorias?.length ? t.categorias : t?.contexto ?? [];
/**
* Categorías que ya son "tuyas": las de canciones que escuchaste de verdad o te gustaron. Una canción de una
* categoría que no escuchas nunca aparece como descubrimiento ni en los mixes (al que no escucha memes no le
* llegan memes); si ya escuchas anime, el anime sí puede aparecer.
*/
const catsCache = /* @__PURE__ */ new WeakMap();
function categoriasTuyas(m) {
	let s = catsCache.get(m);
	if (!s) {
		s = /* @__PURE__ */ new Set();
		for (const id of heardIds(m)) for (const c of mundoDe(m.byId.get(id))) s.add(c);
		catsCache.set(m, s);
	}
	return s;
}
/** ¿Esta canción puede aparecer como recomendación para este usuario? (sin categoría, o de una que ya escucha) */
const categoriaPermitida = (m, t) => mundoDe(t).every((c) => categoriasTuyas(m).has(c));
/** Ordena evitando que un mismo artista acapare la lista (máximo `perArtist` por artista). */
function diverse(m, ids, n, perArtist = 2) {
	const count = /* @__PURE__ */ new Map();
	const out = [];
	const spill = [];
	for (const id of ids) {
		const t = m.byId.get(id);
		if (!t) continue;
		const k = normalize(t.artist);
		const c = count.get(k) ?? 0;
		if (c >= perArtist) {
			spill.push(id);
			continue;
		}
		count.set(k, c + 1);
		out.push(id);
		if (out.length >= n) return out;
	}
	return [...out, ...spill].slice(0, n);
}
/**
* Lo que es "tuyo": canciones que escuchaste de verdad (al menos media canción terminada) o con "me gusta",
* sin las marcadas "no me gusta". Con esto se arma el feed y el aleatorio, no con todo el servidor.
*/
function heardIds(m) {
	const out = [];
	for (const t of m.input.tracks) {
		if (m.input.ratings[t.id] === -1 || isTestSilence(m, t.id)) continue;
		const s = m.stats.get(t.id);
		if (m.input.ratings[t.id] === 1 || s && s.completes >= .5) out.push(t.id);
	}
	return out;
}
/** Con menos de esto, el usuario todavía es "nuevo": el feed es el Billboard y no hay "Tus álbumes/artistas". */
const MIN_HEARD = 5;
/** Canciones del Hot 100 de esta semana que están en el servidor, en el orden del chart. */
function billboardIds(m) {
	return [...m.input.billboard.entries()].filter(([id]) => m.byId.has(id) && m.input.ratings[id] !== -1 && !isTestSilence(m, id)).sort((a, b) => a[1] - b[1]).map(([id]) => id);
}
/**
* Descubrimientos: canciones que NUNCA escuchaste, de tu estilo y parecidas a lo que más escuchas. Una canción
* recién subida al servidor solo aparece si se parece a lo tuyo (ser nueva no le da ningún puesto).
*/
function discoveries(m, mine, n, exclude) {
	if (n <= 0 || !mine.length) return [];
	const seeds = mine.slice(0, 12).map((id) => m.byId.get(id));
	const colab = colabDe(m);
	const yt = ytmTuyo(m);
	const scored = [];
	for (const t of m.input.tracks) {
		if (exclude.has(t.id) || m.stats.has(t.id) || m.input.ratings[t.id] !== void 0 || isTestSilence(m, t.id)) continue;
		if (!categoriaPermitida(m, t)) continue;
		const fit = styleFit(m, t);
		const y = yt.get(t.id) ?? 0;
		if (fit !== null && fit < .5 && y < .5) continue;
		let sim = 0;
		for (const s of seeds) sim = Math.max(sim, similarity(m, s, t));
		scored.push([t.id, sim + .3 * (fit ?? 0) + .45 * (colab.get(t.id) ?? 0) + .6 * y + .12 * (t.exito?.valor ?? 0) + .15 * dailyNoise(t.id, m.input.now)]);
	}
	scored.sort((a, b) => b[1] - a[1]);
	return diverse(m, scored.slice(0, 40).map(([id]) => id), n, 1);
}
/**
* Accesos directos (el feed principal):
*  - Usuario nuevo (casi sin escuchas): lo que lleve escuchado + el Billboard Hot 100. Nada más.
*  - Con historial: casi todo es música que TÚ escuchas (ordenada por lo que más te gusta ahora) y solo 2 o 3
*    son descubrimientos parecidos que no has oído, repartidos entre las tuyas.
*/
function shortcuts(m, n) {
	const byAff = (ids) => [...ids].sort((a, b) => (m.affinity.get(b) ?? 0) - (m.affinity.get(a) ?? 0));
	const mine = byAff(heardIds(m));
	const chart = billboardIds(m);
	if (mine.length < 5) {
		const seen = new Set(mine);
		const yt = [...ytmTuyo(m).entries()].filter(([id]) => !seen.has(id) && m.input.ratings[id] !== -1 && !isTestSilence(m, id) && categoriaPermitida(m, m.byId.get(id))).sort((a, b) => b[1] - a[1]).map(([id]) => id);
		const conYt = [...mine, ...diverse(m, yt, Math.min(8, n - mine.length), 1)];
		const vistas = new Set(conYt);
		return [...conYt, ...diverse(m, chart.filter((id) => !vistas.has(id)), n - conYt.length, 2)].slice(0, n);
	}
	const k = (mine.length >= 15 ? 3 : 2) + (ytmTuyo(m).size ? 1 : 0);
	const own = diverse(m, mine, n - k, 3);
	const used = new Set(own);
	const nuevas = discoveries(m, mine, k, used);
	const relleno = own.length + nuevas.length < n ? chart.filter((id) => !used.has(id) && !nuevas.includes(id)) : [];
	const out = [...own];
	[
		3,
		10,
		18,
		23
	].slice(0, nuevas.length).forEach((pos, i) => out.splice(Math.min(pos, out.length), 0, nuevas[i]));
	return [...out, ...relleno].slice(0, n);
}
/** Aleatorio del feed: tu música (escuchada, "me gusta" y `extra` = tus playlists). Usuario nuevo: el Billboard. */
function shufflePool(m, extra = []) {
	const set = /* @__PURE__ */ new Set([...heardIds(m), ...extra.filter((id) => m.byId.has(id) && m.input.ratings[id] !== -1)]);
	return set.size >= 5 ? [...set] : [.../* @__PURE__ */ new Set([...set, ...billboardIds(m)])];
}
/** Mix de un ánimo: encaja con el ánimo y además te gusta. */
function moodMix(m, mood, n) {
	if (mood === "trending") return diverse(m, [...m.mood.trending.entries()].filter(([id]) => m.input.ratings[id] !== -1 && !isTestSilence(m, id)).sort((a, b) => b[1] - a[1]).map(([id]) => id), n, 3);
	const aff = [...m.affinity.values()];
	const lo = Math.min(...aff);
	const hi = Math.max(...aff);
	const norm = (v) => hi > lo ? (v - lo) / (hi - lo) : .5;
	const fam = tasteShares(m);
	const style = (id) => styleFit(m, m.byId.get(id));
	return diverse(m, [...m.mood[mood].entries()].filter(([id]) => m.input.ratings[id] !== -1 && !isTestSilence(m, id) && categoriaPermitida(m, m.byId.get(id))).map(([id, v]) => {
		const s = style(id);
		if (s === null) return [id, .65 * v + .35 * norm(m.affinity.get(id) ?? 0) - (fam ? .15 : 0)];
		return [id, .45 * v + .3 * s + .25 * norm(m.affinity.get(id) ?? 0) - (s < .25 ? .35 : 0)];
	}).sort((a, b) => b[1] - a[1]).map(([id]) => id), n, 3);
}
/**
* Tus estilos: qué parte de lo que escuchas es de cada familia (rock, baladas, reggaetón…), según TODO tu
* historial (canciones terminadas y "me gusta"). null si todavía no hay historial.
*
* Cada usuario puede tener varios estilos: alguien que escucha 70 % rock y 30 % baladas tiene los dos.
*/
const tasteCache = /* @__PURE__ */ new WeakMap();
function tasteShares(m) {
	if (!tasteCache.has(m)) {
		let acc = null;
		for (const t of m.input.tracks) {
			const w = (m.stats.get(t.id)?.completes ?? 0) + (m.input.ratings[t.id] === 1 ? 2 : 0);
			if (w <= 0) continue;
			const f = familiesOf(m, t);
			if (!f) continue;
			const sum = f.reduce((a, b) => a + b, 0) || 1;
			acc ??= f.map(() => 0);
			f.forEach((x, i) => acc[i] += w * x / sum);
		}
		const total = acc?.reduce((a, b) => a + b, 0) ?? 0;
		tasteCache.set(m, acc && total > 0 ? acc.map((x) => x / total) : null);
	}
	return tasteCache.get(m);
}
/** Un estilo que es al menos el 15 % de lo que escuchas cuenta como "tuyo". */
const OWN_SHARE = .15;
/**
* Qué tan de "tus estilos" es una canción (0–1). Una balada es 1 para quien escucha baladas aunque sean la
* minoría de lo suyo, y 0 para quien nunca escucha baladas. null = no se sabe (sin historial o sin géneros).
*/
function styleFit(m, t) {
	const shares = tasteShares(m);
	if (!shares) return null;
	const f = familiesOf(m, t);
	if (!f) return null;
	const sum = f.reduce((a, b) => a + b, 0) || 1;
	let fit = 0;
	f.forEach((x, i) => fit += x / sum * Math.min(1, shares[i] / OWN_SHARE));
	return fit;
}
/**
* Puntaje personal de un grupo de canciones (un álbum o un artista) para "Tus álbumes" y "Tus artistas":
* primero lo que escuchas de verdad, después lo que encaja con tus gustos (artista, género). Así, con la
* biblioteca compartida del servidor, no aparece primero un álbum solo por empezar con "A".
*/
function groupScore(m, trackIds) {
	let best = -Infinity;
	let listened = 0;
	let disliked = 0;
	for (const id of trackIds) {
		best = Math.max(best, m.baseAffinity.get(id) ?? 0);
		const s = m.stats.get(id);
		if (s) listened += s.completes + .3 * (s.plays - s.skips);
		if (m.input.ratings[id] === -1) disliked++;
	}
	if (!trackIds.length) return -Infinity;
	const t = m.byId.get(trackIds[0]);
	const fit = (t && styleFit(m, t)) ?? 0;
	return best + .6 * Math.log1p(Math.max(0, listened)) + .4 * fit - (disliked === trackIds.length ? 2 : 0);
}
/** Redescubre: canciones que te gustaban (completas varias veces o con "me gusta") y no suenan hace 3 semanas. */
function rediscover(m, n) {
	return diverse(m, [...m.stats.entries()].filter(([id, s]) => (s.completes >= 2 || m.input.ratings[id] === 1) && m.input.ratings[id] !== -1 && !isTestSilence(m, id) && m.input.now - s.lastPlayed > 21 * DAY).sort((a, b) => (m.baseAffinity.get(b[0]) ?? 0) - (m.baseAffinity.get(a[0]) ?? 0)).map(([id]) => id), n);
}
const MIX_MIN = 12;
/** ¿El género `g` es `termino`? Palabra completa: "pop" calza con "pop" y "dance pop", no con "popular". */
const generoEs = (g, termino) => {
	const t = termino.trim().toLowerCase();
	if (!t) return false;
	const i = g.indexOf(t);
	if (i < 0) return false;
	const antes = i === 0 || !/[a-z0-9áéíóúñ]/.test(g[i - 1]);
	const despues = i + t.length === g.length || !/[a-z0-9áéíóúñ]/.test(g[i + t.length]);
	return antes && despues;
};
/** ¿La canción cumple las reglas automáticas del mix? (un mix sin reglas solo lleva sus canciones fijas) */
function entraEnMix(d, t) {
	if (!!!(d.anioDesde || d.anioHasta || d.generos.length || d.sinGeneros.length || d.categoria)) return false;
	const cats = catsDe(t);
	if (d.categoria ? !cats.includes(d.categoria) : cats.length) return false;
	if (d.anioDesde || d.anioHasta) {
		if (!t.year) return false;
		if (d.anioDesde && t.year < d.anioDesde) return false;
		if (d.anioHasta && t.year > d.anioHasta) return false;
	}
	const g = t.genres.map((x) => x.toLowerCase());
	if (d.generos.length && !g.some((x) => d.generos.some((y) => generoEs(x, y)))) return false;
	if (d.sinGeneros.length && g.some((x) => d.sinGeneros.some((y) => generoEs(x, y)))) return false;
	return true;
}
/**
* Los mixes "Para ti", ordenados por lo que más escuchas (si escuchas muchos 2000, Essential 2000's va primero;
* sin historial, en el orden del panel). Cada uno: primero sus canciones fijas (en su orden), después las
* externas, y lo demás según las reglas: lo que más va contigo y lo más conocido, con algo nuevo cada día.
*/
function mixesParaTi(m, defs, semilla = String(Math.floor(m.input.now / DAY))) {
	const norm = normAfinidad(m);
	const { pesos, total } = pesosDeEscucha(m);
	const propias = defs.map((d) => /* @__PURE__ */ new Set([...d.fijas, ...d.externas ?? []]));
	const escuchado = /* @__PURE__ */ new Map();
	for (const [id, p] of pesos) {
		const t = m.byId.get(id);
		defs.forEach((d, i) => {
			if (propias[i].has(id) || entraEnMix(d, t)) escuchado.set(d.id, (escuchado.get(d.id) ?? 0) + p);
		});
	}
	const out = [];
	defs.forEach((d, orden) => {
		const azar = azarDe(`${semilla}:${d.id}`);
		const n = Math.max(1, Math.min(500, d.tamano || 50));
		const primero = [.../* @__PURE__ */ new Set([...d.fijas, ...d.externas ?? []])].filter((id) => m.byId.has(id) && m.input.ratings[id] !== -1);
		const ya = new Set(primero);
		const scored = [];
		for (const t of m.input.tracks) {
			if (ya.has(t.id) || m.input.ratings[t.id] === -1 || isTestSilence(m, t.id) || !entraEnMix(d, t)) continue;
			scored.push([t.id, .45 * norm(m.baseAffinity.get(t.id) ?? 0) + .5 * popDe(m, t) + .04 * (t.exito?.valor ?? 0) + .3 * azar() - raroDe(t)]);
		}
		scored.sort((a, b) => b[1] - a[1]);
		const largo = Math.max(n, primero.length);
		const resto = barajarSuave(diverse(m, scored.map(([id]) => id), largo, 2), azar);
		const ids = [...primero, ...resto].slice(0, largo);
		if (ids.length < Math.min(MIX_MIN, n)) return;
		out.push({
			id: d.id,
			titulo: d.titulo,
			portada: d.portada ?? null,
			tuyo: total ? (escuchado.get(d.id) ?? 0) / total : 0,
			ids,
			orden
		});
	});
	return out.sort((a, b) => b.tuyo - a.tuyo || a.orden - b.orden).map(({ orden: _o, ...x }) => x);
}
/** Afinidad llevada a 0–1 (para mezclarla con popularidad y azar). */
function normAfinidad(m) {
	const aff = [...m.baseAffinity.values()];
	const lo = aff.length ? Math.min(...aff) : 0;
	const hi = aff.length ? Math.max(...aff) : 0;
	return (v) => hi > lo ? (v - lo) / (hi - lo) : .5;
}
/** Qué tan conocida es: popularidad en el servidor, el Billboard de esta semana o haber estado en el Hot 100. */
function popDe(m, t) {
	const enHot100 = t.genres.some((g) => /billboard|hot 100/i.test(g));
	return Math.max(t.pop ?? .25, m.input.billboard.has(t.id) ? .9 : 0, enHot100 ? .8 : 0);
}
/** Megamixes, karaoke y rarezas quedan abajo. */
const raroDe = (t) => /megamix|medley|\bmix\b|karaoke|christmas|navidad|instrumental/i.test(`${t.title} ${t.album}`) ? .3 : 0;
/** Cambia el orden sin perder del todo el de antes: lo de arriba tiende a seguir arriba. */
function barajarSuave(ids, azar) {
	return ids.map((id, i) => [id, i / Math.max(1, ids.length) + .6 * azar()]).sort((a, b) => a[1] - b[1]).map(([id]) => id);
}
/**
* Cuánto pesa cada canción en lo que escuchas: las terminadas (más si fueron este mes) y los "me gusta" suman;
* los saltos restan. Las de "no me gusta" no cuentan. Sirve para saber qué estilos son de verdad tuyos.
*/
const pesoCache = /* @__PURE__ */ new WeakMap();
function pesosDeEscucha(m) {
	let x = pesoCache.get(m);
	if (!x) {
		const pesos = /* @__PURE__ */ new Map();
		let total = 0;
		for (const id of /* @__PURE__ */ new Set([...m.stats.keys(), ...Object.keys(m.input.ratings)])) {
			if (m.input.ratings[id] === -1 || !m.byId.has(id) || isTestSilence(m, id)) continue;
			const s = m.stats.get(id);
			const p = Math.max(0, (s?.completes ?? 0) + .5 * (s?.recentCompletes ?? 0) - .4 * (s?.skips ?? 0)) + (m.input.ratings[id] === 1 ? 2 : 0);
			if (p <= 0) continue;
			pesos.set(id, p);
			total += p;
		}
		pesoCache.set(m, x = {
			pesos,
			total
		});
	}
	return x;
}
/** Cuánto de lo que escuchas cae en cada escena (y cuántas canciones distintas). */
function pesosPorEscena(m) {
	const escenas = escenasDe(m);
	const out = /* @__PURE__ */ new Map();
	for (const [id, p] of pesosDeEscucha(m).pesos) {
		const e = escenas.get(id);
		if (!e) continue;
		const x = out.get(e.id) ?? {
			peso: 0,
			n: 0
		};
		x.peso += p;
		x.n++;
		out.set(e.id, x);
	}
	return out;
}
const ESTILOS$1 = [
	{
		id: "rock",
		escenas: [
			"rock-clasico",
			"rock-alternativo",
			"indie-rock",
			"rock-espanol"
		],
		titulos: [
			"Mix Rock",
			"Rock para ti",
			"Puro rock"
		]
	},
	{
		id: "metal",
		escenas: ["metal"],
		titulos: [
			"Mix Metal",
			"Metal para ti",
			"Puro metal"
		]
	},
	{
		id: "hiphop",
		escenas: ["hiphop-clasico", "hiphop-actual"],
		titulos: [
			"Mix Hip hop",
			"Rap y hip hop",
			"Hip hop para ti"
		]
	},
	{
		id: "rnb",
		escenas: ["rnb", "soul"],
		titulos: [
			"Mix R&B",
			"R&B para ti",
			"R&B y soul"
		]
	},
	{
		id: "electronica",
		escenas: ["electronica-actual", "club-clasico"],
		titulos: [
			"Mix Electrónica",
			"Electrónica para ti",
			"Pura electrónica"
		]
	},
	{
		id: "pop",
		escenas: ["pop-actual", "pop-clasico"],
		titulos: [
			"Mix Pop",
			"Pop para ti",
			"Puro pop"
		]
	},
	{
		id: "kpop",
		escenas: ["kpop"],
		titulos: [
			"Mix K-pop",
			"K-pop para ti",
			"Puro K-pop"
		]
	},
	{
		id: "indie",
		escenas: ["indie-pop"],
		titulos: [
			"Mix Indie",
			"Indie para ti",
			"Indie y dream pop"
		]
	},
	{
		id: "retro",
		escenas: ["synth", "disco"],
		titulos: [
			"Mix Synth y disco",
			"Ochenteros para ti",
			"Disco y new wave"
		]
	},
	{
		id: "latino",
		escenas: ["pop-latino"],
		titulos: [
			"Mix Pop latino",
			"Pop latino para ti",
			"Latino para ti"
		]
	},
	{
		id: "baladas",
		escenas: ["baladas"],
		titulos: [
			"Mix Baladas",
			"Baladas para ti",
			"Baladas y soft rock"
		]
	},
	{
		id: "country",
		escenas: ["country"],
		titulos: [
			"Mix Country",
			"Country y folk para ti",
			"Country para ti"
		]
	},
	{
		id: "jazz",
		escenas: ["jazz"],
		titulos: [
			"Mix Jazz",
			"Jazz y chill para ti",
			"Jazz para ti"
		]
	}
];
const ESTILO_MIN = .07;
const ESTILO_MIN_CANCIONES = 5;
const MAX_ESTILOS = 4;
const MIX_FIJO_MIN = .03;
/**
* El mix de un estilo: canciones de sus escenas, repartidas según cuánto escuchas cada una (si solo escuchas hip
* hop actual, casi todo es de ahí). Mezcla lo tuyo con lo conocido y lo parecido; cambia cada día.
*/
function mixDeEstilo(m, est, porEscena, excluir, n, azar) {
	const escenas = escenasDe(m);
	const norm = normAfinidad(m);
	const pesos = est.escenas.map((e) => porEscena.get(e)?.peso ?? 0);
	const suma = pesos.reduce((a, b) => a + b, 0) || 1;
	const cupos = est.escenas.map((_, i) => Math.round(n * (.85 * (pesos[i] / suma) + .15 / est.escenas.length)));
	const cand = new Map(est.escenas.map((e) => [e, []]));
	for (const t of m.input.tracks) {
		const e = escenas.get(t.id)?.id;
		const l = e && cand.get(e);
		if (!l || excluir.has(t.id) || m.input.ratings[t.id] === -1 || isTestSilence(m, t.id) || !categoriaPermitida(m, t)) continue;
		l.push([t.id, .45 * norm(m.baseAffinity.get(t.id) ?? 0) + .35 * popDe(m, t) + .1 * (t.exito?.valor ?? 0) + .35 * azar() - raroDe(t)]);
	}
	const elegidas = [];
	const sobrantes = [];
	est.escenas.forEach((e, i) => {
		const orden = cand.get(e).sort((a, b) => b[1] - a[1]);
		const ids = conLimiteArtista(m, orden.map(([id]) => id), cupos[i], 2);
		elegidas.push(...ids);
		const ya = new Set(ids);
		sobrantes.push(...orden.filter(([id]) => !ya.has(id)));
	});
	if (elegidas.length < n) {
		const ya = new Set(elegidas);
		elegidas.push(...conLimiteArtista(m, sobrantes.sort((a, b) => b[1] - a[1]).map(([id]) => id), n, 2).filter((id) => !ya.has(id)).slice(0, n - elegidas.length));
	}
	const ids = barajarSuave(elegidas, azar).slice(0, n);
	return ids.length >= MIX_MIN ? ids : null;
}
/**
* Todo "Para ti", en orden: lo que más escuchas primero.
*  - Los mixes del panel (Essential, Reggaeton, Anime Now) solo salen si de verdad escuchas eso.
*  - Tarjetas de estilo (Rock, Metal, Hip hop, R&B…) según tu historial; no repiten un Mix diario.
*  - Descubrimiento semanal va segundo; los Mix diario, según cuánto escuchas su escena.
*  - El orden se mueve un poco cada día entre las que están parejas, y el contenido cambia cada día.
* Sin historial suficiente: los mixes del panel, como antes. `semilla` = cuenta + día.
*/
function paraTi(m, defs, personales, semilla) {
	const mixes = mixesParaTi(m, defs, semilla);
	if (heardIds(m).length < MIN_PARA_LISTAS) return [...mixes.map((x) => ({
		...x,
		tipo: "mix"
	})), ...personales.map((p) => ({
		...p,
		tuyo: 0
	}))];
	const { total } = pesosDeEscucha(m);
	const porEscena = pesosPorEscena(m);
	const parte = (e) => total ? (porEscena.get(e)?.peso ?? 0) / total : 0;
	const tarjetas = mixes.filter((x) => x.tuyo >= MIX_FIJO_MIN).map((x) => ({
		...x,
		tipo: "mix"
	}));
	const escenaDeDiario = (titulo) => ESCENAS_POR_NOMBRE.get(titulo.replace(/^Mix diario:\s*/, ""))?.id;
	const diarios = personales.filter((p) => p.tipo === "diario");
	const escenasDiarias = new Set(diarios.map((p) => escenaDeDiario(p.titulo)).filter((x) => !!x));
	for (const p of diarios) {
		const e = escenaDeDiario(p.titulo);
		tarjetas.push({
			...p,
			tuyo: e ? parte(e) : 0
		});
	}
	const enDiarios = new Set(diarios.flatMap((p) => p.ids));
	const azarDia = azarDe(semilla);
	const estilos = ESTILOS$1.map((est) => {
		const peso = est.escenas.reduce((a, e) => a + (porEscena.get(e)?.peso ?? 0), 0);
		const n = est.escenas.reduce((a, e) => a + (porEscena.get(e)?.n ?? 0), 0);
		const cubierto = est.escenas.reduce((a, e) => a + (escenasDiarias.has(e) ? porEscena.get(e)?.peso ?? 0 : 0), 0);
		return {
			est,
			tuyo: total ? peso / total : 0,
			n,
			cubierto: peso ? cubierto / peso : 0,
			peso
		};
	}).filter((x) => x.tuyo >= ESTILO_MIN && x.n >= ESTILO_MIN_CANCIONES && x.cubierto < .75).sort((a, b) => b.tuyo - a.tuyo).slice(0, MAX_ESTILOS);
	for (const { est, tuyo, peso } of estilos) {
		const azar = azarDe(`${semilla}:${est.id}`);
		const ids = mixDeEstilo(m, est, porEscena, enDiarios, 50, azar);
		if (!ids) continue;
		const dominante = est.escenas.length > 1 ? est.escenas.find((e) => (porEscena.get(e)?.peso ?? 0) >= .75 * peso) : void 0;
		const nombre = dominante ? ESCENAS.find((e) => e.id === dominante).nombre : null;
		const opciones = nombre ? [
			`Mix ${nombre}`,
			`${nombre} para ti`,
			`Puro ${nombre.toLowerCase()}`
		] : est.titulos;
		tarjetas.push({
			id: `estilo-${est.id}`,
			titulo: opciones[Math.floor(azar() * opciones.length)],
			tuyo,
			ids,
			tipo: "estilo"
		});
	}
	const orden = tarjetas.map((t) => [t, t.tuyo * (.8 + .4 * azarDia())]).sort((a, b) => b[1] - a[1]).map(([t]) => t);
	const semanal = personales.find((p) => p.tipo === "semanal");
	if (semanal) orden.splice(Math.min(1, orden.length), 0, {
		...semanal,
		tuyo: 0
	});
	return orden;
}
/**
* Familias de género: las etiquetas de MusicBrainz son muy específicas ("gangsta rap", "east coast hip hop",
* "g-funk"), así que se agrupan en familias para saber que dos canciones son del mismo estilo aunque
* no compartan la etiqueta exacta.
*/
const FAMILIES = {
	hiphop: [
		"hip hop",
		"hip-hop",
		"rap",
		"trap",
		"g-funk",
		"gangsta",
		"boom bap",
		"drill",
		"grime",
		"golden age"
	],
	rnb: [
		"r&b",
		"rnb",
		"soul",
		"motown",
		"new jack swing",
		"quiet storm",
		"funk"
	],
	pop: [
		"pop",
		"teen",
		"bubblegum"
	],
	kpop: [
		"k-pop",
		"kpop",
		"j-pop",
		"korean",
		"c-pop",
		"mandopop"
	],
	rock: [
		"rock",
		"alternative",
		"indie",
		"grunge",
		"punk",
		"new wave",
		"post-punk",
		"psychedel",
		"shoegaze"
	],
	metal: [
		"metal",
		"hardcore",
		"thrash",
		"grindcore",
		"djent",
		"screamo"
	],
	soft: [
		"soft rock",
		"adult contemporary",
		"ballad",
		"singer-songwriter",
		"yacht",
		"easy listening"
	],
	electronic: [
		"electronic",
		"edm",
		"house",
		"techno",
		"eurodance",
		"dance",
		"garage",
		"trance",
		"disco",
		"electro",
		"hi-nrg",
		"italo"
	],
	latin: [
		"latin",
		"reggaeton",
		"cumbia",
		"salsa",
		"bachata",
		"merengue",
		"en español",
		"mpb",
		"bossa",
		"axé"
	],
	country: [
		"country",
		"americana",
		"bluegrass",
		"folk"
	],
	jazz: [
		"jazz",
		"downtempo",
		"lounge",
		"trip hop",
		"chill",
		"ambient"
	],
	mexicano: [],
	phonk: [
		"phonk",
		"funk carioca",
		"baile funk",
		"funk mandel",
		"mandelão",
		"automotivo",
		"brazilian funk",
		"montagem"
	],
	hyperpop: [
		"hyperpop",
		"digicore",
		"glitchcore",
		"pc music",
		"bubblegum bass",
		"dariacore",
		"scenecore",
		"hexd"
	],
	nightcore: ["nightcore", "daycore"],
	chiptune: [
		"chiptune",
		"8-bit",
		"8bit",
		"bitpop",
		"chipwave",
		"chip music"
	],
	vaporwave: [
		"vaporwave",
		"future funk",
		"mallsoft",
		"slushwave",
		"plunderphonics",
		"signalwave",
		"hardvapour",
		"seapunk"
	],
	synthwave: [
		"synthwave",
		"retrowave",
		"outrun",
		"darksynth",
		"chillwave",
		"dreamwave"
	],
	breakcore: [
		"breakcore",
		"digital hardcore",
		"speedcore",
		"drill 'n' bass",
		"drill and bass"
	],
	dnb: [
		"drum and bass",
		"drum'n'bass",
		"drum & bass",
		"drum n bass",
		"dnb",
		"jungle",
		"liquid funk",
		"neurofunk"
	],
	witchhouse: ["witch house"],
	rapinternet: [
		"cloud rap",
		"rage",
		"pluggnb",
		"plugg",
		"sigilkore",
		"soundcloud rap",
		"emo rap",
		"jerk"
	],
	lofi: [
		"lofi",
		"lofi hip hop",
		"lo-fi hip hop",
		"lofi beats",
		"chillhop",
		"jazzhop",
		"jazz hop"
	],
	bedroom: [
		"bedroom pop",
		"lo-fi",
		"lo-fi indie"
	]
};
const FAMILY_KEYS = Object.keys(FAMILIES);
const ASIATICO = /k-pop|kpop|j-pop|c-pop|mandopop|korean/;
const MEXICANO = /m[uú]sica mexicana|regional mexican|\bmexican|corrido|norte[nñ]|sierre[nñ]|mariachi|ranchera|tejano|grupero|\bbanda\b(?! sonora)/;
const escapar = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Palabra entera: "rage" no es "garage", ni "jungle" de "jungle pop"… sí (es lo mismo). */
const palabraEntera = (ws) => new RegExp(`(?:^|[^\\p{L}])(?:${ws.map(escapar).join("|")})(?:$|[^\\p{L}])`, "u");
const PHONK = new RegExp(FAMILIES.phonk.join("|"));
/** Familias de internet: se reconocen por palabra entera y sus etiquetas no cuentan para otras familias. */
const ESCENAS_INTERNET = [
	"hyperpop",
	"nightcore",
	"chiptune",
	"vaporwave",
	"synthwave",
	"breakcore",
	"dnb",
	"witchhouse",
	"rapinternet",
	"lofi",
	"bedroom"
];
const RE_INTERNET = new Map(ESCENAS_INTERNET.map((f) => [f, palabraEntera(FAMILIES[f])]));
const deInternet = (g) => [...RE_INTERNET.values()].some((re) => re.test(g));
/** ¿La etiqueta `g` es de la familia `f`? ("k-pop" no cuenta como pop a secas; "pop metal"/"metal" no como rock.) */
function enFamilia(f, g) {
	if (f === "mexicano") return MEXICANO.test(g);
	if (f === "bedroom" && RE_INTERNET.get("lofi").test(g)) return false;
	const reInternet = RE_INTERNET.get(f);
	if (reInternet) return reInternet.test(g);
	if (f !== "phonk" && PHONK.test(g)) return false;
	if (deInternet(g)) return false;
	if (f === "pop" && ASIATICO.test(g)) return false;
	if (f === "rock" && /metal/.test(g)) return false;
	return FAMILIES[f].some((w) => g.includes(w));
}
/** Integrantes de un texto de artista ("DJ FKU, Mc Dido", "ZXKAI y slxughter"). */
const integrantes$1 = (artista) => artista.split(/\s*(?:,|;|&|\/|\bfeat\.?|\bft\.?|\bx\b|\by\b|\be\b|\band\b|\bwith\b|\bcon\b)\s*/i).map((x) => normalize(x)).filter((x) => x.length > 1);
/**
* ¿El título o el artista delatan phonk? Lo usual: "MONTAGEM …", "MTG - …", "… PHONK", "NO BATIDÃO", "FUNK …"
* en mayúsculas (no "Uptown Funk"), productores "-MANE" (ICEDMANE, Scythermane) y versiones "Slowed" con un MC
* brasileño.
*/
function phonkPorNombre(t) {
	const titulo = t.title;
	if (/\b(?:phonk|montagem|mtg|automotivo|batid[aã]o|mandel[aã]o)\b/i.test(titulo)) return true;
	if (t.year && t.year < 2018) return false;
	const version = /\s*(?:-\s*|[([])(?:ultra |super )?(?:slowed|sped up|slown down)[^)\]]*[)\]]?\s*$/i;
	const base = titulo.replace(version, "");
	const mayusculas = /\p{Lu}/u.test(base) && base === base.toUpperCase();
	if (mayusculas && /\bFUNK\b/.test(base)) return true;
	const miembros = integrantes$1(t.artist);
	const mc = miembros.some((a) => /^mc\b|\bmc$/.test(a));
	const slowed = version.test(titulo);
	if ((mayusculas || slowed) && miembros.some((a) => a.length >= 6 && /mane$/.test(a.replace(/\s/g, "")))) return true;
	const otroEstilo = t.genres.some((g) => /pop|r&b|rnb|soul|rock|country|jazz/i.test(g));
	if (slowed && (mayusculas || mc) && !otroEstilo) return true;
	return false;
}
/**
* ¿Lofi para estudiar? Lofi Girl y sus sellos casi nunca traen género (o solo "Electronic"): se nota en el
* artista o el álbum ("Sleepermane y Lofi Girl", "lofi hip hop radio").
*/
function lofiPorNombre(t) {
	if (integrantes$1(t.artist).some((a) => /^(?:lofi girl|chillhop music|chillhop|college music|lofi records|dreamhop|steezyasfuck)$/.test(a))) return true;
	return /\blofi\b|\bchillhop\b|lo-fi (?:hip hop|beats)|study beats/i.test(`${t.artist} ${t.album}`);
}
/** Phonk por sí misma (géneros, título o artista), sin mirar a otras canciones. */
const esPhonkPropio = (t) => phonkPorNombre(t) || t.genres.some((g) => PHONK.test(g.toLowerCase()));
const familyCache = /* @__PURE__ */ new WeakMap();
/** Vector de familias de una canción (si no tiene géneros, usa los de su artista en tu biblioteca). */
function familiesOf(m, t) {
	let c = familyCache.get(m);
	if (!c) {
		const byArtist = /* @__PURE__ */ new Map();
		const cuenta = /* @__PURE__ */ new Map();
		for (const x of m.input.tracks) {
			const ph = esPhonkPropio(x) ? 1 : 0;
			for (const a of integrantes$1(x.artist)) {
				const [p, n] = cuenta.get(a) ?? [0, 0];
				cuenta.set(a, [p + ph, n + 1]);
			}
		}
		const phonkeros = new Set([...cuenta].filter(([, [p, n]]) => p > 0 && 2 * p >= n).map(([a]) => a));
		for (const x of m.input.tracks) {
			if (!x.genres.length) continue;
			const k = normalize(x.artist);
			byArtist.set(k, [...byArtist.get(k) ?? [], ...x.genres]);
		}
		c = {
			byArtist,
			phonkeros,
			vec: /* @__PURE__ */ new Map()
		};
		familyCache.set(m, c);
	}
	const hit = c.vec.get(t.id);
	if (hit !== void 0) return hit;
	const tags = (t.genres.length ? t.genres : c.byArtist.get(normalize(t.artist)) ?? []).map((g) => g.toLowerCase());
	let v = null;
	if (tags.length) {
		v = FAMILY_KEYS.map((f) => tags.filter((g) => enFamilia(f, g)).length);
		if (v.every((x) => x === 0)) v = null;
	}
	const generica = t.genres.every((g) => /^(?:electronic|electronica|dance|edm|latin|brazilian|hip-hop\/rap)$/i.test(g.trim()));
	const solo = (familia) => FAMILY_KEYS.map((f) => f === familia ? 1 : 0);
	if (phonkPorNombre(t) || generica && integrantes$1(t.artist).some((a) => c.phonkeros.has(a))) v = solo("phonk");
	else if (generica && lofiPorNombre(t)) v = solo("lofi");
	c.vec.set(t.id, v);
	return v;
}
/** Familias que se llevan bien entre sí aunque no sean la misma (si hay que salir del estilo, mejor a una de estas). */
const PARIENTES = [
	["pop", "kpop"],
	["pop", "rnb"],
	["pop", "electronic"],
	["pop", "latin"],
	["pop", "soft"],
	["rock", "soft"],
	["rock", "metal"],
	["hiphop", "rnb"],
	["electronic", "kpop"],
	["jazz", "soft"],
	["country", "soft"],
	["phonk", "hiphop"],
	["phonk", "electronic"],
	["phonk", "rapinternet"],
	["hyperpop", "pop"],
	["hyperpop", "electronic"],
	["hyperpop", "nightcore"],
	["hyperpop", "chiptune"],
	["hyperpop", "rapinternet"],
	["hyperpop", "breakcore"],
	["hyperpop", "vaporwave"],
	["vaporwave", "chiptune"],
	["nightcore", "chiptune"],
	["nightcore", "electronic"],
	["nightcore", "kpop"],
	["chiptune", "electronic"],
	["vaporwave", "electronic"],
	["vaporwave", "rnb"],
	["synthwave", "electronic"],
	["breakcore", "electronic"],
	["witchhouse", "electronic"],
	["dnb", "electronic"],
	["lofi", "hiphop"],
	["bedroom", "rock"],
	["bedroom", "pop"]
];
/**
* Tan cercanas que en la radio se mezclan sin problema: el corrido tumbado es casi urbano latino, el cloud rap
* es rap, el lofi viene del jazz, el future funk y el synthwave miran a los 80, el breakcore sale del jungle.
*/
const CERCANAS = [
	["mexicano", "latin"],
	["rapinternet", "hiphop"],
	["lofi", "jazz"],
	["vaporwave", "synthwave"],
	["breakcore", "dnb"]
];
const familiaTop = (v) => FAMILY_KEYS[v.indexOf(Math.max(...v))];
const enPares = (pares, a, b) => {
	const x = familiaTop(a);
	const y = familiaTop(b);
	return pares.some(([p, q]) => p === x && q === y || p === y && q === x);
};
function emparentadas(a, b) {
	return enPares(PARIENTES, a, b) || enPares(CERCANAS, a, b);
}
const cercanas = (a, b) => enPares(CERCANAS, a, b);
const PALABRAS = {
	es: [
		"el",
		"la",
		"los",
		"las",
		"que",
		"mi",
		"tu",
		"amor",
		"corazon",
		"quiero",
		"con",
		"por",
		"para",
		"una",
		"yo",
		"mas",
		"como",
		"noche",
		"vida",
		"baila",
		"mami",
		"bebe",
		"contigo",
		"sin",
		"todo",
		"nada",
		"eres",
		"estoy",
		"dime",
		"cuando",
		"donde",
		"perreo",
		"despecha",
		"otra",
		"vez",
		"loca",
		"ojos",
		"besos",
		"beso",
		"te",
		"nunca",
		"mia"
	],
	en: [
		"the",
		"you",
		"love",
		"my",
		"it",
		"in",
		"of",
		"on",
		"your",
		"baby",
		"dont",
		"girl",
		"night",
		"heart",
		"all",
		"we",
		"to",
		"is",
		"and",
		"oh",
		"up",
		"way",
		"what",
		"just",
		"like",
		"with",
		"be",
		"this",
		"that",
		"its",
		"me",
		"im",
		"go",
		"out",
		"down",
		"boy",
		"feel",
		"want",
		"get",
		"got",
		"never",
		"got",
		"touch",
		"game",
		"girls",
		"about",
		"hey",
		"i",
		"dance",
		"tonight",
		"gonna",
		"wanna",
		"come",
		"little",
		"time",
		"good",
		"let",
		"can",
		"shake",
		"world",
		"christmas",
		"sunshine",
		"forever",
		"everybody",
		"somebody",
		"nothing",
		"tell",
		"take",
		"make",
		"when",
		"who",
		"where",
		"why",
		"more",
		"only",
		"happy",
		"party",
		"kiss",
		"crazy",
		"dream",
		"dreams",
		"remember",
		"life",
		"stay",
		"stop",
		"run",
		"walk",
		"talk",
		"back",
		"again"
	],
	pt: [
		"voce",
		"nao",
		"coracao",
		"eu",
		"saudade",
		"amo",
		"meu",
		"minha",
		"pra",
		"tudo",
		"beijo",
		"ela",
		"ele",
		"dos",
		"das",
		"uma",
		"sem",
		"mais",
		"seu",
		"sua",
		"muito",
		"agora",
		"nunca",
		"aos",
		"tem",
		"vai",
		"vou",
		"esse",
		"essa",
		"isso",
		"aqui",
		"onde",
		"quando",
		"gente",
		"que",
		"por",
		"para",
		"amor",
		"vida",
		"como",
		"todo",
		"nada",
		"te"
	],
	it: [
		"che",
		"sei",
		"amore",
		"mio",
		"della",
		"per",
		"ti",
		"non",
		"sono",
		"tutto",
		"notte",
		"cuore",
		"bella",
		"ciao",
		"questo",
		"di",
		"il",
		"mia",
		"tra",
		"gli",
		"nel",
		"mai",
		"sempre",
		"ancora",
		"io",
		"storia",
		"assenza",
		"vita",
		"volta",
		"senza",
		"perche"
	],
	fr: [
		"je",
		"les",
		"mon",
		"toi",
		"pas",
		"moi",
		"qui",
		"est",
		"cest",
		"mais",
		"tout",
		"jamais",
		"avec",
		"dans",
		"aime",
		"pour"
	]
};
const GENERO_IDIOMA = [
	[/k-pop|kpop|korean|k-r&b|k-hip/, "ko"],
	[/j-pop|jpop|j-rock|japanese|anime|city pop/, "ja"],
	[/latin|reggaeton|reggaet|bachata|salsa|cumbia|merengue|flamenco|ranchera|corrido|en espanol|en español|regional mexican|m[uú]sica mexicana|norte[nñ]o|urbano|trap latino|dembow|\bbanda\b(?! sonora)/, "es"],
	[/mpb|sertanejo|bossa|samba|funk carioca|baile funk|mandel|axe|pagode|brazil/, "pt"],
	[/italian|canzone|italo pop/, "it"],
	[/chanson|french|variete francaise/, "fr"],
	[/^english$/, "en"]
];
/** Puntos de idioma de un texto (títulos, álbumes). */
function puntosIdioma(texto, out) {
	const suma = (l, n) => out.set(l, (out.get(l) ?? 0) + n);
	if (/[가-힯ᄀ-ᇿ]/.test(texto)) suma("ko", 4);
	if (/[぀-ヿ]/.test(texto)) suma("ja", 4);
	if (/[ñ¿¡]/i.test(texto)) suma("es", 2);
	if (/[ãõç]/i.test(texto)) suma("pt", 2);
	if (/[êô]/i.test(texto)) suma("pt", 1);
	const limpio = texto.replace(/[([](?:con|feat\.?|ft\.?|with)\s[^)\]]*[)\]]/gi, " ");
	if (/spanish version|versi[oó]n en espa[nñ]ol|en espa[nñ]ol/i.test(limpio)) suma("es", 4);
	const palabras = new Set(normalize(limpio).split(" "));
	for (const [l, lista] of Object.entries(PALABRAS)) for (const w of palabras) if (lista.includes(w)) suma(l, 1);
}
/** Puntos de idioma por géneros. "latin" junto a un género brasileño es música brasileña, no en español. */
function puntosGenero(generos, out, brasileno = false) {
	const ls = /* @__PURE__ */ new Set();
	for (const g of generos) for (const [re, l] of GENERO_IDIOMA) if (re.test(g.toLowerCase())) ls.add(l);
	if (brasileno || ls.has("pt")) ls.delete("es");
	for (const l of ls) out.set(l, (out.get(l) ?? 0) + 2);
}
const idiomaCache = /* @__PURE__ */ new WeakMap();
/**
* Idioma de un artista (se decide con TODAS sus canciones: títulos, álbumes y géneros). null = no se sabe
* (pocas pistas o empate): en ese caso no se usa para filtrar.
*/
function idiomaDe(m, t) {
	let c = idiomaCache.get(m);
	if (!c) {
		c = /* @__PURE__ */ new Map();
		const porArtista = /* @__PURE__ */ new Map();
		for (const x of m.input.tracks) {
			const k = normalize(x.artist);
			porArtista.set(k, [...porArtista.get(k) ?? [], x]);
		}
		for (const [k, lista] of porArtista) {
			const pts = /* @__PURE__ */ new Map();
			const brasileno = lista.some((x) => x.genres.some((g) => GENERO_IDIOMA.some(([re, l]) => l === "pt" && re.test(g.toLowerCase()))));
			for (const x of lista) {
				puntosIdioma(`${x.title} ${x.album}`, pts);
				puntosGenero(x.genres, pts, brasileno);
			}
			const [primero, segundo] = [...pts.entries()].sort((a, b) => b[1] - a[1]);
			c.set(k, primero && primero[1] >= 3 && (!segundo || primero[1] >= segundo[1] * 1.6) ? primero[0] : null);
		}
		idiomaCache.set(m, c);
	}
	const k = `t:${t.id}`;
	if (c.has(k)) return c.get(k) ?? null;
	const pts = /* @__PURE__ */ new Map();
	puntosIdioma(t.title, pts);
	const [a, b] = [...pts.entries()].sort((x, y) => y[1] - x[1]);
	const claro = a && a[1] >= 2 && (!b || a[1] >= 2 * b[1]) ? a[0] : null;
	const principal = normalize(t.artist.split(/\s+(?:y|&|and|feat\.?|ft\.?|con|x|with)\s+|,|\//i)[0] ?? "");
	let idioma = claro ?? c.get(normalize(t.artist)) ?? (principal ? c.get(principal) : null) ?? null;
	if (!idioma) {
		const p2 = /* @__PURE__ */ new Map();
		puntosIdioma(`${t.title} ${t.album}`, p2);
		puntosGenero(t.genres, p2);
		const [x, y] = [...p2.entries()].sort((u, v) => v[1] - u[1]);
		idioma = x && (!y || x[1] > y[1]) ? x[0] : null;
	}
	c.set(k, idioma);
	return idioma;
}
function cosine(a, b) {
	let d = 0;
	let na = 0;
	let nb = 0;
	for (let i = 0; i < a.length; i++) {
		d += a[i] * b[i];
		na += a[i] * a[i];
		nb += b[i] * b[i];
	}
	return na && nb ? d / Math.sqrt(na * nb) : 0;
}
/**
* Qué tan parecidas son dos canciones. Lo que más pesa: el estilo (familia de género) y el sonido
* (energía, pulso, ritmo). Estilos claramente distintos (hip hop vs. soft rock) restan.
*/
/**
* Qué tan distinta es la vibe de dos canciones (0 = igual, ~0,5 = opuesta), o null si alguna no tiene vibe.
* Pesan más el ánimo (alegre/triste/relajada/agresiva/fiesta) y si es bailable que acústica/electrónica.
*/
const PESOS_VIBE = [
	["feliz", 1.3],
	["triste", 1.3],
	["relajada", 1.2],
	["agresiva", 1.1],
	["fiesta", 1.2],
	["bailable", 1.1],
	["acustica", .8],
	["electronica", .7],
	["instrumental", .5]
];
const SUMA_VIBE = PESOS_VIBE.reduce((a, [, w]) => a + w, 0);
function distanciaVibe(a, b) {
	if (!a.vibe || !b.vibe) return null;
	let d = 0;
	for (const [k, w] of PESOS_VIBE) d += w * Math.abs(a.vibe[k] - b.vibe[k]);
	return d / SUMA_VIBE;
}
/** Etiquetas de Last.fm en común, ponderadas (0 = ninguna, 1 = las mismas). */
function tagsEnComun(a, b) {
	if (!a.tags?.length || !b.tags?.length) return 0;
	const pa = new Map(a.tags.map((t) => [t.n, t.c]));
	let comun = 0;
	let total = 0;
	for (const t of b.tags) {
		total += t.c;
		const x = pa.get(t.n);
		if (x !== void 0) comun += Math.min(x, t.c);
	}
	for (const t of a.tags) total += t.c;
	return total ? 2 * comun / total : 0;
}
/** Año de la canción; si no se conoce, el año en que fue éxito de fin de año. */
const epocaDe = (t) => t.year ?? t.exito?.anio;
function similarity(m, a, b) {
	let s = 0;
	if (normalize(a.artist) === normalize(b.artist)) s += .12;
	const fa = familiesOf(m, a);
	const fb = familiesOf(m, b);
	if (fa && fb) {
		const c = cosine(fa, fb);
		s += .5 * c;
		if (c < .15) s -= .3;
	}
	const va = m.sound.get(a.id);
	const vb = m.sound.get(b.id);
	if (va && vb) {
		const d = (1.5 * Math.abs(va.energy - vb.energy) + 1.2 * Math.abs(va.beat - vb.beat) + Math.abs(va.activity - vb.activity) + .6 * Math.abs(va.brightness - vb.brightness) + .8 * Math.abs(va.fast - vb.fast)) / 5.1;
		s += .4 * (1 - d) - .15;
	}
	const dv = distanciaVibe(a, b);
	if (dv !== null) s += .5 * (1 - 2.2 * dv);
	s += .3 * tagsEnComun(a, b);
	const co = (m.transitions.get(`${a.id}>${b.id}`) ?? 0) + (m.transitions.get(`${b.id}>${a.id}`) ?? 0);
	s += .25 * Math.min(1, co / 3);
	s += .3 * (m.input.vecinos?.get(a.id)?.get(b.id) ?? 0);
	s += .35 * ytmEntre(m, a.id, b.id);
	const anioA = epocaDe(a);
	const anioB = epocaDe(b);
	if (anioA && anioB) {
		const gap = Math.abs(anioA - anioB);
		if (gap <= 4) s += .14;
		else if (gap <= 8) s += .06;
		else if (gap > 20) s -= .1;
	}
	return s;
}
/**
* Radio: siguientes `n` canciones parecidas a las últimas que sonaron (la última pesa más),
* que además te gusten. Evita repetir lo que ya está en la cola y elige con algo de azar entre las mejores.
*/
/** El Automix pone aquí un pequeño premio para las canciones que se pueden mezclar con la anterior. */
const radioHooks = {};
function radio(m, seedIds, exclude, n) {
	const sesion = sesionDe(m);
	const vigentes = seedIds.filter((id) => !sesion.saltadas.has(id));
	const seeds = (vigentes.length ? vigentes : seedIds).slice(-3).reverse().map((id, i) => ({
		t: m.byId.get(id),
		w: [
			1,
			.6,
			.35
		][i]
	})).filter((x) => !!x.t);
	if (!seeds.length) return shortcuts(m, n).filter((id) => !exclude.has(id));
	const ancla = m.byId.get(seedIds[0]) ?? seeds[0].t;
	const famAncla = familiesOf(m, ancla);
	const nicho = !!famAncla && [...ESCENAS_INTERNET, "phonk"].includes(familiaTop(famAncla));
	const idiomaAncla = idiomaDe(m, ancla);
	const catsRadio = new Set([ancla, ...seeds.map((s) => s.t)].flatMap(mundoDe));
	const otroMundo = (t) => mundoDe(t).some((c) => !catsRadio.has(c));
	/**
	* Qué tan fuera de lugar queda `t` en esta radio (0 = encaja). Estilo distinto o década distinta restan
	* tanto que solo entran si no queda nada mejor (una excepción rara, no la norma).
	*/
	const fueraDeLugar = (t) => {
		let p = 0;
		const f = familiesOf(m, t);
		if (famAncla) {
			if (!f) p += normalize(t.artist) === normalize(ancla.artist) ? 0 : nicho ? .6 : .35;
			else {
				const c = cosine(famAncla, f);
				if (c < .2) p += cercanas(famAncla, f) ? .2 : emparentadas(famAncla, f) ? .45 : .9;
				else if (c < .5) p += .3;
			}
		}
		const anioAncla = epocaDe(ancla);
		const anioT = epocaDe(t);
		if (anioAncla && anioT) {
			const gap = Math.abs(anioAncla - anioT);
			if (gap > 15) p += .8;
			else if (gap > 8) p += .35;
			else if (gap > 5) p += .1;
		} else if (anioAncla && !anioT) p += .15;
		const idioma = idiomaDe(m, t);
		if (idiomaAncla && idioma && idioma !== idiomaAncla) {
			const par = (x, y) => idiomaAncla === x && idioma === y || idiomaAncla === y && idioma === x;
			p += par("ko", "en") || par("es", "pt") ? .25 : 2.5;
		} else if (idiomaAncla && !idioma && normalize(t.artist) !== normalize(ancla.artist)) p += .45;
		const dv = distanciaVibe(ancla, t);
		if (dv !== null) {
			if (dv > .34) p += .7;
			else if (dv > .24) p += .3;
		}
		return p;
	};
	const aff = [...m.baseAffinity.values()];
	const lo = Math.min(...aff);
	const hi = Math.max(...aff);
	const norm = (v) => hi > lo ? (v - lo) / (hi - lo) : .5;
	const wsum = seeds.reduce((x, s) => x + s.w, 0);
	const scored = [];
	const fuera = /* @__PURE__ */ new Map();
	const confianzaYt = confianzaEnYoutube(m);
	for (const t of m.input.tracks) {
		if (exclude.has(t.id) || isTestSilence(m, t.id) || otroMundo(t)) continue;
		let sim = 0;
		for (const s of seeds) sim += s.w * similarity(m, s.t, t);
		const yA = confianzaYt * ytmEntre(m, ancla.id, t.id);
		const yL = confianzaYt * ytmEntre(m, seeds[0].t.id, t.id);
		let p = fueraDeLugar(t) * (1 - .75 * Math.max(yA, yL));
		if (catsRadio.size && !mundoDe(t).some((c) => catsRadio.has(c))) p += 1.2;
		fuera.set(t.id, p);
		let score = .45 * (sim / wsum) + .4 * similarity(m, ancla, t) + .25 * norm(m.baseAffinity.get(t.id) ?? 0) - p;
		score += .9 * yA + .4 * yL;
		if (m.input.ratings[t.id] === 1) score += .15;
		const st = m.stats.get(t.id);
		if (st && st.skips >= 2 && st.skips > st.completes) score -= .3;
		const saltada = (m.saltosTras.get(`${ancla.id}>${t.id}`) ?? 0) + (m.saltosTras.get(`${seeds[0].t.id}>${t.id}`) ?? 0);
		if (saltada) score -= Math.min(.8, .4 * saltada);
		if (t.pop !== void 0) score += .2 * (t.pop - .5);
		score += .08 * (t.exito?.valor ?? 0);
		if (m.input.ratings[t.id] === -1) score -= 1.5;
		if (radioHooks.bonus) score += radioHooks.bonus(seedIds[seedIds.length - 1], t.id);
		const last = m.stats.get(t.id)?.lastPlayed ?? 0;
		if (m.input.now - last < 72e5) score -= .3;
		scored.push([t.id, score]);
	}
	scored.sort((a, b) => b[1] - a[1]);
	if (sesion.buenas.length || sesion.malas.length) {
		const cabeza = scored.slice(0, 300).map(([id, s]) => {
			const t = m.byId.get(id);
			let extra = 0;
			for (const b of sesion.buenas) extra += .2 * similarity(m, b, t) / sesion.buenas.length;
			for (const b of sesion.malas) extra -= .3 * similarity(m, b, t) / sesion.malas.length;
			if ((sesion.artistasSaltados.get(normalize(t.artist)) ?? 0) >= 2) extra -= .4;
			return [id, s + extra];
		});
		cabeza.sort((a, b) => b[1] - a[1]);
		scored.splice(0, cabeza.length, ...cabeza);
	}
	const artistOf = (id) => normalize(m.byId.get(id)?.artist ?? "");
	const albumOf = (id) => {
		const t = m.byId.get(id);
		return t && t.album && t.album !== "Álbum desconocido" ? `${normalize(t.albumArtist)}|${normalize(t.album)}` : null;
	};
	const allowed = (id, hist, artistas, albumes) => {
		const a = artistOf(id);
		const al = albumOf(id);
		return !(artistas && hist.slice(-artistas).some((x) => artistOf(x) === a)) && !(albumes && al && hist.slice(-albumes).some((x) => albumOf(x) === al));
	};
	const encaja = (id) => (fuera.get(id) ?? 0) < .3;
	const NIVELES = [
		[
			true,
			4,
			10
		],
		[
			true,
			2,
			6
		],
		[
			true,
			1,
			3
		],
		[
			true,
			0,
			0
		],
		[
			false,
			4,
			10
		],
		[
			false,
			0,
			0
		]
	];
	const out = [];
	let lastArtist = normalize(seeds[0].t.artist);
	while (out.length < n) {
		const hist = [...seedIds, ...out];
		let pool = [];
		for (const [estilo, a, al] of NIVELES) {
			pool = scored.filter(([id]) => !out.includes(id) && (!estilo || encaja(id)) && allowed(id, hist, a, al)).slice(0, 15);
			if (pool.length) break;
		}
		if (!pool.length) break;
		const recent = hist.slice(-6).map(artistOf);
		const weights = pool.map(([id, s]) => {
			const a = artistOf(id);
			const times = recent.filter((r) => r === a).length;
			return Math.exp(s / .12) * (a === lastArtist ? .25 : 1) * Math.pow(.45, times);
		});
		let r = Math.random() * weights.reduce((x, y) => x + y, 0);
		let i = 0;
		while (i < pool.length - 1 && (r -= weights[i]) > 0) i++;
		const id = pool[i][0];
		out.push(id);
		lastArtist = artistOf(id);
	}
	return out;
}
/**
* Radio de una canción (como YT Music al tocar una canción): `n` canciones que siguen el estilo, cada una
* elegida mirando las últimas que van sonando, así la lista se mueve poco a poco y sin saltos raros.
*/
function radioChain(m, seedId, n) {
	const chain = [seedId];
	const exclude = new Set(chain);
	for (let i = 0; i < n; i++) {
		const [id] = radio(m, chain, exclude, 1);
		if (!id) break;
		chain.push(id);
		exclude.add(id);
	}
	return chain.slice(1);
}
const colabCache = /* @__PURE__ */ new WeakMap();
/** Qué tanto apuntan tus canciones favoritas a cada otra canción, según quienes escuchan lo mismo (0–1). */
function colabDe(m) {
	let c = colabCache.get(m);
	if (c) return c;
	c = /* @__PURE__ */ new Map();
	const vecinos = m.input.vecinos;
	if (vecinos?.size) {
		const favoritas = heardIds(m).sort((a, b) => (m.baseAffinity.get(b) ?? 0) - (m.baseAffinity.get(a) ?? 0)).slice(0, 50);
		for (const id of favoritas) for (const [v, s] of vecinos.get(id) ?? []) c.set(v, (c.get(v) ?? 0) + s);
		let max = 0;
		for (const v of c.values()) max = Math.max(max, v);
		if (max > 0) for (const [k, v] of c) c.set(k, v / max);
	}
	colabCache.set(m, c);
	return c;
}
/** Qué tan juntas pone YouTube Music a dos canciones (0–1), en cualquier sentido. */
function ytmEntre(m, a, b) {
	const y = m.input.ytm;
	if (!y?.size) return 0;
	return Math.max(y.get(a)?.get(b) ?? 0, y.get(b)?.get(a) ?? 0);
}
/**
* Cuánto confía TU cuenta en YouTube Music (0,75–1,2), aprendido de cómo reaccionas en la radio: si terminas más
* las que propuso YouTube Music que las del algoritmo propio, pesa más; si las saltas más, pesa menos. Nunca baja
* de 0,75: YouTube Music sigue mandando para que la radio sea coherente.
*/
function confianzaEnYoutube(m) {
	let aY = 0;
	let eY = 0;
	let aE = 0;
	let eE = 0;
	for (const r of m.input.resultados ?? []) if (r.motivo === "youtube") r.exito ? aY++ : eY++;
	else if (r.motivo === "radio") r.exito ? aE++ : eE++;
	const tasaE = (aE + 3) / (aE + eE + 4);
	const tasaY = (aY + 6 * tasaE) / (aY + eY + 6);
	return Math.max(.75, Math.min(1.2, 1 + 1.5 * (tasaY - tasaE)));
}
/** De dónde salió una canción de la radio, para aprender: "youtube" si YouTube Music la pone cerca de la semilla. */
function motivoRadio(m, semilla, id) {
	return ytmEntre(m, semilla, id) >= .3 ? "youtube" : "radio";
}
const ytmCache = /* @__PURE__ */ new WeakMap();
/**
* Lo que YouTube Music recomienda a partir de lo TUYO DE AHORA (0–1): lo último que escuchaste entero, lo que
* buscaste y tocaste, y tus favoritas de siempre (pesan menos). Así lo nuevo que te gusta cambia el feed pronto.
*/
function ytmTuyo(m) {
	let c = ytmCache.get(m);
	if (c) return c;
	c = /* @__PURE__ */ new Map();
	const y = m.input.ytm;
	if (y?.size) {
		const tuyas = heardIds(m);
		const semillas = /* @__PURE__ */ new Map();
		const poner = (id, w) => semillas.set(id, Math.max(semillas.get(id) ?? 0, w));
		[...tuyas].sort((a, b) => (m.stats.get(b)?.lastPlayed ?? 0) - (m.stats.get(a)?.lastPlayed ?? 0)).slice(0, 25).forEach((id, i) => poner(id, 1 - .5 * i / 25));
		(m.input.buscadas ?? []).filter((id) => m.byId.has(id) && m.input.ratings[id] !== -1).forEach((id, i) => poner(id, .9 - .04 * i));
		[...tuyas].sort((a, b) => (m.baseAffinity.get(b) ?? 0) - (m.baseAffinity.get(a) ?? 0)).slice(0, 25).forEach((id) => poner(id, .45));
		for (const [s, w] of semillas) for (const [v, x] of y.get(s) ?? []) c.set(v, (c.get(v) ?? 0) + w * x);
		let max = 0;
		for (const v of c.values()) max = Math.max(max, v);
		if (max > 0) for (const [k, v] of c) c.set(k, v / max);
	}
	ytmCache.set(m, c);
	return c;
}
const HUECO_SESION = 18e5;
const sesionCache = /* @__PURE__ */ new WeakMap();
/** Lo que pasó en tu sesión actual: termina cuando hubo más de 30 minutos sin escuchar nada. */
function sesionDe(m) {
	let s = sesionCache.get(m);
	if (s) return s;
	s = {
		buenas: [],
		malas: [],
		saltadas: /* @__PURE__ */ new Set(),
		artistasSaltados: /* @__PURE__ */ new Map()
	};
	const plays = m.input.plays;
	let siguiente = m.input.now;
	for (let i = plays.length - 1, vistos = 0; i >= 0 && vistos < 15; i--, vistos++) {
		const p = plays[i];
		if (siguiente - (p.startedAt + (p.listened || 0) * 1e3) > HUECO_SESION) break;
		siguiente = p.startedAt;
		const t = m.byId.get(p.trackId);
		if (!t) continue;
		if (p.skipped) {
			s.saltadas.add(t.id);
			const k = normalize(t.artist);
			s.artistasSaltados.set(k, (s.artistasSaltados.get(k) ?? 0) + 1);
			if (s.malas.length < 3) s.malas.push(t);
		} else if (p.completed && s.buenas.length < 3) s.buenas.push(t);
	}
	sesionCache.set(m, s);
	return s;
}
/** Azar repetible: con la misma semilla sale siempre lo mismo. */
function azarDe(semilla) {
	let h = 2166136261;
	for (let i = 0; i < semilla.length; i++) h = Math.imul(h ^ semilla.charCodeAt(i), 16777619);
	return () => {
		h = h + 1831565813 | 0;
		let x = Math.imul(h ^ h >>> 15, 1 | h);
		x = x + Math.imul(x ^ x >>> 7, 61 | x) ^ x;
		return ((x ^ x >>> 14) >>> 0) / 4294967296;
	};
}
/** Una apuesta según aciertos y errores: con pocos datos varía mucho (explora); con muchos, se afirma. */
function apuesta(azar, aciertos, errores) {
	const a = 1 + Math.min(40, aciertos);
	const b = 1 + Math.min(40, errores);
	return Array.from({ length: a + b - 1 }, azar).sort((x, y) => x - y)[a - 1];
}
const familiaPrincipal = (v) => FAMILY_KEYS[v.indexOf(Math.max(...v))];
/** Por cada familia de género, cuánto conviene apostar por ella contigo según cómo te fue antes. */
function apuestasPorFamilia(m, azar) {
	const cuenta = /* @__PURE__ */ new Map();
	for (const r of m.input.resultados ?? []) {
		const t = m.byId.get(r.trackId);
		const f = t && familiesOf(m, t);
		if (!f) continue;
		const k = familiaPrincipal(f);
		const c = cuenta.get(k) ?? [0, 0];
		c[r.exito ? 0 : 1]++;
		cuenta.set(k, c);
	}
	return new Map(FAMILY_KEYS.map((k) => [k, apuesta(azar, cuenta.get(k)?.[0] ?? 0, cuenta.get(k)?.[1] ?? 0)]));
}
const MIN_PARA_LISTAS = 15;
const porAfinidad = (m, ids) => [...ids].sort((a, b) => (m.baseAffinity.get(b) ?? 0) - (m.baseAffinity.get(a) ?? 0));
/** Intercala `extra` cada cierta distancia dentro de `base`, sin pasar de `n`. */
function intercalar(base, extra, n) {
	const out = [...base];
	const paso = extra.length ? Math.max(2, Math.floor(n / extra.length)) : 1;
	extra.forEach((x, i) => out.splice(Math.min(paso * i + paso - 1, out.length), 0, x));
	return out.slice(0, n);
}
/**
* Descubrimiento semanal: canciones que nunca escuchaste. La mayoría calza con tus estilos y una parte explora
* estilos cercanos. Esa parte crece o se achica según cómo reaccionas a lo que se te propone.
* null = todavía hay poco historial para armarla.
*/
function descubrimientoSemanal(m, n, semilla, evitar = /* @__PURE__ */ new Set()) {
	const mias = porAfinidad(m, heardIds(m));
	if (mias.length < MIN_PARA_LISTAS) return null;
	const azar = azarDe(semilla);
	const seeds = mias.slice(0, 12).map((id) => m.byId.get(id));
	const colab = colabDe(m);
	const familias = apuestasPorFamilia(m, azar);
	const gusto = tasteShares(m);
	let aciertos = 0;
	let errores = 0;
	for (const r of m.input.resultados ?? []) if (r.motivo === "explora") r.exito ? aciertos++ : errores++;
	const parte = clamp01(Math.max(.1, Math.min(.35, apuesta(azar, aciertos, errores + 2))));
	const cuantas = Math.round(n * parte);
	const propias = [];
	const lejanas = [];
	for (const t of m.input.tracks) {
		if (m.stats.has(t.id) || m.input.ratings[t.id] !== void 0 || isTestSilence(m, t.id) || !categoriaPermitida(m, t)) continue;
		let sim = 0;
		for (const s of seeds) sim = Math.max(sim, similarity(m, s, t));
		const fit = styleFit(m, t);
		const c = colab.get(t.id) ?? 0;
		const f = familiesOf(m, t);
		const fam = f ? (familias.get(familiaPrincipal(f)) ?? .5) - .5 : 0;
		const exito = t.exito?.valor ?? 0;
		const repetida = evitar.has(t.id) ? .6 : 0;
		if (fit === null || fit >= .5) propias.push([t.id, sim + .3 * (fit ?? 0) + .5 * c + .12 * exito + .2 * fam + .2 * azar() - repetida]);
		else if (sim >= .1 && f && gusto && (c >= .2 || emparentadas(gusto, f))) lejanas.push([t.id, sim + .3 * Math.max(t.pop ?? .25, exito) + .3 * fam + .25 * azar() - repetida]);
	}
	const orden = (l) => variedadDeAnios(m, l.sort((a, b) => b[1] - a[1]).slice(0, 300).map(([id]) => id), n, .4);
	const explora = diverse(m, orden(lejanas), cuantas, 1);
	const base = diverse(m, orden(propias), n - explora.length, 1);
	const motivoDe = (id) => explora.includes(id) ? "explora" : (colab.get(id) ?? 0) >= .2 ? "colab" : "parecido";
	return intercalar(base, explora, n).map((id) => ({
		id,
		motivo: motivoDe(id)
	}));
}
/** Que ninguna década pase de `max` de la lista: las que sobran van al final (por si no alcanza). */
function variedadDeAnios(m, ids, n, max) {
	const tope = Math.max(2, Math.ceil(n * max));
	const cuenta = /* @__PURE__ */ new Map();
	const out = [];
	const despues = [];
	for (const id of ids) {
		const y = m.byId.get(id)?.year;
		if (!y) {
			out.push(id);
			continue;
		}
		const d = Math.floor(y / 10);
		const c = cuenta.get(d) ?? 0;
		if (c >= tope) despues.push(id);
		else {
			cuenta.set(d, c + 1);
			out.push(id);
		}
	}
	return [...out, ...despues];
}
const escenasCache = /* @__PURE__ */ new WeakMap();
/** Las escenas dependen solo del catálogo: se calculan una vez, no por cada cuenta. */
function escenasDe(m) {
	let e = escenasCache.get(m.input.tracks);
	if (!e) escenasCache.set(m.input.tracks, e = clasificarEscenas(m.input.tracks));
	return e;
}
/** Como `diverse`, pero sin rellenar: si no hay suficientes artistas, la lista queda más corta. */
function conLimiteArtista(m, ids, n, porArtista) {
	const cuenta = /* @__PURE__ */ new Map();
	const out = [];
	for (const id of ids) {
		const k = normalize(m.byId.get(id)?.artist ?? "");
		const c = cuenta.get(k) ?? 0;
		if (c >= porArtista) continue;
		cuenta.set(k, c + 1);
		out.push(id);
		if (out.length >= n) break;
	}
	return out;
}
const MIN_DIARIO = 12;
/**
* Mixes diarios: uno por cada escena que más escuchas (hasta 3). Una escena es estilo + época + sonido (ver
* escenas.ts), así Electrónica actual no se mezcla con disco de los 70. Llevan canciones tuyas y casi la mitad
* nuevas de esa misma escena, distintas cada día; si no alcanza, la lista queda corta o no aparece. null = poco historial todavía.
*/
function mixesDiarios(m, n, semilla, evitar = /* @__PURE__ */ new Set()) {
	const mias = heardIds(m);
	if (mias.length < MIN_PARA_LISTAS) return null;
	const azar = azarDe(semilla);
	const colab = colabDe(m);
	const escenas = escenasDe(m);
	const tuyas = /* @__PURE__ */ new Map();
	let total = 0;
	for (const id of mias) {
		const e = escenas.get(id);
		if (!e) continue;
		const peso = (m.stats.get(id)?.completes ?? 0) + (m.input.ratings[id] === 1 ? 2 : 0);
		const x = tuyas.get(e.id) ?? {
			e,
			peso: 0,
			ids: []
		};
		x.peso += peso;
		x.ids.push(id);
		tuyas.set(e.id, x);
		total += peso;
	}
	const principales = [...tuyas.values()].filter((x) => x.ids.length >= 4 && x.peso / total >= .1).sort((a, b) => b.peso - a.peso);
	const out = [];
	for (const { e, ids: suyas } of principales) {
		if (out.length >= 3) break;
		const conocidas = conLimiteArtista(m, suyas.map((id) => [id, (m.baseAffinity.get(id) ?? 0) + .8 * azar() - (evitar.has(id) ? .8 : 0)]).sort((a, b) => b[1] - a[1]).map(([id]) => id), Math.ceil(n * .55), 3);
		const seeds = conocidas.slice(0, 5).map((id) => m.byId.get(id));
		const nuevas = [];
		for (const t of m.input.tracks) {
			if (escenas.get(t.id)?.id !== e.id || m.stats.has(t.id) || m.input.ratings[t.id] !== void 0 || isTestSilence(m, t.id)) continue;
			let sim = 0;
			for (const s of seeds) sim = Math.max(sim, similarity(m, s, t));
			nuevas.push([t.id, sim + .5 * (colab.get(t.id) ?? 0) + .1 * (t.exito?.valor ?? 0) + .25 * azar() - (evitar.has(t.id) ? 1 : 0)]);
		}
		const ids = conLimiteArtista(m, nuevas.sort((a, b) => b[1] - a[1]).map(([id]) => id), n - conocidas.length, 2);
		if (conocidas.length + ids.length < MIN_DIARIO) continue;
		const items = intercalar(conocidas.map((id) => ({
			id,
			motivo: "conocida"
		})), ids.map((id) => ({
			id,
			motivo: (colab.get(id) ?? 0) >= .2 ? "colab" : "parecido"
		})), n);
		out.push({
			titulo: `Mix diario: ${e.nombre}`,
			items
		});
	}
	return out;
}
/**
* Tu perfil: los estilos y la época de lo que más escuchas y te gusta. Sirve para desempatar
* búsquedas: si buscas "Dynamite" y escuchas k-pop, primero BTS; si escuchas los 80, Jermaine Jackson.
*/
function buildTaste(m) {
	const aff = [...m.baseAffinity.entries()];
	const vals = aff.map(([, v]) => v);
	const lo = Math.min(...vals);
	const hi = Math.max(...vals);
	const norm = (v) => hi > lo ? (v - lo) / (hi - lo) : .5;
	const top = aff.filter(([id]) => (m.stats.get(id)?.completes ?? 0) > 0 || m.input.ratings[id] === 1).sort((a, b) => b[1] - a[1]).slice(0, 25);
	let fam = null;
	const years = [];
	for (const [id, v] of top) {
		const t = m.byId.get(id);
		if (!t) continue;
		const w = .3 + norm(v);
		const f = familiesOf(m, t);
		if (f) {
			const len = Math.sqrt(f.reduce((a, b) => a + b * b, 0)) || 1;
			fam ??= f.map(() => 0);
			f.forEach((x, i) => fam[i] += w * x / len);
		}
		if (t.year) years.push({
			y: t.year,
			w
		});
	}
	const wsum = years.reduce((a, b) => a + b.w, 0);
	const year = wsum ? years.reduce((a, b) => a + b.y * b.w, 0) / wsum : null;
	const spread = year !== null && wsum ? Math.sqrt(years.reduce((a, b) => a + b.w * (b.y - year) ** 2, 0) / wsum) : 15;
	return {
		families: fam,
		year,
		yearSpread: Math.max(6, spread),
		affinity: (id) => norm(m.baseAffinity.get(id) ?? lo)
	};
}
/** Qué tanto encaja una canción con tu perfil (0–1): estilo, época y cuánto te gusta. */
function tasteScore(m, taste, t) {
	let s = 0;
	const f = familiesOf(m, t);
	if (f && taste.families) s += .45 * cosine(f, taste.families);
	if (t.year && taste.year !== null) s += .3 * Math.exp(-(((t.year - taste.year) / taste.yearSpread) ** 2) / 2);
	s += .25 * taste.affinity(t.id);
	return s;
}
// src/reco/buscar.ts
/**
* Buscador (lo usa el SERVIDOR: la app solo muestra lo que él devuelve). Busca con tolerancia a errores
* ("freddy mercury" encuentra a Queen) y, entre resultados que coinciden parecido, ordena por tus gustos.
*/
/** Cuánto pesa tu perfil al ordenar: decide entre resultados que coinciden parecido (p. ej. dos "Dynamite"). */
const TASTE_WEIGHT = .35;
/** El índice de cada lista se arma una vez (si el catálogo se rehace, la lista es otra y se arma solo). */
const indices = /* @__PURE__ */ new WeakMap();
/**
* Puntúa solo los que pueden coincidir (mismo resultado que revisar la lista entera). Con `soloExactos`, solo
* los que coinciden sin errores de tipeo (ver `candidatosExactos`).
*/
function puntuar(query, items, fields, soloExactos) {
	let ind = indices.get(items);
	if (!ind) indices.set(items, ind = crearIndice(items.map(fields)));
	const out = [];
	for (const pos of soloExactos ? candidatosExactos(ind, query) : candidatos(ind, query)) {
		const item = items[pos];
		const f = fields(item);
		const text = fuzzyScore(query, f);
		if (text > 0) out.push({
			item,
			pos,
			text,
			exacto: soloExactos || exactMatch(query, f)
		});
	}
	return out;
}
/**
* Los `limit` mejores por texto + gusto. Si `soloExactos`, los parecidos (posibles errores de tipeo) se dejan
* fuera. El gusto vale entre 0 y 1, así que se recorre de mayor a menor texto y se para cuando ni con el gusto
* máximo alguien podría entrar: con "t" coinciden miles, pero el gusto solo se calcula para unas decenas.
*/
function mejores(l, soloExactos, limit, taste) {
	const orden = l.filter((r) => !soloExactos || r.exacto).sort((a, b) => b.text - a.text || a.pos - b.pos);
	const top = [];
	const antes = (a, b) => b.score - a.score || a.pos - b.pos;
	for (const r of orden) {
		if (top.length >= limit && r.text + TASTE_WEIGHT < top[limit - 1].score) break;
		const x = {
			item: r.item,
			pos: r.pos,
			score: r.text + TASTE_WEIGHT * taste(r.item)
		};
		let i = top.length;
		while (i > 0 && antes(x, top[i - 1]) < 0) i--;
		if (i < limit) {
			top.splice(i, 0, x);
			if (top.length > limit) top.pop();
		}
	}
	return top.map((r) => r.item);
}
/** Cada integrante del grupo como un campo aparte (así un nombre no se mezcla con el de al lado). */
function integrantes(tracks) {
	const set = /* @__PURE__ */ new Set();
	for (const t of tracks.slice(0, 30)) for (const m of t.members ?? []) set.add(m);
	return [...set].map((text) => ({
		text,
		weight: .75
	}));
}
/**
* Los campos de cada artista, álbum y canción se arman una sola vez (no en cada letra que escribes).
* Se guardan por objeto: si el catálogo se rehace, son objetos nuevos y se vuelven a armar solos.
*/
const camposGuardados = /* @__PURE__ */ new WeakMap();
function campos(x, armar) {
	let f = camposGuardados.get(x);
	if (!f) camposGuardados.set(x, f = armar(x));
	return f;
}
/**
* El perfil de gustos se calcula una vez por modelo (no en cada letra que escribes), y también lo que te gusta
* cada canción, álbum o artista: al pasar de "c" a "ca" casi todos ya vienen calculados.
*/
const tastes = /* @__PURE__ */ new WeakMap();
function tasteDe(m) {
	let t = tastes.get(m);
	if (!t) tastes.set(m, t = {
		taste: buildTaste(m),
		puntajes: /* @__PURE__ */ new WeakMap()
	});
	return t;
}
function recordado(memo, x, calc) {
	if (!memo) return calc(x);
	let s = memo.get(x);
	if (s === void 0) memo.set(x, s = calc(x));
	return s;
}
function buscarTodo(q, lib, model) {
	if (!q.trim()) return {
		artists: [],
		albums: [],
		tracks: []
	};
	const gusto = model ? tasteDe(model) : null;
	const memo = gusto?.puntajes;
	const tScore = (t) => model && gusto ? recordado(memo, t, (x) => tasteScore(model, gusto.taste, x)) : 0;
	const groupScore = (g) => recordado(memo, g, (x) => x.tracks.length ? Math.max(...x.tracks.slice(0, 20).map(tScore)) : 0);
	const fArtista = (a) => campos(a, (x) => [{
		text: x.name,
		weight: 1
	}, ...integrantes(x.tracks)]);
	const fAlbum = (a) => campos(a, (x) => [{
		text: x.name,
		weight: 1
	}, {
		text: x.artist,
		weight: .8
	}]);
	const fCancion = (t) => campos(t, (x) => [
		{
			text: x.title,
			weight: 1
		},
		{
			text: x.artist,
			weight: .8
		},
		{
			text: x.album,
			weight: .6
		},
		...integrantes([x])
	]);
	let artists = puntuar(q, lib.artists, fArtista, true);
	let albums = puntuar(q, lib.albums, fAlbum, true);
	let tracks = puntuar(q, lib.tracks, fCancion, true);
	const hayExactos = artists.length > 0 || albums.length > 0 || tracks.length > 0;
	if (!hayExactos) {
		artists = puntuar(q, lib.artists, fArtista, false);
		albums = puntuar(q, lib.albums, fAlbum, false);
		tracks = puntuar(q, lib.tracks, fCancion, false);
	}
	return {
		artists: mejores(artists, hayExactos, 4, groupScore).map((a) => a.name),
		albums: mejores(albums, hayExactos, 8, groupScore).map((a) => a.key),
		tracks: mejores(tracks, hayExactos, 50, tScore).map((t) => t.id)
	};
}
// src/reco/consulta.ts
const re = (r) => (g) => r.test(g);
const URBANO = /hip hop|\brap\b|trap|reggaeton|urbano latino|latin urban|dembow|k pop|korean/;
/** Orden importante: los nombres largos primero ("rock en español" antes que "rock", "k-pop" antes que "pop"). */
const ESTILOS = [
	{
		id: "reggaeton",
		nombre: "Reggaetón",
		alias: /\b(reggaeton|regueton|reggueton|reggeton|regeton|reguetton|reggaetton|perreo|urbano latino|musica urbana)\b/,
		tags: re(/reggaeton|urbano latino|latin urban|dembow|perreo|trap latino|latin trap/),
		viejo: [1990, 2009],
		nombreViejo: "Reggaetón old school"
	},
	{
		id: "rock-espanol",
		escenas: ["rock-espanol"],
		nombre: "Rock en español",
		alias: /\brock (en )?espanol\b|\brock (latino|nacional|chileno|argentino)\b/,
		tags: re(/rock en espanol|rock latino|latin rock|rock nacional|rock chileno|rock argentino/)
	},
	{
		id: "pop-punk",
		nombre: "Pop punk",
		alias: /\bpop punk\b/,
		tags: re(/pop punk|emo/)
	},
	{
		id: "pop-latino",
		escenas: ["pop-latino"],
		nombre: "Pop latino",
		alias: /\bpop (latino|en espanol)\b|\blatin pop\b/,
		tags: re(/latin pop|pop latino|pop en espanol/),
		sin: re(/reggaeton|urbano latino/)
	},
	{
		id: "kpop",
		escenas: ["kpop"],
		nombre: "K-pop",
		alias: /\bk ?pop\b|\bcorean[oa]s?\b/,
		tags: re(/k pop|korean/)
	},
	{
		id: "jpop",
		nombre: "J-pop",
		alias: /\bj ?pop\b|\bjapones(as|es)?\b/,
		tags: re(/j pop|japanese|anisong/)
	},
	{
		id: "hiphop",
		escenas: ["hiphop-clasico", "hiphop-actual"],
		escenasViejo: ["hiphop-clasico"],
		nombre: "Hip hop",
		alias: /\bhip ?hop\b|\brap\b|\braperos?\b/,
		tags: re(/hip hop|\brap\b|gangsta|g funk|boom bap|drill/),
		sin: re(/reggaeton|urbano latino|latin trap|trap latino|k pop/),
		viejo: [1985, 2002],
		nombreViejo: "Hip hop old school"
	},
	{
		id: "trap",
		nombre: "Trap",
		alias: /\btrap\b/,
		tags: re(/\btrap\b|rage|drill/),
		sin: re(/reggaeton|urbano latino|latin trap|trap latino/)
	},
	{
		id: "rnb",
		escenas: ["rnb"],
		nombre: "R&B",
		alias: /\brnb\b/,
		tags: re(/\br&b\b|\brnb\b|^r b$|new jack swing|neo soul|quiet storm/),
		viejo: [1986, 2005]
	},
	{
		id: "soul",
		escenas: ["soul"],
		nombre: "Soul y funk",
		alias: /\bsoul\b|\bfunk\b|\bmotown\b/,
		tags: re(/\bsoul\b|\bfunk\b|motown/),
		sin: re(/neo soul/)
	},
	{
		id: "metal",
		escenas: ["metal"],
		nombre: "Metal",
		alias: /\bmetal\b|\bmetaleros?\b/,
		tags: re(/metal/)
	},
	{
		id: "grunge",
		nombre: "Grunge",
		alias: /\bgrunge\b/,
		tags: re(/grunge/)
	},
	{
		id: "punk",
		nombre: "Punk",
		alias: /\bpunk\b/,
		tags: re(/\bpunk\b/),
		sin: re(/post punk/)
	},
	{
		id: "indie",
		escenas: ["indie-pop", "indie-rock"],
		nombre: "Indie",
		alias: /\bindie\b/,
		tags: re(/indie|dream pop|bedroom pop|chamber pop/),
		sin: re(URBANO)
	},
	{
		id: "rock",
		escenas: [
			"rock-clasico",
			"rock-alternativo",
			"indie-rock",
			"rock-espanol"
		],
		escenasViejo: ["rock-clasico"],
		nombre: "Rock",
		alias: /\brock\b|\brockeras?\b|\brockeros?\b/,
		tags: (g) => /\brock\b|grunge|britpop|\bpunk\b|\baor\b/.test(g) && !/pop rock|soft rock|^pop$/.test(g),
		sin: re(/dance pop|teen pop|k pop|reggaeton|hip hop|\brap\b/),
		viejo: [1967, 1989],
		nombreViejo: "Rock clásico"
	},
	{
		id: "disco",
		escenas: ["disco"],
		nombre: "Disco",
		alias: /\bdisco\b/,
		tags: re(/disco|hi nrg|boogie/)
	},
	{
		id: "synth",
		escenas: ["synth"],
		nombre: "Synth pop y new wave",
		alias: /\bsynth ?pop\b|\bsynth\b|\bnew wave\b/,
		tags: re(/synth ?pop|new wave|new romantic/)
	},
	{
		id: "house",
		nombre: "House",
		alias: /\bhouse\b/,
		tags: re(/house/),
		sin: re(URBANO)
	},
	{
		id: "techno",
		nombre: "Techno",
		alias: /\btechno\b|\btecno\b/,
		tags: re(/techno/)
	},
	{
		id: "trance",
		nombre: "Trance",
		alias: /\btrance\b/,
		tags: re(/trance/)
	},
	{
		id: "eurodance",
		nombre: "Eurodance",
		alias: /\beurodance\b|\beuro dance\b/,
		tags: re(/eurodance|euro house|italo dance|europop/),
		sonido: (v) => v.electronica >= .3
	},
	{
		id: "electronica",
		escenas: ["electronica-actual", "club-clasico"],
		escenasViejo: ["club-clasico"],
		nombre: "Electrónica",
		alias: /\belectronic[ao]s?\b|\bedm\b|\belectro\b|\bdubstep\b|\bdrum (and|n) bass\b/,
		tags: re(/electronic|\bedm\b|house|techno|trance|dubstep|drum and bass|jungle|\belectro\b|electro house|eurodance|big room|hardstyle|future bass|club/),
		sin: re(URBANO),
		sonido: (v) => v.electronica >= .35,
		viejo: [1988, 2007],
		nombreViejo: "Electrónica clásica"
	},
	{
		id: "anime",
		nombre: "Anime",
		alias: /\banimes?\b|\banisong\b/,
		categoria: "anime"
	},
	{
		id: "videojuegos",
		nombre: "Videojuegos",
		alias: /\bvideo ?juegos?\b|\bvideo ?games?\b|\bgaming\b|\bgamer\b|\bost\b|\bjuegos\b/,
		categoria: "ost-videojuego"
	},
	{
		id: "memes",
		nombre: "Memes",
		alias: /\bmemes?\b/,
		categoria: "meme"
	},
	{
		id: "cumbia",
		nombre: "Cumbia",
		alias: /\bcumbias?\b/,
		tags: re(/cumbia/)
	},
	{
		id: "salsa",
		nombre: "Salsa",
		alias: /\bsalsa\b/,
		tags: re(/salsa/)
	},
	{
		id: "bachata",
		nombre: "Bachata",
		alias: /\bbachatas?\b/,
		tags: re(/bachata/)
	},
	{
		id: "merengue",
		nombre: "Merengue",
		alias: /\bmerengues?\b/,
		tags: re(/merengue/)
	},
	{
		id: "tropical",
		nombre: "Música tropical",
		alias: /\btropical\b/,
		tags: re(/tropical|cumbia|salsa|merengue|bachata/),
		sin: re(/tropical house/)
	},
	{
		id: "corridos",
		nombre: "Regional mexicano",
		alias: /\bcorridos?\b|\bregional mexicano\b|\bmariachi\b|\brancheras?\b/,
		tags: re(/corrido|regional mexican|mariachi|norteno|ranchera/)
	},
	{
		id: "reggae",
		nombre: "Reggae",
		alias: /\breggae\b/,
		tags: re(/\breggae\b|dancehall|\bska\b/),
		sin: re(/reggaeton/)
	},
	{
		id: "baladas",
		escenas: ["baladas"],
		nombre: "Baladas",
		alias: /\bbaladas?\b|\bromantic[ao]s?\b|\blentas\b/,
		tags: re(/ballad|balada|soft rock|adult contemporary|bolero|quiet storm/),
		sin: re(/metal|hard rock|punk/)
	},
	{
		id: "jazz",
		escenas: ["jazz"],
		nombre: "Jazz",
		alias: /\bjazz\b/,
		tags: re(/jazz|bossa nova/)
	},
	{
		id: "blues",
		nombre: "Blues",
		alias: /\bblues\b/,
		tags: re(/blues/)
	},
	{
		id: "country",
		escenas: ["country"],
		nombre: "Country y folk",
		alias: /\bcountry\b|\bfolk\b/,
		tags: re(/country|americana|bluegrass|\bfolk\b/),
		sin: re(/folk rock|k pop/)
	},
	{
		id: "lofi",
		nombre: "Lo-fi",
		alias: /\blo ?fi\b|\bchill ?hop\b/,
		tags: re(/lo fi|chillhop|chill hop/)
	},
	{
		id: "soundtrack",
		nombre: "Bandas sonoras",
		alias: /\bpeliculas?\b|\bsoundtracks?\b|\bbandas? sonoras?\b/,
		tags: re(/soundtrack|movie|film/)
	},
	{
		id: "latino",
		nombre: "Música latina",
		alias: /\blatin[oa]s?\b|\ben espanol\b|\bespanol\b/,
		tags: re(/latin|en espanol|tropical|reggaeton|urbano latino|salsa|cumbia|bachata|merengue|spanish/)
	},
	{
		id: "pop",
		escenas: [
			"pop-clasico",
			"pop-actual",
			"synth"
		],
		nombre: "Pop",
		alias: /\bpop\b/,
		tags: (g) => /\bpop\b/.test(g) && !/k pop|j pop|latin|pop rap|pop punk/.test(g),
		sin: re(/reggaeton|urbano latino|hip hop|\brap\b|\btrap\b|k pop|korean|metal/),
		viejo: [1980, 1999]
	}
];
const ANIMOS = [
	{
		id: "fiesta",
		alias: /\bfiestas?\b|\bfiester[ao]s?\b|\bcarretes?\b|\bparty\b|\bprevia\b/,
		texto: "para la fiesta",
		vale: (v) => v.fiesta >= .5
	},
	{
		id: "triste",
		alias: /\btristes?\b|\bsad\b|\bllorar\b|\bdespecho\b|\bdepre\b/,
		texto: "tristes",
		vale: (v) => v.triste >= .5
	},
	{
		id: "relajada",
		alias: /\bchill\b|\brelajad[ao]s?\b|\brelajarse\b|\brelax\b|\btranquil[ao]s?\b|\bcalma\b|\bestudiar\b|\bdormir\b/,
		texto: "para relajarse",
		vale: (v) => v.relajada >= .5
	},
	{
		id: "bailar",
		alias: /\bbailar\b|\bbailables?\b|\bbailando\b/,
		texto: "para bailar",
		vale: (v) => v.bailable >= .55
	},
	{
		id: "entrenar",
		alias: /\bentrenar\b|\bgym\b|\bgimnasio\b|\bworkout\b|\bejercicio\b|\bcorrer\b|\bentrenamiento\b/,
		texto: "para entrenar",
		vale: (v) => v.relajada < .4 && v.triste < .4 && v.acustica < .5 && (v.agresiva >= .55 || v.fiesta >= .6 && v.bailable >= .6)
	},
	{
		id: "feliz",
		alias: /\bfeli(z|ces)\b|\balegres?\b|\bhappy\b|\bbuena onda\b/,
		texto: "alegres",
		vale: (v) => v.feliz >= .5
	}
];
const EXITOS = /\b(hits?|exitos?|popular(es)?|famosas?|famosos?|conocidas?|conocidos?|mejores|mejor|greatest|best|top( \d+)?|clasicos?|clasicas?)\b/g;
const CLASICO = /\b(clasicos?|clasicas?)\b/;
const VIEJO = /\b(viejos?|viejas?|antiguos?|antiguas?|old ?school|old|de antes|vieja escuela|retro|del ayer)\b/g;
const NUEVO = /\b(nuevos?|nuevas?|actual(es)?|recientes?|new|de ahora|del momento|ultim[ao]s?)\b/g;
const RELLENO = new Set("de del los las la el lo y e en para con songs song canciones cancion musica music mix lista playlist anos ano decada the of from temas tema mas a al era epoca tipo estilo genero generos puro pura solo onda s and un una que in".split(" "));
/** Texto comparable: minúsculas, sin acentos, "r&b" = "rnb", "80's" = "80s". */
const normalizarConsulta = (q) => q.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/['’´`]/g, "").replace(/\br\s*(&|and|n|y)\s*b\b|\br b\b/g, " rnb ").replace(/[^\p{L}\p{N}\s-]/gu, " ").replace(/-/g, " ").replace(/\s+/g, " ").trim();
const decada = (d) => [d, d + 9];
const PALABRAS_DECADA = [
	[/\bcincuentas?\b/g, 1950],
	[/\bsesentas?\b|\bsesenter[ao]s?\b/g, 1960],
	[/\bsetentas?\b|\bsetenter[ao]s?\b/g, 1970],
	[/\bochentas?\b|\bochenter[ao]s?\b/g, 1980],
	[/\bnoventas?\b|\bnoventer[ao]s?\b/g, 1990],
	[/\bdos ?mil\b/g, 2e3]
];
/** ¿Esta búsqueda pide una lista? Devuelve qué lista, o null si es una búsqueda normal. */
function interpretarBusqueda(q, anioActual = (/* @__PURE__ */ new Date()).getFullYear()) {
	let s = ` ${normalizarConsulta(q)} `;
	if (s.trim().length < 2) return null;
	const quitar = (r) => {
		let hubo = false;
		s = s.replace(r, () => {
			hubo = true;
			return " ";
		});
		return hubo;
	};
	let era = null;
	const rango = /\b(19[5-9]\d|20[0-3]\d)\s*(?:a|al|hasta|to)?\s+(19[5-9]\d|20[0-3]\d)\b/.exec(s);
	if (rango) {
		const [a, b] = [+rango[1], +rango[2]].sort((x, y) => x - y);
		era = [a, b];
		s = s.replace(rango[0], " ");
	}
	if (!era) {
		const m = /\b(?:los |anos |decada (?:de )?(?:los )?)?(19[5-9]0|20[0-3]0) ?s\b|\b(?:los|anos|decada(?: de)?(?: los)?) (19[5-9]0|20[0-3]0)\b/.exec(s);
		if (m) {
			era = decada(+(m[1] ?? m[2]));
			s = s.replace(m[0], " ");
		}
	}
	if (!era) {
		const m = /\b(?:los |anos )?([5-9]0|00|10|20) ?s\b|\b(?:los|anos|decada(?: de)?(?: los)?) ([5-9]0)\b/.exec(s);
		if (m) {
			const d = +(m[1] ?? m[2]);
			era = decada(d >= 50 ? 1900 + d : 2e3 + d);
			s = s.replace(m[0], " ");
		}
	}
	if (!era) {
		for (const [r, d] of PALABRAS_DECADA) if (quitar(r)) era = decada(d);
	}
	if (!era) {
		const m = /\b(19[5-9]\d|20[0-3]\d)\b/.exec(s);
		if (m && +m[1] <= anioActual) {
			era = [+m[1], +m[1]];
			s = s.replace(m[0], " ");
		}
	}
	const estilos = [];
	for (const e of ESTILOS) if (quitar(new RegExp(e.alias.source, "g"))) estilos.push(e);
	const animos = [];
	for (const a of ANIMOS) if (quitar(new RegExp(a.alias.source, "g"))) animos.push(a);
	const clasico = CLASICO.test(s);
	const exitos = quitar(EXITOS);
	const viejo = quitar(VIEJO);
	const nuevo = quitar(NUEVO);
	if (s.split(" ").some((w) => w && !RELLENO.has(w))) return null;
	if (!estilos.length && !animos.length && !era && !exitos && !viejo && !nuevo) return null;
	let desde = era?.[0];
	let hasta = era?.[1];
	let nombreEstilo = estilos.map((e) => e.nombre).join(" y ");
	const uno = estilos.length === 1 ? estilos[0] : null;
	const antiguo = (viejo || clasico) && !era;
	if (antiguo) {
		if (uno?.viejo) {
			[desde, hasta] = uno.viejo;
			nombreEstilo = uno.nombreViejo ?? `${uno.nombre} clásico`;
		} else hasta = 1999;
	} else if (nuevo && !era) {
		desde = anioActual - 3;
		if (nombreEstilo) nombreEstilo = `${nombreEstilo} actual`;
	}
	const textoEra = (() => {
		if (!era) return "";
		const [a, b] = era;
		if (a === b) return `de ${a}`;
		if (a % 10 === 0 && b === a + 9) return a < 2e3 ? `de los ${a % 100}` : `de los ${a}`;
		return `de ${a} a ${b}`;
	})();
	const minuscula = (t) => /^\p{Lu}\p{Ll}/u.test(t) ? t[0].toLowerCase() + t.slice(1) : t;
	const pidioExitos = exitos && !(clasico && uno?.viejo && antiguo);
	let titulo;
	if (nombreEstilo) titulo = pidioExitos ? `Éxitos de ${minuscula(nombreEstilo)}` : nombreEstilo;
	else if (clasico || antiguo && !exitos) titulo = "Clásicos";
	else if (exitos) titulo = "Éxitos";
	else if (nuevo) titulo = "Lo más nuevo";
	else if (era) titulo = "Lo mejor";
	else titulo = animos[0]?.texto.startsWith("para") ? "Música" : "Canciones";
	titulo = [
		titulo,
		textoEra,
		animos.map((a) => a.texto).join(" y ")
	].filter(Boolean).join(" ");
	const rangoTxt = desde && hasta ? desde === hasta ? `${desde}` : `${desde}–${hasta}` : desde ? `desde ${desde}` : hasta ? `hasta ${hasta}` : "";
	const descripcion = [
		estilos.map((e) => e.nombre).join(", "),
		rangoTxt,
		animos.map((a) => a.texto).join(", ")
	].filter(Boolean).join(" · ");
	return {
		titulo,
		descripcion,
		estilos,
		animos,
		desde,
		hasta,
		exitos: exitos || clasico || antiguo,
		viejo: !!(antiguo && uno?.viejo)
	};
}
const tagNorm = (g) => g.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[-_/]+/g, " ").replace(/\s+/g, " ").trim();
const artistaPrincipal = (a) => tagNorm(a.split(/,|\s+(?:feat\.?|ft\.?|con|with|&|y|x)\s+/i)[0] ?? a);
const perfiles = /* @__PURE__ */ new WeakMap();
function perfilDe(tracks) {
	let p = perfiles.get(tracks);
	if (p) return p;
	p = {
		tags: /* @__PURE__ */ new Map(),
		artista: /* @__PURE__ */ new Map(),
		artistas: /* @__PURE__ */ new Map(),
		cuentas: /* @__PURE__ */ new Map(),
		escena: new Map([...clasificarEscenas(tracks)].map(([id, e]) => [id, e.id]))
	};
	const anios = /* @__PURE__ */ new Map();
	for (const t of tracks) {
		p.tags.set(t.id, [...new Set(t.genres.map(tagNorm))]);
		const k = artistaPrincipal(t.artist);
		p.artista.set(t.id, k);
		const a = p.artistas.get(k) ?? { ids: [] };
		a.ids.push(t.id);
		p.artistas.set(k, a);
		if (t.year) anios.set(k, [...anios.get(k) ?? [], t.year]);
	}
	for (const [k, a] of p.artistas) {
		const l = (anios.get(k) ?? []).sort((x, y) => x - y);
		if (l.length >= 5) a.anioHabitual = l[l.length >> 1];
	}
	perfiles.set(tracks, p);
	return p;
}
/** Qué parte de las canciones del artista tiene alguna etiqueta que cumple `f`. */
function parteArtista(p, clave, artista, f) {
	let m = p.cuentas.get(clave);
	if (!m) {
		m = /* @__PURE__ */ new Map();
		for (const [k, a] of p.artistas) m.set(k, a.ids.filter((id) => p.tags.get(id).some(f)).length);
		p.cuentas.set(clave, m);
	}
	return (m.get(artista) ?? 0) / (p.artistas.get(artista)?.ids.length || 1);
}
/** Año de la canción; una reedición o recopilatorio muy posterior vale la época habitual del artista. */
function anioDe(p, t) {
	if (t.exito?.anio) return t.exito.anio;
	const y = t.year;
	const h = p.artistas.get(p.artista.get(t.id))?.anioHabitual;
	return y && h && y - h > 15 ? h : y;
}
function cumpleEstilo(p, e, t, viejo) {
	const mundo = mundoDe(t);
	if (e.categoria) return mundo.includes(e.categoria);
	if (mundo.length) return false;
	const escenas = viejo && e.escenasViejo || e.escenas;
	if (escenas) return escenas.includes(p.escena.get(t.id) ?? "");
	if (!e.tags) return false;
	const tags = p.tags.get(t.id);
	const artista = p.artista.get(t.id);
	if (e.sin && (tags.some(e.sin) || parteArtista(p, `${e.id}:sin`, artista, e.sin) >= .4)) return false;
	if (e.sonido && t.vibe && !e.sonido(t.vibe)) return false;
	if (tags.some(e.tags)) return true;
	return parteArtista(p, e.id, artista, e.tags) >= (tags.length ? .5 : .4);
}
const MIN_LISTA = 8;
/** Las canciones de la lista pedida, ordenadas para esta persona (vacía si hay muy pocas). */
function listaDeBusqueda(m, c, n = 50) {
	const p = perfilDe(m.input.tracks);
	const aff = [...m.baseAffinity.values()];
	const lo = aff.length ? Math.min(...aff) : 0;
	const hi = aff.length ? Math.max(...aff) : 0;
	const norm = (v) => hi > lo ? (v - lo) / (hi - lo) : .5;
	const puntaje = [];
	for (const t of m.input.tracks) {
		if (m.input.ratings[t.id] === -1 || isTestSilence(m, t.id)) continue;
		if (c.estilos.length ? !c.estilos.some((e) => cumpleEstilo(p, e, t, c.viejo)) : mundoDe(t).length) continue;
		if (c.desde || c.hasta) {
			const y = anioDe(p, t);
			if (!y || c.desde && y < c.desde || c.hasta && y > c.hasta) continue;
		}
		if (c.animos.length && (!t.vibe || !c.animos.every((a) => a.vale(t.vibe)))) continue;
		const enHot100 = t.genres.some((g) => /billboard|hot 100/i.test(g));
		const exito = t.exito?.valor ?? 0;
		const pop = Math.max(t.pop ?? .25, m.input.billboard.has(t.id) ? .9 : 0, enHot100 ? .8 : 0, exito ? .6 + .4 * exito : 0);
		const raro = /megamix|medley|\bmix\b|karaoke|christmas|navidad|instrumental|remix|live|en vivo|extended|demo\b/i.test(`${t.title} ${t.album}`) ? .25 : 0;
		const tuyo = norm(m.baseAffinity.get(t.id) ?? 0);
		const base = c.exitos ? .25 * tuyo + .55 * pop + .15 * exito : .45 * tuyo + .45 * pop;
		puntaje.push([t.id, base + .06 * dailyNoise(t.id, m.input.now) - raro]);
	}
	if (puntaje.length < MIN_LISTA) return [];
	puntaje.sort((a, b) => b[1] - a[1]);
	return diverse(m, puntaje.map(([id]) => id), n, c.exitos ? 2 : 3);
}
// src/library/group.ts
const collator = new Intl.Collator("es", {
	sensitivity: "base",
	numeric: true
});
/** Lo que separa a los artistas de una colaboración. */
const SEPARADOR = /\s*(?:,|;|&|\+|\bfeat\.?|\bft\.?|\bfeaturing\b|\s+x\s+|\s+y\s+|\s+and\s+|\s+with\s+|\s+con\s+|\bvs\.?)\s*/i;
/** Nombres de álbum que son bandas sonoras o recopilaciones: todas sus canciones van juntas. */
const ES_OST = /(\bost\b|\bo\.s\.t\b|soundtrack|motion picture|original (series|score|cast)|music from|banda sonora|\bbso\b|\blofi\b|lo-fi|compilation|recopilaci)/i;
/** Nombre de un álbum con artistas distintos (OST, recopilaciones). */
const VARIOS_ARTISTAS = "Varios artistas";
/**
* Agrupa la biblioteca en álbumes y artistas. Esta misma función corre en el servidor (reco/motor.js), así que las
* claves de álbum y los nombres de artista son iguales en los dos lados.
*
* Álbumes: las canciones con el mismo nombre de álbum van juntas si comparten carátula o artista principal. Así un
* OST o una recopilación ("Grease", "Best-of lofi hip-hop 2021") es un solo álbum aunque cada canción sea de otro
* artista, y dos "Greatest Hits" de artistas distintos (con carátulas distintas) siguen separados.
*
* Artistas: una colaboración ("Kenny Rogers y Kim Carnes") no es un artista aparte. La canción va con cada uno de
* sus artistas que ya exista por su cuenta; si ninguna parte existe sola ("Simon & Garfunkel"), es un grupo.
*/
function groupLibrary(tracks) {
	const lower = (s) => s.toLowerCase();
	const solos = new Set(tracks.map((t) => lower(t.artist)));
	for (const t of tracks) if (!SEPARADOR.test(t.albumArtist)) solos.add(lower(t.albumArtist));
	/** Artistas de un nombre: las partes que existen solas, o el nombre entero. */
	const cache = /* @__PURE__ */ new Map();
	const partesDe = (nombre) => {
		let r = cache.get(nombre);
		if (r) return r;
		const partes = nombre.split(SEPARADOR).map((x) => x.trim()).filter((x) => x && lower(x) !== lower(nombre) && solos.has(lower(x)));
		r = partes.length ? [...new Set(partes)] : [nombre];
		cache.set(nombre, r);
		return r;
	};
	const principal = (nombre) => partesDe(nombre)[0];
	const porNombre = /* @__PURE__ */ new Map();
	const sueltos = [];
	for (const t of tracks) if (!t.album || t.album === "Álbum desconocido") sueltos.push(t);
	else {
		const k = lower(t.album.trim());
		const g = porNombre.get(k);
		if (g) g.push(t);
		else porNombre.set(k, [t]);
	}
	const grupos = [];
	for (const g of porNombre.values()) {
		const padre = g.map((_, i) => i);
		const raiz = (i) => padre[i] === i ? i : padre[i] = raiz(padre[i]);
		const unir = (a, b) => {
			padre[raiz(a)] = raiz(b);
		};
		if (ES_OST.test(g[0].album)) g.forEach((_, i) => i && unir(i, 0));
		const visto = /* @__PURE__ */ new Map();
		g.forEach((t, i) => {
			for (const marca of [t.coverId ? `c:${t.coverId}` : null, `a:${lower(principal(t.albumArtist))}`]) {
				if (!marca) continue;
				const j = visto.get(marca);
				if (j === void 0) visto.set(marca, i);
				else unir(i, j);
			}
		});
		const comp = /* @__PURE__ */ new Map();
		g.forEach((t, i) => {
			const r = raiz(i);
			const c = comp.get(r);
			if (c) c.push(t);
			else comp.set(r, [t]);
		});
		grupos.push(...comp.values());
	}
	const sinAlbum = /* @__PURE__ */ new Map();
	for (const t of sueltos) {
		const k = lower(`${principal(t.albumArtist)}|${t.album}`);
		const g = sinAlbum.get(k);
		if (g) g.push(t);
		else sinAlbum.set(k, [t]);
	}
	grupos.push(...sinAlbum.values());
	const albums = [];
	const claves = /* @__PURE__ */ new Set();
	const albumDe = /* @__PURE__ */ new Map();
	for (const g of grupos) {
		const cuenta = /* @__PURE__ */ new Map();
		for (const t of g) {
			const p = principal(t.albumArtist);
			const c = cuenta.get(lower(p));
			if (c) c.n++;
			else cuenta.set(lower(p), {
				nombre: p,
				n: 1
			});
		}
		const top = [...cuenta.values()].sort((a, b) => b.n - a.n || collator.compare(a.nombre, b.nombre))[0];
		const artist = cuenta.size === 1 || top.n * 2 >= g.length ? top.nombre : VARIOS_ARTISTAS;
		let key = lower(`${artist}|${g[0].album}`);
		if (claves.has(key)) {
			let n = 2;
			while (claves.has(`${key}#${n}`)) n++;
			key = `${key}#${n}`;
		}
		claves.add(key);
		const a = {
			key,
			name: g[0].album,
			artist,
			year: void 0,
			coverId: void 0,
			tracks: g
		};
		for (const t of g) {
			a.coverId ??= t.coverId;
			a.year ??= t.year;
			albumDe.set(t.id, key);
		}
		albums.push(a);
	}
	albums.sort((x, y) => collator.compare(x.name, y.name));
	for (const a of albums) a.tracks.sort((x, y) => (x.trackNo ?? 999) - (y.trackNo ?? 999) || collator.compare(x.title, y.title));
	const artistMap = /* @__PURE__ */ new Map();
	const artistOf = (name) => {
		const k = lower(name);
		let ar = artistMap.get(k);
		if (!ar) {
			ar = {
				name,
				albums: [],
				tracks: [],
				aparece: []
			};
			artistMap.set(k, ar);
		}
		return ar;
	};
	for (const a of albums) {
		if (a.artist === "Varios artistas") continue;
		const ar = artistOf(a.artist);
		ar.albums.push(a);
		ar.coverId ??= a.coverId;
	}
	for (const t of tracks) for (const n of partesDe(t.artist)) {
		const ar = artistOf(n);
		ar.tracks.push(t);
		ar.coverId ??= t.coverId;
	}
	for (const a of albums) {
		const ya = /* @__PURE__ */ new Set([lower(a.artist)]);
		for (const t of a.tracks) for (const n of partesDe(t.artist)) {
			if (ya.has(lower(n))) continue;
			ya.add(lower(n));
			artistOf(n).aparece.push(a);
		}
	}
	for (const [k, ar] of artistMap) if (!ar.tracks.length && !ar.albums.length) artistMap.delete(k);
	const artists = [...artistMap.values()].sort((x, y) => collator.compare(x.name, y.name));
	return {
		tracks: [...tracks].sort((x, y) => collator.compare(x.title, y.title)),
		albums,
		artists,
		albumDe
	};
}
// src/library/titulos.ts
/** Quita "(Remastered 2011)", "[Live]", " - Radio Edit"… para comparar títulos. */
function core(s) {
	return normalize(s.replace(/\s*[([].*?[)\]]/g, "").replace(/\s+-\s+.*(remaster|version|edit|mix|live|mono|stereo).*$/i, ""));
}
/** "Queen" coincide con "Queen", y "Bad Bunny" con "Bad Bunny feat. Drake". */
function sameArtist(ours, credit) {
	if (!credit?.length) return false;
	const full = normalize(credit.map((c) => c.name).join(" "));
	const o = normalize(ours);
	return !!o && credit.some((c) => normalize(c.name) === o || full.startsWith(o) || o.startsWith(normalize(c.name)));
}
// src/library/chart.ts
/** "Bad Bunny Featuring Drake & J Balvin" → ["Bad Bunny", "Drake", "J Balvin"] */
function splitArtists(s) {
	return s.split(/\s+(?:featuring|feat\.?|ft\.?|with|x|&|\+|and)\s+|,\s*/i).map((name) => ({ name: name.trim() })).filter((a) => a.name);
}
/**
* Marca las canciones que estuvieron en un chart de fin de año ([año, puesto, título, artista]). Las de meme,
* anime y OST no se marcan: sus mixes siguen funcionando exactamente igual. Devuelve cuántas se marcaron.
*/
function marcarExitos(tracks, filas) {
	const porTitulo = /* @__PURE__ */ new Map();
	for (const t of tracks) {
		if (t.categorias?.length) continue;
		const k = core(t.title);
		if (k) porTitulo.set(k, [...porTitulo.get(k) ?? [], t]);
	}
	const vistos = /* @__PURE__ */ new Map();
	for (const [anio, puesto, titulo, artista] of filas) {
		const credito = [{ name: artista }, ...splitArtists(artista)];
		for (const parte of titulo.split(/["”]?\s+\/\s+["“]?/)) for (const t of porTitulo.get(core(parte)) ?? []) {
			if (!sameArtist(t.artist, credito)) continue;
			const v = vistos.get(t.id) ?? {
				anio,
				puesto,
				anios: /* @__PURE__ */ new Set()
			};
			if (puesto < v.puesto) Object.assign(v, {
				anio,
				puesto
			});
			v.anios.add(anio);
			vistos.set(t.id, v);
		}
	}
	for (const t of tracks) {
		const v = vistos.get(t.id);
		if (v) t.exito = {
			anio: Math.min(...v.anios),
			puesto: v.puesto,
			anios: v.anios.size,
			valor: .6 + .4 * (100 - v.puesto) / 99
		};
	}
	return vistos.size;
}
/**
* Mismo resultado que comparar cada entrada con cada canción usando `sameTitle`, pero los títulos se normalizan
* una sola vez y se buscan en un índice (antes eran 100 × 15 000 comparaciones: 4 s con el servidor bloqueado).
*/
function matchChart(tracks, chart) {
	const hits = /* @__PURE__ */ new Map();
	const porCore = /* @__PURE__ */ new Map();
	const porNorm = /* @__PURE__ */ new Map();
	const agregar = (m, k, i) => {
		const l = m.get(k);
		if (l) l.push(i);
		else m.set(k, [i]);
	};
	tracks.forEach((t, i) => {
		const c = core(t.title);
		if (!c) return;
		agregar(porCore, c, i);
		agregar(porNorm, normalize(t.title), i);
	});
	for (const e of chart.data) {
		const c = core(e.song);
		if (!c) continue;
		const credit = [{ name: e.artist }, ...splitArtists(e.artist)];
		const ids = [.../* @__PURE__ */ new Set([...porCore.get(c) ?? [], ...porNorm.get(normalize(e.song)) ?? []])].sort((a, b) => a - b);
		for (const i of ids) {
			const t = tracks[i];
			if (!sameArtist(t.artist, credit)) continue;
			hits.set(t.id, {
				rank: e.this_week,
				lastWeek: e.last_week,
				peak: e.peak_position,
				weeks: e.weeks_on_chart,
				chartDate: chart.date
			});
		}
	}
	return hits;
}
export { MIN_HEARD, MOODS, billboardIds, buildModel, buscarTodo, clasificarEscenas, confianzaEnYoutube, descubrimientoSemanal, groupLibrary, groupScore, heardIds, interpretarBusqueda, listaDeBusqueda, marcarExitos, matchChart, mixesDiarios, mixesParaTi, moodMix, motivoRadio, paraTi, radio, radioChain, rediscover, shortcuts, shufflePool };
