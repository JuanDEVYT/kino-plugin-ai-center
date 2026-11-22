/**
 * AI Center for Kino
 * Asistente inteligente nativo con kino.ai, biblioteca kino.library,
 * enriquecimiento TMDB, tarjetas interactivas de películas, gestión de listas,
 * historial persistente con storageLarge e integración musical con YTMusic.
 */

// Helper seguro para acceder a kino global
function getKino() {
  return typeof kino !== "undefined" ? kino : null;
}

function generateId() {
  return "id_" + Date.now().toString(36) + "_" + Math.random().toString(36).substring(2, 7);
}

// ---------------------------------------------------------------------------
// 1. SERVICIOS DE METADATOS Y TMDB
// ---------------------------------------------------------------------------
async function fetchTmdbMovie(query, year) {
  const k = getKino();
  if (!k || typeof k.tmdb !== "function") return null;
  try {
    const params = { query: query.trim(), language: "es-ES", include_adult: false };
    if (year) params.year = year;
    const res = await k.tmdb("/search/movie", params);
    if (res && Array.isArray(res.results) && res.results.length > 0) {
      const best = res.results[0];
      return {
        tmdbId: best.id,
        title: best.title || query,
        year: (best.release_date || "").slice(0, 4) || year || "",
        rating: best.vote_average ? Math.round(best.vote_average * 10) / 10 : null,
        overview: best.overview || "",
        poster: best.poster_path ? ("https://image.tmdb.org/t/p/w342" + best.poster_path) : null,
        backdrop: best.backdrop_path ? ("https://image.tmdb.org/t/p/w780" + best.backdrop_path) : null
      };
    }
  } catch (_) {}
  return null;
}

// ---------------------------------------------------------------------------
// 2. BIBLIOTECA DEL USUARIO (kino.library)
// ---------------------------------------------------------------------------
async function getUserLibraryContext() {
  const k = getKino();
  const context = { watchedTitles: [], savedTitles: [] };
  if (!k) return context;
  try {
    if (typeof k.library === "object") {
      if (typeof k.library.watched === "function") {
        const watched = await k.library.watched({ limit: 30, kind: "movie" });
        if (Array.isArray(watched)) {
          context.watchedTitles = watched.map(function(w) { return w.title; }).filter(Boolean);
        }
      }
      if (typeof k.library.saved === "function") {
        const saved = await k.library.saved({ limit: 30, kind: "movie" });
        if (Array.isArray(saved)) {
          context.savedTitles = saved.map(function(s) { return s.title; }).filter(Boolean);
        }
      }
    }
  } catch (_) {}
  return context;
}

// ---------------------------------------------------------------------------
// 3. PERSISTENCIA CON storageLarge (16 MB)
// ---------------------------------------------------------------------------
async function getSessionsIndex() {
  const k = getKino();
  if (!k || !k.storage || !k.storage.get) return [];
  try {
    const data = await k.storage.get("ai_sessions_index");
    if (data && Array.isArray(data.items)) return data.items;
  } catch (_) {}
  return [];
}

async function saveSessionsIndex(items) {
  const k = getKino();
  if (!k || !k.storage || !k.storage.set) return;
  try {
    await k.storage.set("ai_sessions_index", { items: items });
  } catch (_) {}
}

async function getSessionMessages(sessionId) {
  const k = getKino();
  if (!k || !k.storage || !k.storage.get || !sessionId) return [];
  try {
    const data = await k.storage.get("ai_session_" + sessionId);
    if (data && Array.isArray(data.messages)) return data.messages;
  } catch (_) {}
  return [];
}

async function saveSessionMessages(sessionId, messages) {
  const k = getKino();
  if (!k || !k.storage || !k.storage.set || !sessionId) return;
  try {
    await k.storage.set("ai_session_" + sessionId, { messages: messages, updatedAt: Date.now() });
  } catch (_) {}
}

async function getCustomLists() {
  const k = getKino();
  if (!k || !k.storage || !k.storage.get) {
    return [
      {
        id: "default_favs",
        name: "Favoritas de Siempre",
        description: "Mis películas imprescindibles",
        movies: [
          { title: "Interestelar", year: "2014", tmdbId: 157336, poster: "https://image.tmdb.org/t/p/w342/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg", rating: 8.4 }
        ]
      }
    ];
  }
  try {
    const data = await k.storage.get("ai_custom_lists");
    if (data && Array.isArray(data.items)) return data.items;
  } catch (_) {}
  return [
    {
      id: "default_favs",
      name: "Favoritas de Siempre",
      description: "Mis películas imprescindibles",
      movies: [
        { title: "Interestelar", year: "2014", tmdbId: 157336, poster: "https://image.tmdb.org/t/p/w342/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg", rating: 8.4 }
      ]
    }
  ];
}

