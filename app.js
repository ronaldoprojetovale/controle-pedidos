/* ======================================================================
   CONTROLE DE PEDIDOS — app.js
   Preencha o objeto FIREBASE_CONFIG abaixo com os dados do SEU projeto
   Firebase (veja o guia "GUIA_DE_CONFIGURACAO.md" que veio junto com
   estes arquivos). Depois disso o app já funciona.
   ====================================================================== */

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCgaHWipVqaEA22GocpJBC0hAxB5gyI0zo",
  authDomain: "controle-pedidos-70db1.firebaseapp.com",
  projectId: "controle-pedidos-70db1",
  storageBucket: "controle-pedidos-70db1.firebasestorage.app",
  messagingSenderId: "171977651716",
  appId: "1:171977651716:web:1862417498144723512751"
};

const USERS = ["Cristian", "Pietro", "Rodrigues", "Ricardo", "Gabriel", "Davi"];
const ADMIN_USER = "ADM";
const USER_COLORS = ["#2f6fed", "#e0503f", "#1aa260", "#c98a1a", "#8a5fe0", "#e04f9b", "#1c2333"];

const STAGES = [
  { key: "separacao", label: "Separação no estoque", icon: "📦" },
  { key: "carregamento", label: "Carregamento", icon: "🚚" },
  { key: "descarregamento", label: "Descarregamento na entrega", icon: "🏁" }
];

const TIPOS_ENTREGA = [
  { key: "entrega", label: "Entrega", icon: "🚚" },
  { key: "retirada", label: "Retirada na loja", icon: "🏬" }
];

/* ---------------------------------------------------------------------
   Firebase init
   --------------------------------------------------------------------- */
let db = null, storage = null, auth = null, authReady = false, firebaseOk = true;
try {
  firebase.initializeApp(FIREBASE_CONFIG);
  auth = firebase.auth();
  db = firebase.firestore();
  storage = firebase.storage();
  db.enablePersistence({ synchronizeTabs: true }).catch(() => {});
} catch (e) {
  firebaseOk = false;
  console.error("Erro ao iniciar Firebase:", e);
}

if (firebaseOk) {
  auth.onAuthStateChanged(function (user) {
    if (user) {
      authReady = true;
      render();
    }
  });
  auth.signInAnonymously().catch(function (e) {
    console.error("Erro no login anônimo:", e);
    authReady = false;
    showToast("Não foi possível conectar ao servidor. Verifique a configuração do Firebase.");
    render();
  });
}

/* ---------------------------------------------------------------------
   Estado local
   --------------------------------------------------------------------- */
let state = {
  route: "login",
  pedidoId: null,
  pedidoData: null,
  homeList: [],
  homeFilter: "todos",
  homeTipoFilter: "todos",
  admList: [],
  admOpenId: null,
  admFilter: "",
  pendingFotos: [],
  pendingTotal: 0
};
let unsubHome = null;
let unsubPedido = null;
let unsubAdm = null;
let pendingObjectUrls = {};
let queueFlushing = false;

function getCurrentUser() {
  try { return localStorage.getItem("cp_user") || null; } catch (e) { return null; }
}
function setCurrentUser(name) {
  try { localStorage.setItem("cp_user", name); } catch (e) {}
}
function clearCurrentUser() {
  try { localStorage.removeItem("cp_user"); } catch (e) {}
}

/* ---------------------------------------------------------------------
   Roteamento simples por hash
   --------------------------------------------------------------------- */
function goTo(route, params) {
  params = params || {};
  if (route === "pedido") {
    location.hash = "#/pedido/" + encodeURIComponent(params.id);
  } else if (route === "admin") {
    location.hash = "#/admin";
  } else if (route === "home") {
    location.hash = "#/home";
  } else {
    location.hash = "#/login";
  }
}

window.addEventListener("hashchange", handleRoute);
window.addEventListener("DOMContentLoaded", function () {
  handleRoute();
  registerServiceWorker();
  refreshPendingTotal();
  flushQueue();
});

// Fila de envio offline: tenta enviar assim que a conexão volta, e também
// de tempos em tempos (o evento "online" nem sempre dispara em celulares
// ao voltar de segundo plano).
window.addEventListener("online", function () {
  render();
  flushQueue();
});
window.addEventListener("offline", function () {
  render();
});
setInterval(function () {
  if (navigator.onLine) flushQueue();
}, 25000);

function handleRoute() {
  const hash = location.hash || "#/login";
  const user = getCurrentUser();

  if (!user) {
    state.route = "login";
    teardownListeners();
    render();
    return;
  }

  if (hash.indexOf("#/pedido/") === 0) {
    const id = decodeURIComponent(hash.replace("#/pedido/", ""));
    state.route = "pedido";
    openPedido(id);
  } else if (hash === "#/admin") {
    if (user !== ADMIN_USER) { goTo("home"); return; }
    state.route = "admin";
    teardownPedidoListener();
    watchAdmin();
    render();
  } else {
    state.route = "home";
    teardownPedidoListener();
    watchHome();
    render();
  }
}

function teardownListeners() {
  teardownPedidoListener();
  if (unsubHome) { unsubHome(); unsubHome = null; }
  if (unsubAdm) { unsubAdm(); unsubAdm = null; }
}
function teardownPedidoListener() {
  if (unsubPedido) { unsubPedido(); unsubPedido = null; }
  revokePendingUrls();
  state.pendingFotos = [];
}

/* ---------------------------------------------------------------------
   Utilidades
   --------------------------------------------------------------------- */
function sanitizeId(raw) {
  let s = (raw || "").toString().trim().toUpperCase();
  s = s.replace(/[^A-Z0-9\-_.]/g, "");
  if (!s) s = "PEDIDO-" + Date.now();
  return s.slice(0, 120);
}
function escapeHtml(str) {
  return (str == null ? "" : String(str)).replace(/[&<>"']/g, function (c) {
    return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
  });
}
function formatDateTime(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return dd + "/" + mm + "/" + yy + " " + hh + ":" + mi;
}
function timeAgo(ms) {
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "agora";
  if (min < 60) return "há " + min + " min";
  const h = Math.floor(min / 60);
  if (h < 24) return "há " + h + "h";
  const d = Math.floor(h / 24);
  return "há " + d + "d";
}
function userColor(name) {
  let hash = 0;
  for (let i = 0; i < (name || "").length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return USER_COLORS[Math.abs(hash) % USER_COLORS.length];
}
function initials(name) {
  return (name || "?").slice(0, 2).toUpperCase();
}
function showToast(msg, ms) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(function () { el.remove(); }, ms || 2600);
}
function stageDone(pedido, key) {
  const etapa = pedido && pedido.etapas && pedido.etapas[key];
  if (!etapa) return false;
  if (etapa.dispensado) return true;
  return !!(etapa.fotos && etapa.fotos.length > 0);
}
/* ---------------------------------------------------------------------
   Tipo do pedido: entrega (padrão, 3 etapas) ou retirada na loja
   (só a etapa de separação). Pedidos antigos sem o campo tipoEntrega
   são tratados como "entrega" para manter o comportamento anterior.
   --------------------------------------------------------------------- */
