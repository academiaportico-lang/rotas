// MAPA
let map = L.map('map').setView([-15.78, -47.93], 5);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png')
.addTo(map);

let rotaLayer = null;
let marcadorOrigem = null;
let marcadoresDestino = [];

let contadorDestinos = 0;

// =========================
// RETRY (evita erro fetch)
// =========================
async function fetchComRetry(url, tentativas = 3) {
  for (let i = 0; i < tentativas; i++) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error("Erro na requisição");
      return resp;
    } catch (e) {
      if (i === tentativas - 1) throw e;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

// =========================
// DESTINOS DINÂMICOS
// =========================
function getLetra(index) {
  return String.fromCharCode(65 + index);
}

function adicionarDestino() {
  const index = contadorDestinos;
  const letra = getLetra(index);

  const div = document.createElement("div");
  div.className = "destino-item";

  div.innerHTML = `
    <div class="letra">${letra}</div>

    <div class="inputs">
      <input id="cepDestino${index}" placeholder="CEP">
      <input id="numDestino${index}" placeholder="Número">
      <button onclick="buscarEnderecoDestino(${index})">Buscar</button>
      <input id="destino${index}" placeholder="Endereço" readonly>
    </div>

    <button onclick="removerDestino(this)">❌</button>
  `;

  document.getElementById("destinos").appendChild(div);
  contadorDestinos++;
}

function removerDestino(btn) {
  btn.parentElement.remove();

  const itens = document.querySelectorAll(".destino-item");

  itens.forEach((item, i) => {
    item.querySelector(".letra").innerText = getLetra(i);
  });

  contadorDestinos = itens.length;
}

// =========================
// CEP
// =========================
async function buscarEndereco() {
  const cep = document.getElementById("cepOrigem").value;
  const numero = document.getElementById("numOrigem").value;

  const resp = await fetchComRetry(`https://viacep.com.br/ws/${cep}/json/`);
  const data = await resp.json();

  document.getElementById("origem").value =
    `${data.logradouro}, ${numero}, ${data.localidade}, ${data.uf}, Brasil`;
}

async function buscarEnderecoDestino(i) {
  const cep = document.getElementById("cepDestino" + i).value;
  const numero = document.getElementById("numDestino" + i).value;

  const resp = await fetchComRetry(`https://viacep.com.br/ws/${cep}/json/`);
  const data = await resp.json();

  document.getElementById("destino" + i).value =
    `${data.logradouro}, ${numero}, ${data.localidade}, ${data.uf}, Brasil`;
}

// =========================
// GEOCODE
// =========================
async function geocode(endereco) {
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(endereco)}&limit=1`;

  const resp = await fetchComRetry(url);
  const data = await resp.json();

  if (!data.features || data.features.length === 0) {
    throw new Error("Endereço não encontrado");
  }

  return {
    lat: data.features[0].geometry.coordinates[1],
    lng: data.features[0].geometry.coordinates[0]
  };
}

// =========================
// DISTÂNCIA (ordenar rota)
// =========================
function distancia(a, b) {
  const dx = a.lat - b.lat;
  const dy = a.lng - b.lng;
  return Math.sqrt(dx * dx + dy * dy);
}

function ordenarDestinos(origem, destinos) {
  let ordenados = [];
  let atual = origem;
  let restantes = [...destinos];

  while (restantes.length > 0) {
    let maisProximo = restantes[0];
    let menorDist = distancia(atual, maisProximo.coord);

    for (let d of restantes) {
      let dist = distancia(atual, d.coord);
      if (dist < menorDist) {
        menorDist = dist;
        maisProximo = d;
      }
    }

    ordenados.push(maisProximo);
    atual = maisProximo.coord;
    restantes = restantes.filter(d => d !== maisProximo);
  }

  return ordenados;
}

// =========================
// DISTÂNCIA REAL (Haversine)
// =========================
function distanciaEntrePontos(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;

  const a =
    Math.sin(dLat/2) ** 2 +
    Math.cos(lat1 * Math.PI/180) *
    Math.cos(lat2 * Math.PI/180) *
    Math.sin(dLon/2) ** 2;

  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function isNearRoute(point, polyline, maxDistKm) {
  return polyline.some(([lat, lon]) =>
    distanciaEntrePontos(point[0], point[1], lat, lon) <= maxDistKm
  );
}

// =========================
// CALCULAR ROTA
// =========================
async function calcular() {

  document.getElementById("loading").style.display = "block";
  document.getElementById("resultado").innerHTML = "";

  try {
    const origem = document.getElementById("origem").value;
    if (!origem) throw new Error("Informe a origem");

    const coordOrigem = await geocode(origem);

    let destinos = [];

    const inputs = document.querySelectorAll('[id^="destino"]');

    for (let input of inputs) {
      if (input.value) {
        const coord = await geocode(input.value);
        destinos.push({ endereco: input.value, coord });
      }
    }

    if (destinos.length === 0) throw new Error("Adicione destino");

    // ORDENAR INTELIGENTE
    destinos = ordenarDestinos(coordOrigem, destinos);

    let coords = [`${coordOrigem.lng},${coordOrigem.lat}`];
    destinos.forEach(d => coords.push(`${d.coord.lng},${d.coord.lat}`));

    // OSRM
    const url = `https://router.project-osrm.org/route/v1/driving/${coords.join(";")}?overview=full&geometries=geojson&steps=true`;

    const resp = await fetchComRetry(url);
    const data = await resp.json();

    const rota = data.routes[0];
    const linha = rota.geometry.coordinates.map(c => [c[1], c[0]]);

    // PEDÁGIO REAL (OVERPASS)
    const lats = linha.map(c => c[0]);
    const lngs = linha.map(c => c[1]);

    const bbox = `${Math.min(...lats)},${Math.min(...lngs)},${Math.max(...lats)},${Math.max(...lngs)}`;

    const overpassUrl = `https://overpass-api.de/api/interpreter?data=[out:json];node["barrier"="toll_booth"](${bbox});out;`;

    const pedResp = await fetchComRetry(overpassUrl);
    const pedData = await pedResp.json();

    let pedagioCount = 0;

    pedData.elements.forEach(p => {
      if (isNearRoute([p.lat, p.lon], linha, 0.2)) {
        pedagioCount++;
      }
    });

    // MAPA
    if (marcadorOrigem) map.removeLayer(marcadorOrigem);
    marcadoresDestino.forEach(m => map.removeLayer(m));
    if (rotaLayer) map.removeLayer(rotaLayer);

    const origemIcon = L.icon({
      iconUrl: 'https://maps.google.com/mapfiles/ms/icons/green-dot.png',
      iconSize: [40, 40]
    });

    const destinoIcon = L.icon({
      iconUrl: 'https://maps.google.com/mapfiles/ms/icons/red-dot.png',
      iconSize: [40, 40]
    });

    marcadorOrigem = L.marker([coordOrigem.lat, coordOrigem.lng], { icon: origemIcon })
      .addTo(map)
      .bindPopup("🟢 Origem");

    marcadoresDestino = [];

    destinos.forEach((d, i) => {
      const marker = L.marker([d.coord.lat, d.coord.lng], { icon: destinoIcon })
        .addTo(map)
        .bindPopup("🔴 Destino " + (i + 1));

      marcadoresDestino.push(marker);
    });

    rotaLayer = L.polyline(linha, { color: 'blue' }).addTo(map);
    map.fitBounds(linha);

    // RESULTADO
    const km = (rota.distance / 1000).toFixed(2);
    const min = Math.round(rota.duration / 60);

    let texto = `<b>📍 Origem:</b><br>${origem}<br><br>`;

    destinos.forEach((d, i) => {
      texto += `<b>🚚 Parada ${i+1}:</b><br>${d.endereco}<br>`;
    });

    texto += `<br><b>📏 Distância:</b> ${km} km<br>`;
    texto += `<b>⏱ Tempo:</b> ${min} min<br>`;
    texto += `<b>🚧 Pedágios na rota:</b> ${pedagioCount}`;

    document.getElementById("resultado").innerHTML = texto;

  } catch (e) {
    document.getElementById("resultado").innerHTML = "❌ Erro: " + e.message;
  }

  document.getElementById("loading").style.display = "none";
}

// RESET
function novaRota() {
  document.getElementById("destinos").innerHTML = "";
  contadorDestinos = 0;
  adicionarDestino();

  if (marcadorOrigem) map.removeLayer(marcadorOrigem);
  marcadoresDestino.forEach(m => map.removeLayer(m));
  if (rotaLayer) map.removeLayer(rotaLayer);

  map.setView([-15.78, -47.93], 5);
}

// INIT
window.onload = () => {
  adicionarDestino();
};