async function saveCustomLists(items) {
  const k = getKino();
  if (!k || !k.storage || !k.storage.set) return;
  try {
    await k.storage.set("ai_custom_lists", { items: items });
  } catch (_) {}
}

async function getMusicPreferences() {
  const k = getKino();
  if (!k || !k.storage || !k.storage.get) {
    return {
      genres: ["Bandas Sonoras", "Synthwave / Cyberpunk", "Ambiental de Cine"],
      artists: ["Hans Zimmer", "Ennio Morricone", "John Williams", "Vangelis", "Ludwig Göransson"]
    };
  }
  try {
    const prefs = await k.storage.get("ai_music_prefs");
    if (prefs && typeof prefs === "object" && Array.isArray(prefs.genres)) return prefs;
  } catch (_) {}
  return {
    genres: ["Bandas Sonoras", "Synthwave / Cyberpunk", "Ambiental de Cine"],
    artists: ["Hans Zimmer", "Ennio Morricone", "John Williams", "Vangelis", "Ludwig Göransson"]
  };
}

// ---------------------------------------------------------------------------
// 4. MOTOR INTELIGENTE (kino.ai)
// ---------------------------------------------------------------------------
async function askAI(prompt, system, isJson) {
  const k = getKino();
  if (k && typeof k.ai === "object" && typeof k.ai.ask === "function") {
    try {
      const res = await k.ai.ask({
        prompt: prompt,
        system: system,
        json: !!isJson,
        maxChars: 2500
      });
      if (res && res.ok && res.text) return res.text;
    } catch (_) {}
  }
  return null;
}

// ---------------------------------------------------------------------------
// 5. EXTRACTOR Y ENRIQUECEDOR DE PELÍCULAS CON TMDB
// ---------------------------------------------------------------------------
async function enrichRecommendedMovies(text) {
  const movies = [];
  const regex = /(?:película|películas|film|obra|cinta|título|ve|mira)?[:\s]*["“]([^"”]+)["”](?:\s*\((\d{4})\))?/gi;
  let match;
  const titlesSeen = new Set();

  while ((match = regex.exec(text)) !== null) {
    const rawTitle = match[1].trim();
    const year = match[2] || null;
    if (rawTitle.length > 1 && !titlesSeen.has(rawTitle.toLowerCase())) {
      titlesSeen.add(rawTitle.toLowerCase());
      const meta = await fetchTmdbMovie(rawTitle, year);
      if (meta) {
        movies.push(meta);
      } else {
        movies.push({
          title: rawTitle,
          year: year || "",
          overview: "Recomendada por AI Center",
          rating: null,
          poster: null,
          tmdbId: null
        });
      }
    }
    if (movies.length >= 4) break;
  }
  return movies;
}

// ---------------------------------------------------------------------------
// 6. EXPORTS DE CONTRATO KINO
// ---------------------------------------------------------------------------
export async function home() {
  return [
    {
      type: "hero",
      title: "AI Center",
      subtitle: "Tu centro inteligente de cine, listas y música",
      action: { screen: { route: "main" } }
    }
  ];
}