function tipoEntregaOf(pedido) {
  return (pedido && pedido.tipoEntrega === "retirada") ? "retirada" : "entrega";
}
function tipoEntregaInfo(pedido) {
  const key = tipoEntregaOf(pedido);
  for (let i = 0; i < TIPOS_ENTREGA.length; i++) {
    if (TIPOS_ENTREGA[i].key === key) return TIPOS_ENTREGA[i];
  }
  return TIPOS_ENTREGA[0];
}
function stagesForPedido(pedido) {
  return tipoEntregaOf(pedido) === "retirada" ? STAGES.slice(0, 1) : STAGES;
}
function stageCount(pedido) {
  const stages = stagesForPedido(pedido);
  return stages.reduce(function (n, s) { return n + (stageDone(pedido, s.key) ? 1 : 0); }, 0);
}
function pedidoConcluido(pedido) {
  const stages = stagesForPedido(pedido);
  if (tipoEntregaOf(pedido) === "entrega") {
    const etapaDesc = pedido && pedido.etapas && pedido.etapas.descarregamento;
    if (etapaDesc && etapaDesc.dispensado) return true;
  }
  return stageCount(pedido) === stages.length;
}

/* ---------------------------------------------------------------------
   Compressão de imagem antes do upload
   --------------------------------------------------------------------- */
