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
  admList: [],
  admOpenId: null,
  admFilter: ""
};
let unsubHome = null;
let unsubPedido = null;
let unsubAdm = null;

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
});

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
function stageCount(pedido) {
  return STAGES.reduce(function (n, s) { return n + (stageDone(pedido, s.key) ? 1 : 0); }, 0);
}
function pedidoConcluido(pedido) {
  const etapaDesc = pedido && pedido.etapas && pedido.etapas.descarregamento;
  if (etapaDesc && etapaDesc.dispensado) return true;
  return stageCount(pedido) === 3;
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
}

function createOrOpenFromSearch(raw) {
  raw = (raw || "").trim();
  if (!raw) { showToast("Digite o número do pedido."); return; }
  goTo("pedido", { id: raw });
}

function uploadFotos(etapa, fileList) {
  const id = state.pedidoId;
  const user = getCurrentUser();
  const files = Array.prototype.slice.call(fileList || []);
  if (!files.length) return;
  if (!authReady) { showToast("Ainda conectando ao servidor, aguarde um instante."); return; }

  let i = 0;
  function next() {
    if (i >= files.length) return;
    const file = files[i];
    i++;
    showToast("Enviando foto" + (files.length > 1 ? " (" + i + "/" + files.length + ")" : "") + "...", 6000);
    const wantsLocation = etapa === "descarregamento";
    let gotLoc = null;
    Promise.all([
      compressImage(file),
      wantsLocation ? captureLocation() : Promise.resolve(null)
    ]).then(function (results) {
      const blob = results[0];
      gotLoc = results[1];
      const path = "pedidos/" + id + "/" + etapa + "/" + Date.now() + "_" + Math.random().toString(36).slice(2, 8) + ".jpg";
      const ref = storage.ref().child(path);
      return ref.put(blob, { contentType: "image/jpeg" }).then(function () {
        return ref.getDownloadURL();
      }).then(function (url) {
        const fotoObj = { path: path, url: url, usuario: user, criadoEm: Date.now() };
        if (gotLoc) fotoObj.localizacao = gotLoc;
        else if (wantsLocation) fotoObj.semLocalizacao = true;
        return db.collection("pedidos").doc(id).update({
          ["etapas." + etapa + ".fotos"]: firebase.firestore.FieldValue.arrayUnion(fotoObj),
          atualizadoEm: Date.now()
        });
      });
    }).then(function () {
      if (wantsLocation && !gotLoc) {
        showToast("Foto registrada ✓ (sem localização — verifique a permissão de GPS)", 3200);
      } else {
        showToast("Foto registrada ✓", 1400);
      }
      next();
    }).catch(function (e) {
      console.error(e);
      showToast("Falha ao enviar a foto. Tente novamente.");
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
function openLightbox(url) {
  if (!url) return;
  const bg = document.createElement("div");
  bg.className = "lightbox-bg";
  bg.id = "photo-lightbox";
  bg.setAttribute("data-action", "close-lightbox");
  bg.innerHTML =
    '<button class="lightbox-close" data-action="close-lightbox" title="Fechar">✕</button>' +
    '<img class="lightbox-img" src="' + escapeHtml(url) + '">';
  document.body.appendChild(bg);
}
function closeLightbox() {
  const m = document.getElementById("photo-lightbox");
  if (m) m.remove();
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
  if (state.route === "pedido") {
    app.innerHTML = renderPedido(user);
  } else if (state.route === "admin") {
    app.innerHTML = renderAdmin(user);
  } else {
    app.innerHTML = renderHome(user);
  }
  bindFileInputs();
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
  let list = state.homeList.slice();
  if (filter === "pendentes") list = list.filter(function (p) { return !pedidoConcluido(p); });
  if (filter === "concluidos") list = list.filter(function (p) { return pedidoConcluido(p); });

  let rows = list.map(function (p) {
    const dots = STAGES.map(function (s) {
      return '<span class="dot ' + (stageDone(p, s.key) ? "on" : "") + '" title="' + escapeHtml(s.label) + '"></span>';
    }).join("");
    return '<div class="pedido-row" data-action="open-pedido" data-id="' + escapeHtml(p.id) + '">' +
      '<div class="info">' +
        '<div class="num">Pedido ' + escapeHtml(p.numero || p.id) + '</div>' +
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
      rows +
    '</main>';

  function chip(key, label) {
    return '<button class="chip ' + (filter === key ? "active" : "") + '" data-action="filter" data-filter="' + key + '">' + label + '</button>';
  }
}

function renderPedido(user) {
  const p = state.pedidoData;
  if (!p) {
    return renderTopbar({ title: "Carregando…", back: "go-home" }) + '<main><div class="empty">Abrindo pedido…</div></main>';
  }
  const stagesHtml = STAGES.map(function (s) {
    const etapa = (p.etapas && p.etapas[s.key]) || { fotos: [] };
    const fotos = etapa.fotos || [];
    const dispensado = s.key === "descarregamento" && !!etapa.dispensado;
    const done = fotos.length > 0 || dispensado;
    const last = fotos.length ? fotos[fotos.length - 1] : null;
    const badgeLabel = fotos.length > 0 ? "Concluído" : (dispensado ? "Sem entrega" : "Pendente");

    const grid = fotos.map(function (f, idx) {
      const locHtml = f.localizacao
        ? '<a class="tag-loc" href="' + escapeHtml(mapLink(f.localizacao)) + '" target="_blank" rel="noopener">📍 Ver no mapa</a>'
        : (f.semLocalizacao ? '<span class="tag-loc off">📍 sem GPS</span>' : '');
      return '<div class="photothumb">' +
        '<img src="' + escapeHtml(f.url) + '" loading="lazy" data-action="view-photo" data-url="' + escapeHtml(f.url) + '">' +
        '<button class="rm" data-action="remove-photo" data-etapa="' + s.key + '" data-idx="' + idx + '" title="Corrigir foto">✕</button>' +
        '<div class="tag">' + escapeHtml(f.usuario) + '<br>' + formatDateTime(f.criadoEm) + (locHtml ? '<br>' + locHtml : '') + '</div>' +
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
      (grid ? '<div class="photogrid">' + grid + '</div>' : '') +
      (dispensado ? '' : '<button class="camerabtn" data-action="take-photo" data-etapa="' + s.key + '">📷 Tirar foto</button>') +
      dispensarHtml +
    '</div>';
  }).join("");

  return renderTopbar({ title: "Pedido " + escapeHtml(p.numero || p.id), sub: "criado por " + escapeHtml(p.criadoPor || "—") + " em " + formatDateTime(p.criadoEm), back: "go-home" }) +
    '<main>' + stagesHtml + '</main>' +
    hiddenFileInputs();
}

function hiddenFileInputs() {
  return STAGES.map(function (s) {
    return '<input type="file" id="file-' + s.key + '" accept="image/*" capture="environment" multiple>';
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
    const dots = STAGES.map(function (s) {
      return '<span class="dot ' + (stageDone(p, s.key) ? "on" : "") + '"></span>';
    }).join("");
    let body = "";
    if (open) {
      body = '<div class="adm-body">' +
        STAGES.map(function (s) {
          const etapa = (p.etapas && p.etapas[s.key]) || { fotos: [] };
          const fotos = etapa.fotos || [];
          const thumbs = fotos.map(function (f) {
            const locHtml = f.localizacao
              ? '<a class="tag-loc" href="' + escapeHtml(mapLink(f.localizacao)) + '" target="_blank" rel="noopener">📍 Ver no mapa</a>'
              : (f.semLocalizacao ? '<span class="tag-loc off">📍 sem GPS</span>' : '');
            return '<div class="photothumb"><img src="' + escapeHtml(f.url) + '" loading="lazy" data-action="view-photo" data-url="' + escapeHtml(f.url) + '">' +
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
          '<div class="num">Pedido ' + escapeHtml(p.numero || p.id) + '</div>' +
          '<div class="meta">' + escapeHtml(p.criadoPor || "") + ' · ' + formatDateTime(p.criadoEm) + '</div>' +
          '<div class="dots">' + dots + '</div>' +
        '</div>' +
        '<div class="chevron">' + (open ? "︿" : "﹀") + '</div>' +
      '</div>' + body +
    '</div>';
  }).join("");

  return renderTopbar({ title: "Painel ADM", back: "go-home" }) +
    '<main>' +
      '<div class="stat-grid">' +
        '<div class="stat"><div class="n">' + total + '</div><div class="l">pedidos</div></div>' +
        '<div class="stat"><div class="n">' + concl + '</div><div class="l">concluídos</div></div>' +
        '<div class="stat"><div class="n">' + pend + '</div><div class="l">em andamento</div></div>' +
      '</div>' +
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
    openLightbox(el.getAttribute("data-url"));
  } else if (action === "close-lightbox") {
    closeLightbox();
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