// ---------------------------------------------------------------------------
// 7. VISTAS SCREEN (Scaffold + NavigationBar)
// ---------------------------------------------------------------------------
export async function screen(args) {
  const state = (args && args.state) || {};
  const currentTab = state.currentTab || "chat"; // "chat" | "lists" | "music" | "sessions"
  const currentSessionId = state.currentSessionId || "default";

  // Cargar mensajes si no están en state
  let messages = Array.isArray(state.messages) ? state.messages : [];
  if (messages.length === 0 && currentTab === "chat") {
    messages = await getSessionMessages(currentSessionId);
  }

  const customLists = Array.isArray(state.customLists) ? state.customLists : await getCustomLists();
  const musicPrefs = state.musicPrefs || (await getMusicPreferences());
  const sessionsIndex = Array.isArray(state.sessionsIndex) ? state.sessionsIndex : await getSessionsIndex();

  let bodyContent;
  if (currentTab === "lists") {
    bodyContent = renderListsTab(customLists);
  } else if (currentTab === "music") {
    bodyContent = renderMusicTab(musicPrefs);
  } else if (currentTab === "sessions") {
    bodyContent = renderSessionsTab(sessionsIndex, currentSessionId);
  } else {
    bodyContent = renderChatTab(messages, state.loading);
  }

  return {
    type: "Scaffold",
    appBar: {
      type: "AppBar",
      mergeWithKinoBar: true,
      dense: true,
      title: currentTab === "lists" ? "Mis Listas" : currentTab === "music" ? "Tus Gustos Musicales" : currentTab === "sessions" ? "Historial de Sesiones" : "AI Center",
      leading: {
        type: "IconButton",
        icon: "close",
        labelText: "Cerrar",
        onPressed: { close: true }
      },
      actions: [
        {
          type: "IconButton",
          icon: "refresh",
          labelText: "Nuevo chat",
          onPressed: { event: "new_chat" }
        }
      ]
    },
    body: bodyContent,
    bottomNavigationBar: {
      type: "NavigationBar",
      value: currentTab,
      onChanged: "nav_change",
      items: [
        { key: "chat", icon: "magic", label: "Chat" },
        { key: "lists", icon: "list", label: "Mis Listas" },
        { key: "music", icon: "music", label: "Música" },
        { key: "sessions", icon: "sync", label: "Sesiones" }
      ]
    }
  };
}

// ---------------------------------------------------------------------------
// 8. RENDERIZADO DE TABS
// ---------------------------------------------------------------------------

// TAB: CHAT
function renderChatTab(messages, loading) {
  const listItems = [];

  // Bienvenida inicial si no hay mensajes
  if (messages.length === 0) {
    listItems.push({
      type: "Column",
      key: "welcome_hero",
      padding: { top: 24, bottom: 16, start: 16, end: 16 },
      gap: 12,
      children: [
        {
          type: "Icon",
          name: "magic",
          color: "primary"
        },
        {
          type: "Text",
          text: "AI Center",
          style: "h2",
          textAlign: "center"
        },
        {
          type: "Text",
          text: "Tu asistente cinéfilo inteligente. Pide recomendaciones, juega trivia, crea listas o descubre películas afines a tus gustos.",
          style: "body",
          color: "muted",
          textAlign: "center"
        },
        {
          type: "Row",
          wrap: true,
          gap: 8,
          children: [
            {
              type: "Button",
              label: "🎯 ¿Qué veo hoy?",
              variant: "primary",
              onTap: { event: "random_pick" }
            },
            {
              type: "Button",
              label: "🎲 Jugar Trivia",
              variant: "secondary",
              onTap: { event: "play_trivia" }
            },
            {
              type: "Button",
              label: "🎬 Joyas Sci-Fi",
              variant: "secondary",
              onTap: { event: "quick_prompt", arg: "Recomiéndame 3 joyas ocultas de ciencia ficción con giro de guion" }
            },
            {
              type: "Button",
              label: "🍿 Cine en Pareja",
              variant: "secondary",
              onTap: { event: "quick_prompt", arg: "Recomienda películas ligeras y entretenidas para ver un sábado por la noche" }
            }
          ]
        }
      ]
    });
  }

  // Renderizar mensajes del thread
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const isUser = msg.role === "user";

    if (isUser) {
      listItems.push({
        type: "Row",
        key: "msg_user_" + i,
        mainAxisAlignment: "end",
        children: [
          {
            type: "Card",
            variant: "filled",
            padding: 12,
            children: [
              {
                type: "Text",
                text: msg.text || ""
              }
            ]
          }
        ]
      });
    } else {
      // Mensaje de la IA
      const cardChildren = [
        {
          type: "Row",
          gap: 8,
          children: [
            { type: "Icon", name: "magic", color: "primary" },
            { type: "Text", text: "AI Center", bold: true, color: "primary" }
          ]
        },
        {
          type: "Text",
          text: msg.text || ""
        }
      ];

      // Tarjetas de películas recomendadas
      if (Array.isArray(msg.movies) && msg.movies.length > 0) {
        cardChildren.push({ type: "Divider" });
        cardChildren.push({
          type: "Text",
          text: "Fichas recomendadas (toca para ver o buscar):",
          style: "caption",
          bold: true
        });

        for (let m = 0; m < msg.movies.length; m++) {
          const mov = msg.movies[m];
          cardChildren.push(renderMovieCard(mov, i + "_" + m));
        }
      }

      listItems.push({
        type: "Row",
        key: "msg_ai_" + i,
        mainAxisAlignment: "start",
        children: [
          {
            type: "Card",
            variant: "outlined",
            padding: 12,
            children: cardChildren
          }
        ]
      });
    }
  }

  if (loading) {
    listItems.push({
      type: "Row",
      key: "loading_indicator",
      mainAxisAlignment: "start",
      children: [
        {
          type: "Card",
          variant: "outlined",
          padding: 12,
          children: [
            {
              type: "Row",
              gap: 8,
              children: [
                { type: "Icon", name: "magic", color: "primary" },
                { type: "Text", text: "AI Center está pensando y consultando fichas en TMDB...", style: "caption" }
              ]
            }
          ]
        }
      ]
    });
  }

  return {
    type: "Column",
    children: [
      {
        type: "ListView",
        key: "chat_thread",
        flex: 1,
        stickToBottom: true,
        newItemsHint: true,
        padding: 16,
        gap: 12,
        items: listItems
      },
      {
        type: "Column",
        padding: { start: 12, end: 12, bottom: 8, top: 4 },
        gap: 4,
        children: [
          {
            type: "TextField",
            key: "prompt",
            hintText: "Pregunta a AI Center, pide recomendaciones o listas...",
            onSubmitted: "send_message",
            trailingIcon: "send",
            trailingLabel: "Enviar",
            onTrailingTap: "send_message",
            maxLength: 1000
          },
          {
            type: "Text",
            text: "IA nativa de Kino · TMDB · Historial en storageLarge",
            style: "caption",
            color: "muted",
            textAlign: "center"
          }
        ]
      }
    ]
  };
}