function compressImage(file) {
  return new Promise(function (resolve) {
    const maxDim = 1600;
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = function () {
      let w = img.width, h = img.height;
      if (w > maxDim || h > maxDim) {
        if (w >= h) { h = Math.round(h * (maxDim / w)); w = maxDim; }
        else { w = Math.round(w * (maxDim / h)); h = maxDim; }
      }
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      canvas.toBlob(function (blob) {
        resolve(blob || file);
      }, "image/jpeg", 0.78);
    };
    img.onerror = function () { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

/* ---------------------------------------------------------------------
   Localização (GPS) — usada na etapa de descarregamento
   --------------------------------------------------------------------- */
function captureLocation() {
  return new Promise(function (resolve) {
    if (!("geolocation" in navigator)) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          precisao: Math.round(pos.coords.accuracy || 0)
        });
      },
      function () { resolve(null); },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  });
}
function mapLink(loc) {
  return "https://maps.google.com/?q=" + loc.lat + "," + loc.lng;
}

/* ---------------------------------------------------------------------
   Fila de envio offline
   Quando não há internet (ou o envio falha), a foto/vídeo já comprimido
   fica guardado no aparelho (IndexedDB) em vez de ser perdido. Assim que
   a conexão voltar, o app envia tudo sozinho, sem precisar tirar a foto
   de novo.
   --------------------------------------------------------------------- */
const OFFLINE_DB_NAME = "cp_fila_offline";
const OFFLINE_DB_VERSION = 1;
const OFFLINE_STORE = "fila";

function newLocalId() {
  return "p" + Date.now() + "_" + Math.random().toString(36).slice(2, 10);
}

function idbOpen() {
  return new Promise(function (resolve, reject) {
    if (!("indexedDB" in window)) { reject(new Error("IndexedDB indisponível")); return; }
    const req = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
    req.onupgradeneeded = function () {
      const dbx = req.result;
      if (!dbx.objectStoreNames.contains(OFFLINE_STORE)) {
        dbx.createObjectStore(OFFLINE_STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = function () { resolve(req.result); };
    req.onerror = function () { reject(req.error); };
  });
}
function idbAdd(item) {
  return idbOpen().then(function (dbx) {
    return new Promise(function (resolve, reject) {
      const tx = dbx.transaction(OFFLINE_STORE, "readwrite");
      tx.objectStore(OFFLINE_STORE).add(item);
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
    });
  });
}
function idbGetAll() {
  return idbOpen().then(function (dbx) {
    return new Promise(function (resolve, reject) {
      const tx = dbx.transaction(OFFLINE_STORE, "readonly");
      const req = tx.objectStore(OFFLINE_STORE).getAll();
      req.onsuccess = function () { resolve(req.result || []); };
      req.onerror = function () { reject(req.error); };
    });
  });
}
function idbDelete(id) {
  return idbOpen().then(function (dbx) {
    return new Promise(function (resolve, reject) {
      const tx = dbx.transaction(OFFLINE_STORE, "readwrite");
      tx.objectStore(OFFLINE_STORE).delete(id);
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
    });
  });
}

function revokePendingUrls() {
  Object.keys(pendingObjectUrls).forEach(function (k) {
    try { URL.revokeObjectURL(pendingObjectUrls[k]); } catch (e) {}
  });
  pendingObjectUrls = {};
}

function refreshPendingTotal() {
  idbGetAll().then(function (items) {
    state.pendingTotal = items.length;
    render();
  }).catch(function () {});
}

function refreshPendingForPedido(pedidoId) {
  idbGetAll().then(function (items) {
    state.pendingTotal = items.length;
    const meus = items.filter(function (it) { return it.pedidoId === pedidoId; });
    revokePendingUrls();
    meus.forEach(function (it) {
      try { pendingObjectUrls[it.id] = URL.createObjectURL(it.blob); } catch (e) {}
    });
    state.pendingFotos = meus;
    render();
  }).catch(function () {});
}

function queueOffline(meta) {
  return idbAdd(meta).then(function () {
    if (meta.pedidoId === state.pedidoId) {
      refreshPendingForPedido(meta.pedidoId);
    } else {
      refreshPendingTotal();
    }
  });
}

function removePendingItem(id) {
  idbDelete(id).then(function () {
    showToast("Envio cancelado.");
    refreshPendingTotal();
    if (state.pedidoId) refreshPendingForPedido(state.pedidoId);
  }).catch(function (e) {
    console.error(e);
    showToast("Erro ao cancelar.");
  });
}

function flushQueue() {
  if (queueFlushing || !navigator.onLine) return;
  queueFlushing = true;
  idbGetAll().then(function (items) {
    if (!items.length) { queueFlushing = false; return; }
    let idx = 0;
    let sentCount = 0;
    function step() {
      if (idx >= items.length || !navigator.onLine) {
        queueFlushing = false;
        refreshPendingTotal();
        if (state.pedidoId) refreshPendingForPedido(state.pedidoId);
        if (sentCount > 0) {
          showToast(sentCount === 1 ? "1 item pendente enviado ✓" : sentCount + " itens pendentes enviados ✓", 2400);
        }
        return;
      }
      const meta = items[idx];
      idx++;
      sendToServer(meta).then(function () {
        return idbDelete(meta.id);
      }).then(function () {
        sentCount++;
        step();
      }).catch(function (e) {
        console.error("Falha ao sincronizar item pendente:", e);
        step();
      });
    }
    step();
  }).catch(function (e) {
    console.error(e);
    queueFlushing = false;
  });
}

/* ---------------------------------------------------------------------
   Firestore: pedidos
   --------------------------------------------------------------------- */
function watchHome() {
  if (unsubHome) { unsubHome(); }
  unsubHome = db.collection("pedidos").orderBy("atualizadoEm", "desc").limit(60)
    .onSnapshot(function (snap) {
      state.homeList = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
      render();
    }, function (err) {
      console.error(err);
      showToast("Erro ao carregar pedidos.");
    });
}

function watchAdmin() {
  if (unsubAdm) { unsubAdm(); }
  unsubAdm = db.collection("pedidos").orderBy("atualizadoEm", "desc").limit(300)
    .onSnapshot(function (snap) {
      state.admList = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
      render();
    }, function (err) {
      console.error(err);
      showToast("Erro ao carregar painel ADM.");
    });
}

function openPedido(rawId) {
  const id = sanitizeId(rawId);
  state.pedidoId = id;
  state.pedidoData = null;
  teardownPedidoListener();
  render();

  const ref = db.collection("pedidos").doc(id);
  // Transação: só cria o documento inicial se ele ainda não existir.
  // Evita que dois celulares abrindo o mesmo número novo ao mesmo tempo
  // apaguem fotos um do outro (leitura + escrita atômica).
  db.runTransaction(function (t) {
    return t.get(ref).then(function (docSnap) {
      if (!docSnap.exists) {
        const now = Date.now();
        t.set(ref, {
          numero: rawId.toString().trim() || id,
          criadoPor: getCurrentUser(),
          criadoEm: now,
          atualizadoEm: now,
          tipoEntrega: "entrega",
          etapas: {
            separacao: { fotos: [] },
            carregamento: { fotos: [] },
            descarregamento: { fotos: [] }
          }
        });
      }
    });
  }).catch(function (e) {
    console.error(e);
    showToast("Erro ao abrir o pedido.");
  });

  unsubPedido = ref.onSnapshot(function (docSnap) {
    if (docSnap.exists) {
      state.pedidoData = Object.assign({ id: docSnap.id }, docSnap.data());
    }
    render();
  }, function (err) {
    console.error(err);
    showToast("Erro de conexão com o pedido.");
  });

  refreshPendingForPedido(id);
}

function createOrOpenFromSearch(raw) {
  raw = (raw || "").trim();
  if (!raw) { showToast("Digite o número do pedido."); return; }
  goTo("pedido", { id: raw });
}

function videoExt(type) {
  if (!type) return "mp4";
  if (type.indexOf("quicktime") >= 0) return "mov";
  if (type.indexOf("webm") >= 0) return "webm";
  if (type.indexOf("3gpp") >= 0) return "3gp";
  return "mp4";
}

function sendToServer(meta) {
  const path = "pedidos/" + meta.pedidoId + "/" + meta.etapa + "/" + meta.criadoEm + "_" + meta.id + "." + meta.ext;
  const ref = storage.ref().child(path);
  return ref.put(meta.blob, { contentType: meta.contentType }).then(function () {
    return ref.getDownloadURL();
  }).then(function (url) {
    const fotoObj = { path: path, url: url, usuario: meta.usuario, criadoEm: meta.criadoEm, tipo: meta.tipo };
    if (meta.localizacao) fotoObj.localizacao = meta.localizacao;
    else if (meta.semLocalizacao) fotoObj.semLocalizacao = true;
    return db.collection("pedidos").doc(meta.pedidoId).update({
      ["etapas." + meta.etapa + ".fotos"]: firebase.firestore.FieldValue.arrayUnion(fotoObj),
      atualizadoEm: Date.now()
    });
  });
}

function uploadFotos(etapa, fileList) {
  const id = state.pedidoId;
  const user = getCurrentUser();
  const files = Array.prototype.slice.call(fileList || []);
  if (!files.length) return;
  if (!authReady && navigator.onLine) { showToast("Ainda conectando ao servidor, aguarde um instante."); return; }

  const MAX_VIDEO_MB = 50;

  let i = 0;
  function next() {
    if (i >= files.length) return;
    const file = files[i];
    i++;
    const isVideo = file.type.indexOf("video/") === 0;
    if (isVideo && file.size > MAX_VIDEO_MB * 1024 * 1024) {
      showToast("Vídeo muito grande (máx. " + MAX_VIDEO_MB + "MB). Grave um vídeo mais curto.", 3500);
      next();
      return;
    }
    const wantsLocation = etapa === "descarregamento";
    const offlineNow = !navigator.onLine;
    if (!offlineNow) {
      showToast((isVideo ? "Enviando vídeo" : "Enviando foto") + (files.length > 1 ? " (" + i + "/" + files.length + ")" : "") + "...", 9000);
    }
    Promise.all([
      isVideo ? Promise.resolve(file) : compressImage(file),
      wantsLocation ? captureLocation() : Promise.resolve(null)
    ]).then(function (results) {
      const blob = results[0];
      const gotLoc = results[1];
      const ext = isVideo ? videoExt(file.type) : "jpg";
      const contentType = isVideo ? (file.type || "video/mp4") : "image/jpeg";
      const meta = {
        id: newLocalId(),
        pedidoId: id,
        etapa: etapa,
        usuario: user,
        criadoEm: Date.now(),
        tipo: isVideo ? "video" : "foto",
        ext: ext,
        contentType: contentType,
        blob: blob
      };
      if (gotLoc) meta.localizacao = gotLoc;
      else if (wantsLocation) meta.semLocalizacao = true;

      if (offlineNow) {
        return queueOffline(meta).then(function () {
          showToast("📡 Sem conexão — " + (isVideo ? "vídeo" : "foto") + " salvo(a) no aparelho, será enviado(a) automaticamente ao voltar a internet.", 4000);
        });
      }
      return sendToServer(meta).then(function () {
        const label = isVideo ? "Vídeo registrado" : "Foto registrada";
        if (wantsLocation && !gotLoc) {
          showToast(label + " ✓ (sem localização — verifique a permissão de GPS)", 3200);
        } else {
          showToast(label + " ✓", 1400);
        }
      }).catch(function (e) {
        console.error(e);
        return queueOffline(meta).then(function () {
          showToast("📡 Falha na conexão — " + (isVideo ? "vídeo" : "foto") + " salvo(a) no aparelho, será enviado(a) automaticamente.", 4000);
        });
      });
    }).then(function () {
      next();
    }).catch(function (e) {
      console.error(e);
      showToast("Falha ao processar o arquivo. Tente novamente.");
      next();
    });
  }
  next();
}

function setDispensado(value) {
  const id = state.pedidoId;
  const user = getCurrentUser();
  const update = {
    "etapas.descarregamento.dispensado": value,
    atualizadoEm: Date.now()
  };
  if (value) {
    update["etapas.descarregamento.dispensadoPor"] = user;
    update["etapas.descarregamento.dispensadoEm"] = Date.now();
  } else {
    update["etapas.descarregamento.dispensadoPor"] = firebase.firestore.FieldValue.delete();
    update["etapas.descarregamento.dispensadoEm"] = firebase.firestore.FieldValue.delete();
  }
  db.collection("pedidos").doc(id).update(update).then(function () {
    showToast(value ? "Pedido finalizado (sem entrega) ✓" : "Marcação removida.");
  }).catch(function (e) {
    console.error(e);
    showToast("Erro ao atualizar o pedido.");
  });
}

function setTipoEntrega(tipo) {
  const id = state.pedidoId;
  db.collection("pedidos").doc(id).update({
    tipoEntrega: tipo,
    atualizadoEm: Date.now()
  }).then(function () {
    const info = TIPOS_ENTREGA.filter(function (t) { return t.key === tipo; })[0];
    showToast("Tipo do pedido: " + (info ? info.label : tipo) + " ✓", 1800);
  }).catch(function (e) {
    console.error(e);
    showToast("Erro ao atualizar o tipo do pedido.");
  });
}

function removeFoto(etapa, foto) {
  const id = state.pedidoId;
  db.collection("pedidos").doc(id).update({
    ["etapas." + etapa + ".fotos"]: firebase.firestore.FieldValue.arrayRemove(foto),
    atualizadoEm: Date.now()
  }).then(function () {
    if (foto && foto.path) {
      storage.ref().child(foto.path).delete().catch(function () {});
    }
    showToast("Foto removida. Toque em Tirar foto para corrigir.", 3000);
  }).catch(function (e) {
    console.error(e);
    showToast("Erro ao remover a foto.");
  });
}

function deletePedido(id) {
  db.collection("pedidos").doc(id).get().then(function (docSnap) {
    if (!docSnap.exists) return;
    const data = docSnap.data();
    const paths = [];
    STAGES.forEach(function (s) {
      const etapa = data.etapas && data.etapas[s.key];
      if (etapa && etapa.fotos) etapa.fotos.forEach(function (f) { if (f.path) paths.push(f.path); });
    });
    paths.forEach(function (p) { storage.ref().child(p).delete().catch(function () {}); });
    return db.collection("pedidos").doc(id).delete();
  }).then(function () {
    showToast("Pedido excluído.");
    if (state.admOpenId === id) state.admOpenId = null;
  }).catch(function (e) {
    console.error(e);
    showToast("Erro ao excluir pedido.");
  });
}

/* ---------------------------------------------------------------------
   Modal de confirmação genérico
   --------------------------------------------------------------------- */
let confirmCallback = null;
function askConfirm(opts) {
  confirmCallback = opts.onConfirm;
  const bg = document.createElement("div");
  bg.className = "modal-bg";
  bg.id = "confirm-modal";
  bg.innerHTML =
    '<div class="modal">' +
      '<h3>' + escapeHtml(opts.title) + '</h3>' +
      '<p>' + escapeHtml(opts.text) + '</p>' +
      '<div class="row">' +
        '<button class="btn secondary" data-action="confirm-cancel">Cancelar</button>' +
        '<button class="btn ' + (opts.danger ? "danger" : "") + '" data-action="confirm-ok">' + escapeHtml(opts.confirmLabel || "Confirmar") + '</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(bg);
}
function closeConfirm() {
  const m = document.getElementById("confirm-modal");
  if (m) m.remove();
  confirmCallback = null;
}

/* ---------------------------------------------------------------------
   Lightbox (ver foto em tamanho grande)
   --------------------------------------------------------------------- */
function openLightbox(url, type) {
  if (!url) return;
  const isVideo = type === "video";
  const bg = document.createElement("div");
  bg.className = "lightbox-bg";
  bg.id = "photo-lightbox";
  bg.setAttribute("data-action", "close-lightbox");
  const mediaHtml = isVideo
    ? '<video class="lightbox-img" src="' + escapeHtml(url) + '" controls autoplay playsinline onclick="event.stopPropagation()"></video>'
    : '<img class="lightbox-img" src="' + escapeHtml(url) + '" draggable="false">';
  bg.innerHTML =
    '<button class="lightbox-close" data-action="close-lightbox" title="Fechar">✕</button>' +
    mediaHtml +
    (isVideo ? "" : '<div class="lightbox-hint">Belisque ou dê dois toques para ampliar</div>');
  document.body.appendChild(bg);
  if (!isVideo) {
    const img = bg.querySelector(".lightbox-img");
    if (img) setupLightboxZoom(img);
  }
}
function closeLightbox() {
  const m = document.getElementById("photo-lightbox");
  if (m) m.remove();
}

/* ---------------------------------------------------------------------
   Zoom da foto no lightbox (pinça com dois dedos, duplo toque,
   scroll do mouse e arraste quando ampliada)
   --------------------------------------------------------------------- */
function setupLightboxZoom(img) {
  const MIN_SCALE = 1;
  const MAX_SCALE = 4;
  const ZOOM_TAP_SCALE = 2.6;
  let scale = 1, tx = 0, ty = 0;
  let pinchStartDist = 0, pinchStartScale = 1;
  let panning = false, panStartX = 0, panStartY = 0, panStartTx = 0, panStartTy = 0;
  let startTouches = 0, moved = false;
  let lastTapTime = 0, lastTapX = 0, lastTapY = 0;
  let mouseDown = false;

  function apply() {
    img.style.transform = "translate(" + tx + "px," + ty + "px) scale(" + scale + ")";
    img.style.cursor = scale > 1 ? "grab" : "zoom-out";
  }
  function clampScale(s) {
    return Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));
  }
  function resetZoom() {
    scale = 1; tx = 0; ty = 0;
    apply();
  }
  function toggleZoomAt(clientX, clientY) {
    if (scale > 1) {
      resetZoom();
      return;
    }
    const rect = img.getBoundingClientRect();
    const offsetX = clientX - (rect.left + rect.width / 2);
    const offsetY = clientY - (rect.top + rect.height / 2);
    scale = ZOOM_TAP_SCALE;
    tx = -offsetX * (scale - 1) / scale;
    ty = -offsetY * (scale - 1) / scale;
    apply();
  }
  function touchDist(t0, t1) {
    const dx = t0.clientX - t1.clientX;
    const dy = t0.clientY - t1.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  img.addEventListener("touchstart", function (e) {
    startTouches = e.touches.length;
    moved = false;
    if (e.touches.length === 2) {
      pinchStartDist = touchDist(e.touches[0], e.touches[1]);
      pinchStartScale = scale;
      panning = false;
    } else if (e.touches.length === 1 && scale > 1) {
      panning = true;
      panStartX = e.touches[0].clientX;
      panStartY = e.touches[0].clientY;
      panStartTx = tx;
      panStartTy = ty;
    }
  }, { passive: true });

  img.addEventListener("touchmove", function (e) {
    if (e.touches.length === 2) {
      e.preventDefault();
      moved = true;
      const d = touchDist(e.touches[0], e.touches[1]);
      if (pinchStartDist > 0) {
        scale = clampScale(pinchStartScale * (d / pinchStartDist));
        apply();
      }
    } else if (e.touches.length === 1 && panning) {
      e.preventDefault();
      moved = true;
      tx = panStartTx + (e.touches[0].clientX - panStartX);
      ty = panStartTy + (e.touches[0].clientY - panStartY);
      apply();
    }
  }, { passive: false });

  img.addEventListener("touchend", function (e) {
    panning = false;
    if (e.touches.length > 0) return;
    if (scale < 1.02) { scale = 1; tx = 0; ty = 0; apply(); }
    if (startTouches === 1 && !moved && e.changedTouches.length) {
      const t = e.changedTouches[0];
      const now = Date.now();
      const dx = t.clientX - lastTapX, dy = t.clientY - lastTapY;
      if (now - lastTapTime < 320 && Math.sqrt(dx * dx + dy * dy) < 30) {
        lastTapTime = 0;
        toggleZoomAt(t.clientX, t.clientY);
      } else {
        lastTapTime = now;
        lastTapX = t.clientX;
        lastTapY = t.clientY;
      }
    }
  });

  img.addEventListener("dblclick", function (e) {
    e.preventDefault();
    toggleZoomAt(e.clientX, e.clientY);
  });

  img.addEventListener("wheel", function (e) {
    e.preventDefault();
    const delta = -e.deltaY * 0.0018;
    const newScale = clampScale(scale + delta * scale);
    const rect = img.getBoundingClientRect();
    const offsetX = e.clientX - (rect.left + rect.width / 2);
    const offsetY = e.clientY - (rect.top + rect.height / 2);
    const ratio = newScale / scale;
    tx = offsetX - (offsetX - tx) * ratio;
    ty = offsetY - (offsetY - ty) * ratio;
    scale = newScale;
    if (scale <= 1.001) { scale = 1; tx = 0; ty = 0; }
    apply();
  }, { passive: false });

  img.addEventListener("mousedown", function (e) {
    if (scale <= 1) return;
    mouseDown = true;
    panStartX = e.clientX; panStartY = e.clientY;
    panStartTx = tx; panStartTy = ty;
    e.preventDefault();
  });
  window.addEventListener("mousemove", function (e) {
    if (!mouseDown) return;
    tx = panStartTx + (e.clientX - panStartX);
    ty = panStartTy + (e.clientY - panStartY);
    apply();
  });
  window.addEventListener("mouseup", function () { mouseDown = false; });

  img.addEventListener("click", function (e) {
    if (scale > 1) {
      e.stopPropagation();
    }
  });

  apply();
}

/* ---------------------------------------------------------------------
   Service worker (instalação como app)
   --------------------------------------------------------------------- */
function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(function () {});
  }
}

/* ======================================================================
   RENDER
   ====================================================================== */
function render() {
  const app = document.getElementById("app");
  if (!firebaseOk) {
    app.innerHTML = renderConfigError();
    return;
  }
  const user = getCurrentUser();
  if (!user) {
    app.innerHTML = renderLogin();
    return;
  }
  let html = renderConnBar();
  if (state.route === "pedido") {
    html += renderPedido(user);
  } else if (state.route === "admin") {
    html += renderAdmin(user);
  } else {
    html += renderHome(user);
  }
  app.innerHTML = html;
  bindFileInputs();
}

function renderConnBar() {
  if (!navigator.onLine) {
    return '<div class="connbar">📡 Sem conexão — as fotos/vídeos tirados agora ficam salvos no aparelho' +
      (state.pendingTotal ? " (" + state.pendingTotal + " aguardando)" : "") +
      ' e são enviados automaticamente quando a internet voltar.</div>';
  }
  if (state.pendingTotal > 0) {
    return '<div class="connbar online" data-action="flush-queue">🔄 Enviando ' + state.pendingTotal +
      (state.pendingTotal === 1 ? " item pendente" : " itens pendentes") +
      '… toque para tentar agora</div>';
  }
  return "";
}

function renderConfigError() {
  return '<main style="padding:30px 20px;text-align:center;">' +
    '<div style="font-size:40px;">⚠️</div>' +
    '<h2>Configuração pendente</h2>' +
    '<p style="color:var(--muted);">Este app ainda não foi conectado ao Firebase. Preencha o objeto <b>FIREBASE_CONFIG</b> no arquivo <code>app.js</code> com os dados do seu projeto (veja o guia de configuração).</p>' +
  '</main>';
}

function renderLogin() {
  let btns = USERS.map(function (u) {
    return '<button class="userbtn" data-action="select-user" data-user="' + escapeHtml(u) + '">' +
      '<div class="avatar" style="background:' + userColor(u) + '">' + escapeHtml(initials(u)) + '</div>' +
      escapeHtml(u) +
    '</button>';
  }).join("");
  btns += '<button class="userbtn admbtn" data-action="select-user" data-user="' + ADMIN_USER + '">' +
    '<div class="avatar">⚙️</div>ADM</button>';

  return '<main>' +
    '<div class="center-logo">' +
      '<div class="emoji">📦</div>' +
      '<h2>Controle de Pedidos</h2>' +
      '<p>Toque no seu nome para começar</p>' +
    '</div>' +
    '<div class="userlist">' + btns + '</div>' +
  '</main>';
}

function renderTopbar(opts) {
  opts = opts || {};
  const user = getCurrentUser();
  let html = '<header class="topbar">';
  if (opts.back) {
    html += '<button class="back" data-action="' + opts.back + '">←</button>';
  }
  html += '<h1>' + escapeHtml(opts.title || "") +
    (opts.sub ? '<span class="sub">' + escapeHtml(opts.sub) + '</span>' : '') + '</h1>';
  if (opts.showUser !== false) {
    html += '<span style="font-size:12px;opacity:.9;margin-right:2px;">' + escapeHtml(user || "") + '</span>' +
      '<button class="switchuser" data-action="switch-user">Trocar</button>';
  }
  html += '</header>';
  return html;
}

function renderHome(user) {
  const filter = state.homeFilter;
  const tipoFilter = state.homeTipoFilter || "todos";
  let list = state.homeList.slice();
  if (filter === "pendentes") list = list.filter(function (p) { return !pedidoConcluido(p); });
  if (filter === "concluidos") list = list.filter(function (p) { return pedidoConcluido(p); });
  if (tipoFilter !== "todos") list = list.filter(function (p) { return tipoEntregaOf(p) === tipoFilter; });

  let rows = list.map(function (p) {
    const stages = stagesForPedido(p);
    const dots = stages.map(function (s) {
      return '<span class="dot ' + (stageDone(p, s.key) ? "on" : "") + '" title="' + escapeHtml(s.label) + '"></span>';
    }).join("");
    const info = tipoEntregaInfo(p);
    return '<div class="pedido-row" data-action="open-pedido" data-id="' + escapeHtml(p.id) + '">' +
      '<div class="info">' +
        '<div class="num">' + info.icon + ' Pedido ' + escapeHtml(p.numero || p.id) + '</div>' +
        '<div class="meta">' + escapeHtml(p.criadoPor || "") + ' · atualizado ' + timeAgo(p.atualizadoEm) + '</div>' +
        '<div class="dots">' + dots + '</div>' +
      '</div>' +
      '<div class="chevron">›</div>' +
    '</div>';
  }).join("");

  if (!list.length) {
    rows = '<div class="empty">Nenhum pedido encontrado.<br>Digite um número acima para criar um novo.</div>';
  }

  const admBtn = user === ADMIN_USER
    ? '<button class="btn secondary" style="margin-bottom:14px;" data-action="go-admin">⚙️ Painel ADM</button>'
    : '';

  return renderTopbar({ title: "Controle de Pedidos", sub: STAGES.length + " etapas por pedido" }) +
    '<main>' +
      '<form class="searchbar" data-action="search-form">' +
        '<input id="search-input" type="text" inputmode="text" placeholder="Número do pedido" autocomplete="off">' +
        '<button type="submit">Abrir</button>' +
      '</form>' +
      admBtn +
      '<div class="chips">' +
        chip("todos", "Todos") + chip("pendentes", "Pendentes") + chip("concluidos", "Concluídos") +
      '</div>' +
      '<div class="chips">' +
        tipoChip("todos", "Todos os tipos") +
        TIPOS_ENTREGA.map(function (t) { return tipoChip(t.key, t.icon + " " + t.label); }).join("") +
      '</div>' +
      rows +
    '</main>';

  function chip(key, label) {
    return '<button class="chip ' + (filter === key ? "active" : "") + '" data-action="filter" data-filter="' + key + '">' + label + '</button>';
  }
  function tipoChip(key, label) {
    return '<button class="chip ' + (tipoFilter === key ? "active" : "") + '" data-action="filter-tipo" data-tipo="' + key + '">' + label + '</button>';
  }
}

function renderPedido(user) {
  const p = state.pedidoData;
  if (!p) {
    return renderTopbar({ title: "Carregando…", back: "go-home" }) + '<main><div class="empty">Abrindo pedido…</div></main>';
  }
  const tipoAtual = tipoEntregaOf(p);
  const tipoSelectorHtml = '<div class="card" style="padding:12px 14px;">' +
    '<div style="font-size:12px;color:var(--muted);font-weight:600;margin-bottom:8px;">Tipo do pedido</div>' +
    '<div class="chips" style="margin-bottom:0;">' +
      TIPOS_ENTREGA.map(function (t) {
        return '<button class="chip ' + (tipoAtual === t.key ? "active" : "") + '" data-action="set-tipo-entrega" data-tipo="' + t.key + '">' + t.icon + ' ' + escapeHtml(t.label) + '</button>';
      }).join("") +
    '</div>' +
  '</div>';
  const stages = stagesForPedido(p);
  const stagesHtml = stages.map(function (s) {
    const etapa = (p.etapas && p.etapas[s.key]) || { fotos: [] };
    const fotos = etapa.fotos || [];
    const dispensado = s.key === "descarregamento" && !!etapa.dispensado;
    const done = fotos.length > 0 || dispensado;
    const last = fotos.length ? fotos[fotos.length - 1] : null;
    const pendentesEtapa = (state.pendingFotos || []).filter(function (it) { return it.etapa === s.key; });
    const badgeLabel = fotos.length > 0 ? "Concluído" : (dispensado ? "Sem entrega" : (pendentesEtapa.length ? "Aguardando envio" : "Pendente"));

    const grid = fotos.map(function (f, idx) {
      const locHtml = f.localizacao
        ? '<a class="tag-loc" href="' + escapeHtml(mapLink(f.localizacao)) + '" target="_blank" rel="noopener">📍 Ver no mapa</a>'
        : (f.semLocalizacao ? '<span class="tag-loc off">📍 sem GPS</span>' : '');
      const isVideo = f.tipo === "video";
      const mediaHtml = isVideo
        ? '<video src="' + escapeHtml(f.url) + '" preload="metadata" muted playsinline data-action="view-photo" data-url="' + escapeHtml(f.url) + '" data-type="video"></video>' +
          '<div class="play-badge">▶</div>'
        : '<img src="' + escapeHtml(f.url) + '" loading="lazy" data-action="view-photo" data-url="' + escapeHtml(f.url) + '" data-type="foto">';
      return '<div class="photothumb">' +
        mediaHtml +
        '<button class="rm" data-action="remove-photo" data-etapa="' + s.key + '" data-idx="' + idx + '" title="Corrigir foto">✕</button>' +
        '<div class="tag">' + escapeHtml(f.usuario) + '<br>' + formatDateTime(f.criadoEm) + (locHtml ? '<br>' + locHtml : '') + '</div>' +
      '</div>';
    }).join("");

    const pendingGrid = pendentesEtapa.map(function (it) {
      const url = pendingObjectUrls[it.id] || "";
      const isVideoP = it.tipo === "video";
      const mediaHtmlP = isVideoP
        ? '<video src="' + escapeHtml(url) + '" preload="metadata" muted playsinline data-action="view-photo" data-url="' + escapeHtml(url) + '" data-type="video"></video>' +
          '<div class="play-badge">▶</div>'
        : '<img src="' + escapeHtml(url) + '" data-action="view-photo" data-url="' + escapeHtml(url) + '" data-type="foto">';
      return '<div class="photothumb pending">' +
        '<span class="pending-badge">⏳ aguardando</span>' +
        mediaHtmlP +
        '<button class="rm" data-action="remove-pending" data-id="' + escapeHtml(it.id) + '" title="Cancelar envio">✕</button>' +
        '<div class="tag">' + escapeHtml(it.usuario) + '<br>' + formatDateTime(it.criadoEm) + '<br>📡 salvo(a) no aparelho</div>' +
      '</div>';
    }).join("");

    let dispensarHtml = "";
    if (s.key === "descarregamento") {
      if (dispensado) {
        dispensarHtml = '<div class="meta" style="color:var(--muted);font-size:12px;margin:10px 0 0 0;">' +
          '✓ Marcado como finalizado sem entrega' + (etapa.dispensadoPor ? ' por ' + escapeHtml(etapa.dispensadoPor) : '') + (etapa.dispensadoEm ? ' em ' + formatDateTime(etapa.dispensadoEm) : '') + '. ' +
          '<button class="btn ghost" style="padding:2px 6px;font-size:12px;" data-action="undo-dispensar">Desfazer</button>' +
        '</div>';
      } else if (!fotos.length) {
        dispensarHtml = '<button class="btn secondary" style="margin-top:10px;" data-action="dispensar-entrega">✓ Finalizar (não vai para entrega)</button>';
      }
    }

    return '<div class="card stage-card ' + (done ? "done" : "") + '">' +
      '<div class="stage-head">' +
        '<div class="num">' + (done ? "✓" : s.icon) + '</div>' +
        '<div class="title">' + escapeHtml(s.label) + '</div>' +
        '<span class="badge ' + (done ? "concluido" : "pendente") + '">' + badgeLabel + '</span>' +
      '</div>' +
      (last ? '<div class="meta" style="color:var(--muted);font-size:12px;margin:-6px 0 12px 0;">Último registro: ' + escapeHtml(last.usuario) + ' em ' + formatDateTime(last.criadoEm) + '</div>' : '') +
      ((grid || pendingGrid) ? '<div class="photogrid">' + grid + pendingGrid + '</div>' : '') +
      (dispensado ? '' : '<button class="camerabtn" data-action="take-photo" data-etapa="' + s.key + '">📷 Foto ou vídeo</button>') +
      dispensarHtml +
    '</div>';
  }).join("");

  return renderTopbar({ title: "Pedido " + escapeHtml(p.numero || p.id), sub: "criado por " + escapeHtml(p.criadoPor || "—") + " em " + formatDateTime(p.criadoEm), back: "go-home" }) +
    '<main>' + tipoSelectorHtml + stagesHtml + '</main>' +
    hiddenFileInputs();
}

function hiddenFileInputs() {
  return STAGES.map(function (s) {
    return '<input type="file" id="file-' + s.key + '" accept="image/*,video/*" capture="environment" multiple>';
  }).join("");
}

function bindFileInputs() {
  STAGES.forEach(function (s) {
    const el = document.getElementById("file-" + s.key);
    if (!el) return;
    el.onchange = function () {
      uploadFotos(s.key, el.files);
      el.value = "";
    };
  });
  const search = document.getElementById("search-input");
  if (search) search.focus = search.focus; // no-op, keeps linter calm
}

function renderAdmin(user) {
  const total = state.admList.length;
  const concl = state.admList.filter(function (p) { return pedidoConcluido(p); }).length;
  const pend = total - concl;
  const filterText = (state.admFilter || "").toUpperCase();
  let list = state.admList;
  if (filterText) {
    list = list.filter(function (p) {
      return (p.numero || "").toUpperCase().indexOf(filterText) >= 0 ||
        (p.criadoPor || "").toUpperCase().indexOf(filterText) >= 0;
    });
  }

  const rows = list.map(function (p) {
    const open = state.admOpenId === p.id;
    const stages = stagesForPedido(p);
    const info = tipoEntregaInfo(p);
    const dots = stages.map(function (s) {
      return '<span class="dot ' + (stageDone(p, s.key) ? "on" : "") + '"></span>';
    }).join("");
    let body = "";
    if (open) {
      body = '<div class="adm-body">' +
        stages.map(function (s) {
          const etapa = (p.etapas && p.etapas[s.key]) || { fotos: [] };
          const fotos = etapa.fotos || [];
          const thumbs = fotos.map(function (f) {
            const locHtml = f.localizacao
              ? '<a class="tag-loc" href="' + escapeHtml(mapLink(f.localizacao)) + '" target="_blank" rel="noopener">📍 Ver no mapa</a>'
              : (f.semLocalizacao ? '<span class="tag-loc off">📍 sem GPS</span>' : '');
            const isVideo = f.tipo === "video";
            const mediaHtml = isVideo
              ? '<video src="' + escapeHtml(f.url) + '" preload="metadata" muted playsinline data-action="view-photo" data-url="' + escapeHtml(f.url) + '" data-type="video"></video><div class="play-badge">▶</div>'
              : '<img src="' + escapeHtml(f.url) + '" loading="lazy" data-action="view-photo" data-url="' + escapeHtml(f.url) + '" data-type="foto">';
            return '<div class="photothumb">' + mediaHtml +
              '<div class="tag">' + escapeHtml(f.usuario) + '<br>' + formatDateTime(f.criadoEm) + (locHtml ? '<br>' + locHtml : '') + '</div></div>';
          }).join("");
          const dispensado = s.key === "descarregamento" && !!etapa.dispensado;
          const statusSuffix = fotos.length ? "" : (dispensado ? " — finalizado sem entrega" : " — sem fotos");
          return '<div style="margin-top:12px;">' +
            '<div style="font-weight:700;font-size:13px;margin-bottom:6px;">' + s.icon + ' ' + escapeHtml(s.label) + statusSuffix + '</div>' +
            (thumbs ? '<div class="photogrid">' + thumbs + '</div>' : '') +
          '</div>';
        }).join("") +
        '<button class="btn danger" style="margin-top:14px;" data-action="delete-pedido" data-id="' + escapeHtml(p.id) + '">🗑 Excluir pedido</button>' +
        '<button class="btn secondary" style="margin-top:10px;" data-action="open-pedido" data-id="' + escapeHtml(p.id) + '">Abrir tela do pedido</button>' +
      '</div>';
    }
    return '<div class="adm-row">' +
      '<div class="adm-head" data-action="toggle-adm-row" data-id="' + escapeHtml(p.id) + '">' +
        '<div class="info" style="flex:1;">' +
          '<div class="num">' + info.icon + ' Pedido ' + escapeHtml(p.numero || p.id) + '</div>' +
          '<div class="meta">' + escapeHtml(p.criadoPor || "") + ' · ' + formatDateTime(p.criadoEm) + '</div>' +
          '<div class="dots">' + dots + '</div>' +
        '</div>' +
        '<div class="chevron">' + (open ? "︿" : "﹀") + '</div>' +
      '</div>' + body +
    '</div>';
  }).join("");

  const totalRetirada = state.admList.filter(function (p) { return tipoEntregaOf(p) === "retirada"; }).length;
  const totalEntrega = total - totalRetirada;

  return renderTopbar({ title: "Painel ADM", back: "go-home" }) +
    '<main>' +
      '<div class="stat-grid">' +
        '<div class="stat"><div class="n">' + total + '</div><div class="l">pedidos</div></div>' +
        '<div class="stat"><div class="n">' + concl + '</div><div class="l">concluídos</div></div>' +
        '<div class="stat"><div class="n">' + pend + '</div><div class="l">em andamento</div></div>' +
      '</div>' +
      '<div class="meta" style="text-align:center;margin:-10px 0 14px 0;">🚚 ' + totalEntrega + ' entrega · 🏬 ' + totalRetirada + ' retirada</div>' +
      '<div class="searchbar">' +
        '<input id="adm-search" type="text" placeholder="Filtrar por número ou usuário" value="' + escapeHtml(state.admFilter) + '">' +
      '</div>' +
      (rows || '<div class="empty">Nenhum pedido ainda.</div>') +
    '</main>';
}

/* ======================================================================
   EVENTOS (delegação)
   ====================================================================== */
document.addEventListener("click", function (e) {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const action = el.getAttribute("data-action");

  if (action === "select-user") {
    setCurrentUser(el.getAttribute("data-user"));
    goTo("home"); handleRoute();
  } else if (action === "switch-user") {
    askConfirm({
      title: "Trocar usuário",
      text: "Deseja sair e escolher outro nome?",
      confirmLabel: "Sair",
      onConfirm: function () { clearCurrentUser(); location.hash = "#/login"; handleRoute(); }
    });
  } else if (action === "go-home") {
    goTo("home");
  } else if (action === "go-admin") {
    goTo("admin");
  } else if (action === "open-pedido") {
    goTo("pedido", { id: el.getAttribute("data-id") });
  } else if (action === "filter") {
    state.homeFilter = el.getAttribute("data-filter");
    render();
  } else if (action === "filter-tipo") {
    state.homeTipoFilter = el.getAttribute("data-tipo");
    render();
  } else if (action === "set-tipo-entrega") {
    const novoTipo = el.getAttribute("data-tipo");
    const p = state.pedidoData;
    if (!p || tipoEntregaOf(p) === novoTipo) { /* nada a fazer */ }
    else if (novoTipo === "retirada" && (stageDone(p, "carregamento") || stageDone(p, "descarregamento"))) {
      askConfirm({
        title: "Mudar para retirada na loja",
        text: "Este pedido já tem registros de carregamento e/ou descarregamento. Eles não serão apagados, mas deixarão de aparecer na tela do pedido. Continuar?",
        confirmLabel: "Mudar para retirada",
        danger: true,
        onConfirm: function () { setTipoEntrega(novoTipo); }
      });
    } else {
      setTipoEntrega(novoTipo);
    }
  } else if (action === "take-photo") {
    const input = document.getElementById("file-" + el.getAttribute("data-etapa"));
    if (input) input.click();
  } else if (action === "dispensar-entrega") {
    askConfirm({
      title: "Finalizar sem entrega",
      text: "Este pedido não vai passar pela etapa de Descarregamento na entrega. Marcar como finalizado?",
      confirmLabel: "Finalizar",
      onConfirm: function () { setDispensado(true); }
    });
  } else if (action === "undo-dispensar") {
    askConfirm({
      title: "Desfazer finalização",
      text: "Remover a marcação de \"finalizado sem entrega\" deste pedido?",
      confirmLabel: "Desfazer",
      danger: true,
      onConfirm: function () { setDispensado(false); }
    });
  } else if (action === "remove-photo") {
    const etapa = el.getAttribute("data-etapa");
    const idx = parseInt(el.getAttribute("data-idx"), 10);
    const fotos = state.pedidoData.etapas[etapa].fotos;
    const foto = fotos[idx];
    askConfirm({
      title: "Corrigir foto",
      text: "Remover esta foto? Você poderá tirar outra em seguida.",
      confirmLabel: "Remover",
      danger: true,
      onConfirm: function () { removeFoto(etapa, foto); }
    });
  } else if (action === "toggle-adm-row") {
    const id = el.getAttribute("data-id");
    state.admOpenId = state.admOpenId === id ? null : id;
    render();
  } else if (action === "delete-pedido") {
    const id = el.getAttribute("data-id");
    askConfirm({
      title: "Excluir pedido",
      text: "Isso apaga o pedido " + id + " e todas as fotos dele. Essa ação não pode ser desfeita.",
      confirmLabel: "Excluir",
      danger: true,
      onConfirm: function () { deletePedido(id); }
    });
  } else if (action === "confirm-ok") {
    const cb = confirmCallback;
    closeConfirm();
    if (cb) cb();
  } else if (action === "confirm-cancel") {
    closeConfirm();
  } else if (action === "view-photo") {
    openLightbox(el.getAttribute("data-url"), el.getAttribute("data-type"));
  } else if (action === "close-lightbox") {
    closeLightbox();
  } else if (action === "flush-queue") {
    if (!navigator.onLine) {
      showToast("Ainda sem conexão.");
    } else {
      showToast("Tentando enviar…", 1500);
      flushQueue();
    }
  } else if (action === "remove-pending") {
    const pid = el.getAttribute("data-id");
    askConfirm({
      title: "Cancelar envio",
      text: "Esta foto/vídeo salvo no aparelho será apagado e não será enviado. Continuar?",
      confirmLabel: "Cancelar envio",
      danger: true,
      onConfirm: function () { removePendingItem(pid); }
    });
  }
});

document.addEventListener("keydown", function (e) {
  if (e.key === "Escape") {
    closeLightbox();
    closeConfirm();
  }
});

document.addEventListener("submit", function (e) {
  if (e.target && e.target.getAttribute("data-action") === "search-form") {
    e.preventDefault();
    const input = document.getElementById("search-input");
    createOrOpenFromSearch(input ? input.value : "");
  }
});

document.addEventListener("input", function (e) {
  if (e.target && e.target.id === "adm-search") {
    state.admFilter = e.target.value;
    render();
    const el = document.getElementById("adm-search");
    if (el) { el.focus(); el.selectionStart = el.selectionEnd = el.value.length; }
  }
});