// TARJETA DE PELÍCULA ENRIQUECIDA CON TMDB Y ACCIONES
function renderMovieCard(mov, keySuffix) {
  const rowChildren = [];

  if (mov.poster) {
    rowChildren.push({
      type: "Image",
      url: mov.poster,
      aspect: "2:3",
      width: 80
    });
  }

  const detailsChildren = [
    {
      type: "Row",
      gap: 8,
      children: [
        { type: "Text", text: mov.title, bold: true },
        mov.year ? { type: "Text", text: "(" + mov.year + ")", style: "caption", color: "muted" } : null,
        mov.rating ? { type: "Badge", label: "★ " + mov.rating, color: "primary" } : null
      ].filter(Boolean)
    }
  ];

  if (mov.overview) {
    detailsChildren.push({
      type: "Text",
      text: mov.overview.length > 140 ? mov.overview.slice(0, 137) + "..." : mov.overview,
      style: "caption"
    });
  }

  // Botones de acción directa
  const actionsRow = [];
  if (mov.tmdbId) {
    actionsRow.push({
      type: "Button",
      label: "Ver en Kino",
      icon: "movie",
      variant: "primary",
      onTap: {
        go: {
          titleByIds: {
            tmdb: mov.tmdbId,
            kind: "movie",
            title: mov.title,
            year: mov.year ? parseInt(mov.year, 10) : undefined
          }
        }
      }
    });
  }

  actionsRow.push({
    type: "Button",
    label: "Buscar fuentes",
    icon: "search",
    variant: "secondary",
    onTap: {
      go: {
        search: {
          q: mov.title,
          scope: "all"
        }
      }
    }
  });

  actionsRow.push({
    type: "Button",
    label: "+ Guardar en lista",
    icon: "bookmark",
    variant: "text",
    onTap: {
      event: "add_to_list",
      arg: JSON.stringify({
        title: mov.title,
        year: mov.year,
        poster: mov.poster,
        rating: mov.rating,
        tmdbId: mov.tmdbId
      })
    }
  });

  detailsChildren.push({
    type: "Row",
    wrap: true,
    gap: 8,
    children: actionsRow
  });

  rowChildren.push({
    type: "Column",
    flex: 1,
    gap: 4,
    children: detailsChildren
  });

  return {
    type: "Card",
    key: "movie_card_" + keySuffix,
    variant: "filled",
    padding: 8,
    children: [
      {
        type: "Row",
        gap: 12,
        children: rowChildren
      }
    ]
  };
}

// TAB: MIS LISTAS
function renderListsTab(customLists) {
  const items = [
    {
      type: "Row",
      key: "lists_header",
      mainAxisAlignment: "spaceBetween",
      children: [
        {
          type: "Column",
          children: [
            { type: "Text", text: "Mis Listas Personalizadas", style: "h3" },
            { type: "Text", text: "Gestiona colecciones curadas por ti y la IA", style: "caption", color: "muted" }
          ]
        },
        {
          type: "Button",
          label: "+ Nueva Lista",
          icon: "add",
          variant: "primary",
          onTap: { event: "prompt_create_list" }
        }
      ]
    }
  ];

  if (!customLists || customLists.length === 0) {
    items.push({
      type: "Card",
      key: "empty_lists",
      variant: "outlined",
      padding: 16,
      children: [
        { type: "Text", text: "No tienes listas creadas aún.", textAlign: "center" },
        { type: "Text", text: "Pídele a AI Center en el chat: 'Crea una lista llamada Joyas Ocultas'", style: "caption", color: "muted", textAlign: "center" }
      ]
    });
  } else {
    for (let i = 0; i < customLists.length; i++) {
      const list = customLists[i];
      const movieChips = (list.movies || []).map(function(m, idx) {
        return {
          type: "Button",
          label: m.title + (m.year ? " (" + m.year + ")" : ""),
          icon: "movie",
          variant: "secondary",
          onTap: {
            go: { search: { q: m.title, scope: "all" } }
          }
        };
      });

      items.push({
        type: "Card",
        key: "list_card_" + i,
        variant: "filled",
        padding: 16,
        children: [
          {
            type: "Row",
            mainAxisAlignment: "spaceBetween",
            children: [
              {
                type: "Column",
                children: [
                  { type: "Text", text: list.name, style: "h3", bold: true },
                  list.description ? { type: "Text", text: list.description, style: "caption", color: "muted" } : null
                ].filter(Boolean)
              },
              {
                type: "Button",
                label: "Borrar",
                icon: "remove",
                variant: "text",
                onTap: { event: "delete_list", arg: list.id || list.name }
              }
            ]
          },
          { type: "Divider" },
          movieChips.length > 0 ? {
            type: "Row",
            wrap: true,
            gap: 8,
            children: movieChips
          } : {
            type: "Text",
            text: "Lista vacía. Añade títulos desde el chat.",
            style: "caption",
            color: "muted"
          }
        ]
      });
    }
  }

  return {
    type: "ListView",
    key: "lists_view",
    padding: 16,
    gap: 16,
    items: items
  };
}

// TAB: MÚSICA & GUSTOS (CONECTADO A YTMUSIC)
function renderMusicTab(musicPrefs) {
  const genres = (musicPrefs && musicPrefs.genres) || [];
  const artists = (musicPrefs && musicPrefs.artists) || [];

  return {
    type: "ListView",
    key: "music_view",
    padding: 16,
    gap: 16,
    items: [
      {
        type: "Column",
        gap: 4,
        children: [
          { type: "Text", text: "Tus Gustos Musicales & Bandas Sonoras", style: "h3" },
          { type: "Text", text: "Integración con tu plugin YTMusic. Toca cualquier elemento para reproducir en YouTube Music.", style: "caption", color: "muted" }
        ]
      },
      {
        type: "Card",
        variant: "filled",
        padding: 16,
        children: [
          { type: "Text", text: "Géneros Cinéfilos Favoritos", bold: true },
          {
            type: "Row",
            wrap: true,
            gap: 8,
            children: genres.map(function(g) {
              return {
                type: "Button",
                label: g,
                variant: "secondary",
                onTap: { go: { search: { q: g + " music", scope: "all" } } }
              };
            })
          }
        ]
      },
      {
        type: "Card",
        variant: "filled",
        padding: 16,
        children: [
          { type: "Text", text: "Compositores de Cine Recomendados", bold: true },
          {
            type: "Row",
            wrap: true,
            gap: 8,
            children: artists.map(function(a) {
              return {
                type: "Button",
                label: a,
                icon: "music",
                variant: "secondary",
                onTap: { go: { search: { q: a + " soundtrack", scope: "all" } } }
              };
            })
          }
        ]
      },
      {
        type: "Card",
        variant: "outlined",
        padding: 16,
        children: [
          { type: "Text", text: "Generadores de Música con IA", bold: true },
          {
            type: "Row",
            wrap: true,
            gap: 8,
            children: [
              {
                type: "Button",
                label: "🎵 Recomiéndame un Soundtrack Épico",
                variant: "primary",
                onTap: {
                  event: "quick_music_prompt",
                  arg: "Recomiéndame 3 bandas sonoras épicas de películas que debería escuchar en YouTube Music"
                }
              },
              {
                type: "Button",
                label: "🎧 Música para estudiar (Cine Instrumental)",
                variant: "secondary",
                onTap: {
                  event: "quick_music_prompt",
                  arg: "Sugiere 3 temas instrumentales de películas ideales para concentrarse o estudiar"
                }
              }
            ]
          }
        ]
      }
    ]
  };
}

// TAB: SESIONES (storageLarge)
function renderSessionsTab(sessionsIndex, currentSessionId) {
  const items = [
    {
      type: "Row",
      key: "sessions_header",
      mainAxisAlignment: "spaceBetween",
      children: [
        {
          type: "Column",
          children: [
            { type: "Text", text: "Historial de Conversaciones", style: "h3" },
            { type: "Text", text: "Respaldadas en el almacenamiento de 16 MB de Kino", style: "caption", color: "muted" }
          ]
        },
        {
          type: "Button",
          label: "+ Nuevo Chat",
          icon: "refresh",
          variant: "primary",
          onTap: { event: "new_chat" }
        }
      ]
    }
  ];

  if (!sessionsIndex || sessionsIndex.length === 0) {
    items.push({
      type: "Card",
      key: "no_sessions",
      variant: "outlined",
      padding: 16,
      children: [
        { type: "Text", text: "No hay conversaciones previas.", textAlign: "center" },
        { type: "Text", text: "Tus conversaciones se guardan automáticamente en storageLarge conforme hablas.", style: "caption", color: "muted", textAlign: "center" }
      ]
    });
  } else {
    for (let i = 0; i < sessionsIndex.length; i++) {
      const sess = sessionsIndex[i];
      const isCurrent = sess.id === currentSessionId;

      items.push({
        type: "Card",
        key: "session_" + sess.id,
        variant: isCurrent ? "outlined" : "filled",
        padding: 12,
        children: [
          {
            type: "Row",
            mainAxisAlignment: "spaceBetween",
            children: [
              {
                type: "Column",
                flex: 1,
                children: [
                  { type: "Text", text: sess.title || "Conversación", bold: true },
                  { type: "Text", text: sess.preview || "Sin vista previa", style: "caption", color: "muted" }
                ]
              },
              {
                type: "Row",
                gap: 4,
                children: [
                  {
                    type: "Button",
                    label: isCurrent ? "Activa" : "Abrir",
                    variant: isCurrent ? "secondary" : "primary",
                    onTap: { event: "load_session", arg: sess.id }
                  },
                  {
                    type: "Button",
                    label: "Borrar",
                    icon: "remove",
                    variant: "text",
                    onTap: { event: "delete_session", arg: sess.id }
                  }
                ]
              }
            ]
          }
        ]
      });
    }
  }

  return {
    type: "ListView",
    key: "sessions_view",
    padding: 16,
    gap: 12,
    items: items
  };
}

// ---------------------------------------------------------------------------
// 9. GESTIÓN DE EVENTOS (screenEvent)
// ---------------------------------------------------------------------------
export async function screenEvent(args) {
  const name = args.name || "";
  const arg = args.arg;
  const value = args.value;
  const state = args.state || {};
  const currentTab = state.currentTab || "chat";
  const currentSessionId = state.currentSessionId || "default";

  // Cambio de pestaña en NavigationBar
  if (name === "nav_change") {
    const nextTab = value || arg || "chat";
    return {
      state: Object.assign({}, state, { currentTab: nextTab })
    };
  }

  // Nuevo chat
  if (name === "new_chat") {
    const newId = generateId();
    return {
      state: Object.assign({}, state, {
        currentTab: "chat",
        currentSessionId: newId,
        messages: [],
        loading: false
      }),
      toast: "Nueva conversación iniciada"
    };
  }

  // Cargar sesión guardada
  if (name === "load_session") {
    const sid = arg;
    const msgs = await getSessionMessages(sid);
    return {
      state: Object.assign({}, state, {
        currentTab: "chat",
        currentSessionId: sid,
        messages: msgs,
        loading: false
      }),
      toast: "Conversación cargada"
    };
  }

  // Borrar sesión
  if (name === "delete_session") {
    const sid = arg;
    let idx = await getSessionsIndex();
    idx = idx.filter(function(s) { return s.id !== sid; });
    await saveSessionsIndex(idx);
    const k = getKino();
    if (k && k.storage && k.storage.set) {
      await k.storage.set("ai_session_" + sid, { messages: [] });
    }
    return {
      state: Object.assign({}, state, {
        sessionsIndex: idx,
        currentSessionId: currentSessionId === sid ? generateId() : currentSessionId,
        messages: currentSessionId === sid ? [] : state.messages
      }),
      toast: "Conversación eliminada"
    };
  }

  // Guardar película en lista personalizada
  if (name === "add_to_list") {
    try {
      const movieData = JSON.parse(arg);
      const lists = await getCustomLists();
      if (lists.length > 0) {
        if (!lists[0].movies) lists[0].movies = [];
        const exists = lists[0].movies.some(function(m) { return m.title === movieData.title; });
        if (!exists) {
          lists[0].movies.push(movieData);
          await saveCustomLists(lists);
          return {
            state: Object.assign({}, state, { customLists: lists }),
            toast: "Añadida a \"" + lists[0].name + "\""
          };
        } else {
          return { toast: "Ya estaba en la lista" };
        }
      }
    } catch (_) {}
    return { toast: "No se pudo añadir a la lista" };
  }

  // Borrar lista
  if (name === "delete_list") {
    let lists = await getCustomLists();
    lists = lists.filter(function(l) { return l.id !== arg && l.name !== arg; });
    await saveCustomLists(lists);
    return {
      state: Object.assign({}, state, { customLists: lists }),
      toast: "Lista eliminada"
    };
  }

  // Selector al azar inteligente basado en gustos del usuario
  if (name === "random_pick") {
    const libraryCtx = await getUserLibraryContext();
    let promptText = "Recomienda exactamente UNA película al azar que sea una obra maestra.";
    if (libraryCtx.watchedTitles.length > 0) {
      promptText = "El usuario ha visto y disfrutado películas como: " + libraryCtx.watchedTitles.slice(0, 10).join(", ") + ". " +
        "Basado en estos gustos y patrones cinematográficos, selecciona al azar UNA película brillante y afín que NO esté en su lista de vistas. " +
        "Indica su título entre comillas, año, género y por qué encaja perfectamente con su estilo.";
    }

    const systemPrompt = "Eres el selector inteligente de cine de AI Center. Recomienda una película brillante. Escribe siempre el título principal entre comillas con su año, por ejemplo: \"Interestelar\" (2014).";
    const answer = await askAI(promptText, systemPrompt);
    const textToShow = answer || "Te recomiendo ver \"Blade Runner 2049\" (2017). Una joya visual y narrativa de ciencia ficción con una ambientación y banda sonora inigualables.";
    const movies = await enrichRecommendedMovies(textToShow);

    let messages = Array.isArray(state.messages) ? state.messages.slice() : [];
    messages.push({ role: "user", text: "🎯 ¿Qué veo hoy?" });
    messages.push({ role: "assistant", text: textToShow, movies: movies });

    await persistCurrentSession(currentSessionId, messages);

    return {
      state: Object.assign({}, state, { messages: messages, loading: false }),
      toast: "¡Película seleccionada según tus gustos!"
    };
  }

  // Jugar Trivia de cine
  if (name === "play_trivia") {
    const triviaPrompt = "Crea una trivia cinematográfica divertida. Da 3 pistas sobre una película clásica o de culto sin revelar su nombre jamás. Desafía al usuario a adivinar el título.";
    const systemPrompt = "Eres un maestro de trivia de cine en AI Center. Nunca reveles el título en las pistas.";
    const triviaText = (await askAI(triviaPrompt, systemPrompt)) ||
      "🎲 **¡Trivia de cine!**\n1. Un grupo de astronautas atraviesa un agujero de gusano cerca de Saturno.\n2. El tiempo en un planeta con olas gigantes transcurre mucho más rápido que en la Tierra.\n3. La banda sonora fue compuesta por Hans Zimmer en un órgano de iglesia.\n\n¿Qué película es? ¡Escribe tu respuesta abajo!";

    let messages = Array.isArray(state.messages) ? state.messages.slice() : [];
    messages.push({ role: "user", text: "🎲 Jugar Trivia de Cine" });
    messages.push({ role: "assistant", text: triviaText, movies: [] });

    await persistCurrentSession(currentSessionId, messages);

    return {
      state: Object.assign({}, state, { messages: messages, loading: false })
    };
  }

  // Prompts rápidos de música
  if (name === "quick_music_prompt") {
    const userPrompt = arg;
    const answer = await askAI(userPrompt, "Eres un experto en bandas sonoras de cine y su conexión con YouTube Music.");
    const text = answer || "Aquí tienes 3 bandas sonoras imprescindibles:\n1. \"Interstellar\" de Hans Zimmer\n2. \"The Lord of the Rings\" de Howard Shore\n3. \"Blade Runner\" de Vangelis.\nPuedes buscarlas directamente en YTMusic con los botones de arriba.";
    const movies = await enrichRecommendedMovies(text);

    let messages = Array.isArray(state.messages) ? state.messages.slice() : [];
    messages.push({ role: "user", text: userPrompt });
    messages.push({ role: "assistant", text: text, movies: movies });

    await persistCurrentSession(currentSessionId, messages);

    return {
      state: Object.assign({}, state, { currentTab: "chat", messages: messages, loading: false })
    };
  }

  // Prompt rápido
  if (name === "quick_prompt") {
    const userPrompt = arg;
    const answer = await askAI(userPrompt, "Eres AI Center, asistente cinéfilo experto. Pon los títulos de películas recomendadas entre comillas con su año, ej: \"Matrix\" (1999).");
    const text = answer || "Aquí tienes excelentes recomendaciones:\n- \"Matrix\" (1999)\n- \"Arrival\" (2016)\n- \"Dark City\" (1998)";
    const movies = await enrichRecommendedMovies(text);

    let messages = Array.isArray(state.messages) ? state.messages.slice() : [];
    messages.push({ role: "user", text: userPrompt });
    messages.push({ role: "assistant", text: text, movies: movies });

    await persistCurrentSession(currentSessionId, messages);

    return {
      state: Object.assign({}, state, { messages: messages, loading: false })
    };
  }

  // Enviar mensaje del usuario
  if (name === "send_message") {
    const userText = (value && typeof value === "object" && value.prompt) ? value.prompt.trim() : (state.inputs && state.inputs.prompt ? state.inputs.prompt.trim() : (typeof value === "string" ? value.trim() : ""));
    if (!userText) return null;

    let messages = Array.isArray(state.messages) ? state.messages.slice() : [];
    messages.push({ role: "user", text: userText });

    const libraryCtx = await getUserLibraryContext();
    const lists = await getCustomLists();

    let sysPrompt = "Eres AI Center, asistente cinéfilo experto de Kino. Responde de forma amable, analítica y entusiasta. " +
      "Cuando recomiendes películas, menciona sus títulos entre comillas con su año, por ejemplo: \"Interestelar\" (2014) o \"El Padrino\" (1972).";

    if (libraryCtx.watchedTitles.length > 0) {
      sysPrompt += " Películas vistas recientemente por el usuario: " + libraryCtx.watchedTitles.slice(0, 8).join(", ") + ".";
    }

    const aiResponse = await askAI(userText, sysPrompt);
    const finalAiText = aiResponse || "Te recomiendo explorar \"Interestelar\" (2014) y \"Dune\" (2021). Son dos obras que destacan por su diseño sonoro y profundidad temática.";
    const movies = await enrichRecommendedMovies(finalAiText);

    messages.push({
      role: "assistant",
      text: finalAiText,
      movies: movies
    });

    await persistCurrentSession(currentSessionId, messages);

    return {
      state: Object.assign({}, state, {
        messages: messages,
        loading: false,
        inputs: {}
      })
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// 10. HELPER DE PERSISTENCIA storageLarge
// ---------------------------------------------------------------------------
async function persistCurrentSession(sessionId, messages) {
  await saveSessionMessages(sessionId, messages);

  let idx = await getSessionsIndex();
  const preview = messages.length > 0 ? (messages[messages.length - 1].text || "").slice(0, 60) : "Conversación";
  const title = messages.length > 0 ? (messages[0].text || "Conversación").slice(0, 30) : "Conversación";

  const existingIdx = idx.findIndex(function(s) { return s.id === sessionId; });
  if (existingIdx >= 0) {
    idx[existingIdx].updatedAt = Date.now();
    idx[existingIdx].preview = preview;
  } else {
    idx.unshift({
      id: sessionId,
      title: title,
      preview: preview,
      updatedAt: Date.now()
    });
  }
  if (idx.length > 25) idx = idx.slice(0, 25);
  await saveSessionsIndex(idx);
}
