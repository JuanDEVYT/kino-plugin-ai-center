/**
 * AI Center for Kino
 * Asistente inteligente nativo con kino.ai, biblioteca kino.library,
 * enriquecimiento TMDB, integración profunda con YTMusic (canciones con carátula y reproducción),
 * tarjetas interactivas, gestión de listas, historial persistente con storageLarge.
 */

function getKino() {
  return typeof kino !== "undefined" ? kino : null;
}

function generateId() {
  return "id_" + Date.now().toString(36) + "_" + Math.random().toString(36).substring(2, 7);
}

// ---------------------------------------------------------------------------
// 1. SERVICIOS DE METADATOS: TMDB (Películas y Series)
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
// 2. INTEGRACIÓN CON YTMUSIC: Búsqueda y Metadata Oficial
// ---------------------------------------------------------------------------
const YT_SEARCH_ENDPOINT = "https://music.youtube.com/youtubei/v1/search?prettyPrint=false";
const YT_SEARCH_PARAMS_SONGS = "EgWKAQIIAWoMEA4QChADEAQQCRAF";

async function fetchYTMusicTracks(query) {
  const q = String(query || "").trim();
  if (!q) return [];

  const payload = {
    context: {
      client: {
        clientName: "WEB_REMIX",
        clientVersion: "1.20241118.01.00",
        hl: "es",
        gl: "ES"
      }
    },
    query: q,
    params: YT_SEARCH_PARAMS_SONGS
  };

  try {
    const k = getKino();
    const fetchFn = (k && typeof k.fetch === "function") ? k.fetch.bind(k) : (typeof globalThis["fetch"] === "function" ? globalThis["fetch"] : null);
    if (!fetchFn) return [];

    const res = await fetchFn(YT_SEARCH_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Origin": "https://music.youtube.com",
        "Referer": "https://music.youtube.com/"
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) return [];
    const data = await res.json();
    const sections = data.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents || [];
    const songs = [];

    for (let s = 0; s < sections.length; s++) {
      const shelf = sections[s].musicShelfRenderer || sections[s].musicCardShelfRenderer;
      if (!shelf || !Array.isArray(shelf.contents)) continue;

      for (let i = 0; i < shelf.contents.length; i++) {
        const r = shelf.contents[i].musicResponsiveListItemRenderer;
        if (!r) continue;

        const flexCols = r.flexColumns || [];
        const col0Text = flexCols[0]?.musicResponsiveListItemFlexColumnRenderer?.text;
        const title = (col0Text?.runs || []).map(function(x) { return x.text; }).join("").trim();

        const col1Runs = flexCols[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
        const artistRuns = col1Runs.filter(function(x) {
          return x.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType === "MUSIC_PAGE_TYPE_ARTIST";
        });
        const artists = artistRuns.map(function(x) { return x.text; }).join(", ") || (col1Runs[0]?.text || "Varios Artistas");

        const albumRun = col1Runs.find(function(x) {
          return x.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType === "MUSIC_PAGE_TYPE_ALBUM";
        });
        const album = albumRun ? albumRun.text : "";

        const thumbs = r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
        let poster = thumbs.length ? thumbs[thumbs.length - 1].url : null;
        if (poster) {
          poster = poster.replace(/=w\d+-h\d+/, "=w544-h544");
        }

        const videoId = r.playlistItemData?.videoId ||
          r.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId ||
          col0Text?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId;

        if (title && (videoId || poster)) {
          songs.push({
            title: title,
            artist: artists,
            album: album,
            poster: poster,
            videoId: videoId || ""
          });
        }
        if (songs.length >= 3) break;
      }
      if (songs.length >= 3) break;
    }
    return songs;
  } catch (_) {}
  return [];
}

// ---------------------------------------------------------------------------
// 3. EXTRACTORES DE CONTENIDO (Música vs. Películas)
// ---------------------------------------------------------------------------
function isMusicIntent(text) {
  const t = (text || "").toLowerCase();
  const musicKeywords = [
    "música", "musica", "canción", "cancion", "canciones", "soundtrack", "soundtracks",
    "banda sonora", "bandas sonoras", "tema musical", "ost", "compositor", "compositores",
    "álbum", "album", "cantante", "escuchar", "ytmusic", "youtube music", "disco", "melodía", "melodia",
    "hans zimmer", "john williams", "morricone", "vangelis"
  ];
  return musicKeywords.some(function(k) { return t.includes(k); });
}

async function enrichRecommendedMusic(text, userQuery) {
  const songs = [];
  const titlesSeen = new Set();

  // 1. Extraer patrones de canciones citadas entre comillas
  const regex = /["“]([^"”]+)["”](?:\s*(?:de|by|por|-)\s*([a-zA-Z0-9\s\.\,\&]+))?/gi;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const rawSong = match[1].trim();
    const artist = (match[2] || "").trim();
    const searchTarget = artist ? (rawSong + " " + artist) : rawSong;

    if (rawSong.length > 1 && !titlesSeen.has(rawSong.toLowerCase())) {
      titlesSeen.add(rawSong.toLowerCase());
      const results = await fetchYTMusicTracks(searchTarget);
      if (results.length > 0) {
        songs.push(results[0]);
      } else {
        songs.push({
          title: rawSong,
          artist: artist || "YouTube Music",
          album: "",
          poster: null,
          videoId: ""
        });
      }
    }
    if (songs.length >= 3) break;
  }

  // 2. Si no encontró entre comillas, buscar con la intención general del usuario
  if (songs.length === 0 && userQuery) {
    const cleanQ = userQuery.replace(/recomienda(me)?|dime|canciones|musica|música|de|sobre/gi, "").trim();
    if (cleanQ.length > 2) {
      const results = await fetchYTMusicTracks(cleanQ);
      for (let j = 0; j < Math.min(results.length, 3); j++) {
        songs.push(results[j]);
      }
    }
  }

  return songs;
}

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
    if (movies.length >= 3) break;
  }
  return movies;
}

// ---------------------------------------------------------------------------
// 4. CONTEXTO DE BIBLIOTECA (kino.library) Y PERSISTENCIA (storageLarge)
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
// 5. MOTOR DE IA (kino.ai)
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
// 6. EXPORTS DE CONTRATO KINO
// ---------------------------------------------------------------------------
export async function home() {
  return [
    {
      type: "hero",
      title: "AI Center",
      subtitle: "Centro inteligente de cine, listas y música con YTMusic",
      action: { screen: { route: "main" } }
    }
  ];
}

export async function screen(args) {
  const state = (args && args.state) || {};
  const currentTab = state.currentTab || "chat";
  const currentSessionId = state.currentSessionId || "default";

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
// 7. RENDERIZADO DE PANTALLAS
// ---------------------------------------------------------------------------

// TAB: CHAT
function renderChatTab(messages, loading) {
  const listItems = [];

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
          text: "Tu asistente multimedia. Pide recomendaciones de cine o música (con reproducción en YTMusic), juega trivia o descubre qué ver hoy.",
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
              label: "🎵 Recomiéndame Música",
              variant: "secondary",
              icon: "music",
              onTap: { event: "quick_music_prompt", arg: "Recomiéndame 3 temas musicales épicos de películas para escuchar en YouTube Music" }
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
            }
          ]
        }
      ]
    });
  }

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
              { type: "Text", text: msg.text || "" }
            ]
          }
        ]
      });
    } else {
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

      // Tarjetas de canciones de YouTube Music
      if (Array.isArray(msg.songs) && msg.songs.length > 0) {
        cardChildren.push({ type: "Divider" });
        cardChildren.push({
          type: "Row",
          gap: 8,
          children: [
            { type: "Icon", name: "music", color: "primary" },
            { type: "Text", text: "Pistas encontradas en YouTube Music (toca para reproducir):", style: "caption", bold: true }
          ]
        });

        for (let s = 0; s < msg.songs.length; s++) {
          cardChildren.push(renderSongCard(msg.songs[s], i + "_s_" + s));
        }
      }

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
          cardChildren.push(renderMovieCard(msg.movies[m], i + "_m_" + m));
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
                { type: "Text", text: "AI Center está consultando recomendaciones y metadata...", style: "caption" }
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
            hintText: "Pide recomendaciones de cine o música (ej: Hans Zimmer, Sci-Fi)...",
            onSubmitted: "send_message",
            trailingIcon: "send",
            trailingLabel: "Enviar",
            onTrailingTap: "send_message",
            maxLength: 1000
          },
          {
            type: "Text",
            text: "IA de Kino · Conexión directa a YTMusic · TMDB · storageLarge",
            style: "caption",
            color: "muted",
            textAlign: "center"
          }
        ]
      }
    ]
  };
}

// TARJETA DE CANCIÓN CONECTADA A YTMUSIC
function renderSongCard(song, keySuffix) {
  const queryStr = (song.artist ? (song.artist + " - ") : "") + song.title;

  const rowChildren = [];

  if (song.poster) {
    rowChildren.push({
      type: "Image",
      url: song.poster,
      aspect: "1:1",
      width: 80
    });
  }

  const details = [
    {
      type: "Row",
      gap: 8,
      children: [
        { type: "Badge", text: "🎵 YTMusic", color: "primary" }
      ]
    },
    {
      type: "Text",
      text: song.title,
      bold: true
    },
    {
      type: "Text",
      text: (song.artist || "YouTube Music") + (song.album ? (" • " + song.album) : ""),
      style: "caption",
      color: "muted"
    },
    {
      type: "Row",
      wrap: true,
      gap: 8,
      children: [
        {
          type: "Button",
          label: "Reproducir en YTMusic",
          icon: "music",
          variant: "primary",
          onTap: {
            go: {
              plugin: {
                repo: "JuanDEVYT/YTMusic_plugin",
                query: queryStr
              }
            }
          }
        },
        {
          type: "Button",
          label: "Buscar en Kino",
          icon: "search",
          variant: "secondary",
          onTap: {
            go: {
              search: {
                q: queryStr,
                scope: "all"
              }
            }
          }
        }
      ]
    }
  ];

  rowChildren.push({
    type: "Column",
    flex: 1,
    gap: 4,
    children: details
  });

  return {
    type: "Card",
    key: "song_card_" + keySuffix,
    variant: "filled",
    padding: 8,
    onTap: {
      go: {
        plugin: {
          repo: "JuanDEVYT/YTMusic_plugin",
          query: queryStr
        }
      }
    },
    children: [
      {
        type: "Row",
        gap: 12,
        children: rowChildren
      }
    ]
  };
}

// TARJETA DE PELÍCULA ENRIQUECIDA CON TMDB
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
        mov.rating ? { type: "Badge", text: "★ " + mov.rating, color: "primary" } : null
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
    label: "BSO en YTMusic",
    icon: "music",
    variant: "text",
    onTap: {
      go: {
        plugin: {
          repo: "JuanDEVYT/YTMusic_plugin",
          query: mov.title + " soundtrack"
        }
      }
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
        { type: "Text", text: "Pídele a AI Center en el chat: \"Crea una lista llamada Joyas Ocultas\"", style: "caption", color: "muted", textAlign: "center" }
      ]
    });
  } else {
    for (let i = 0; i < customLists.length; i++) {
      const list = customLists[i];
      const movieChips = (list.movies || []).map(function(m) {
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
          { type: "Text", text: "Integración profunda con tu plugin YouTube Music. Toca cualquier canción para reproducir.", style: "caption", color: "muted" }
        ]
      },
      {
        type: "Card",
        variant: "filled",
        padding: 16,
        children: [
          { type: "Text", text: "Temas y Compositores Recomendados", bold: true },
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
                onTap: {
                  event: "quick_music_prompt",
                  arg: "Recomiéndame 3 canciones o bandas sonoras destacadas de " + a
                }
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
          { type: "Text", text: "Géneros Musicales de Cine", bold: true },
          {
            type: "Row",
            wrap: true,
            gap: 8,
            children: genres.map(function(g) {
              return {
                type: "Button",
                label: g,
                variant: "secondary",
                onTap: {
                  event: "quick_music_prompt",
                  arg: "Recomienda 3 canciones del género " + g + " para escuchar en YouTube Music"
                }
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
          { type: "Text", text: "Generadores Musicales con IA", bold: true },
          {
            type: "Row",
            wrap: true,
            gap: 8,
            children: [
              {
                type: "Button",
                label: "🎵 Soundtracks de Ciencia Ficción",
                variant: "primary",
                onTap: {
                  event: "quick_music_prompt",
                  arg: "Recomiéndame 3 temas musicales épicos de películas de ciencia ficción para escuchar en YouTube Music"
                }
              },
              {
                type: "Button",
                label: "🎧 Música para estudiar (Instrumental)",
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
// 8. GESTIÓN DE EVENTOS (screenEvent)
// ---------------------------------------------------------------------------
export async function screenEvent(args) {
  const name = args.name || "";
  const arg = args.arg;
  const value = args.value;
  const state = args.state || {};
  const currentTab = state.currentTab || "chat";
  const currentSessionId = state.currentSessionId || "default";

  if (name === "nav_change") {
    const nextTab = value || arg || "chat";
    return {
      state: Object.assign({}, state, { currentTab: nextTab })
    };
  }

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
    messages.push({ role: "assistant", text: textToShow, movies: movies, songs: [] });

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
    messages.push({ role: "assistant", text: triviaText, movies: [], songs: [] });

    await persistCurrentSession(currentSessionId, messages);

    return {
      state: Object.assign({}, state, { messages: messages, loading: false })
    };
  }

  // Prompts rápidos de música (consultan YouTube Music directamente)
  if (name === "quick_music_prompt") {
    const userPrompt = arg;
    const sysPrompt = "Eres un especialista musical conectado a YouTube Music. Recomienda de 2 a 3 canciones o bandas sonoras. Escribe cada título de canción entre comillas y el artista, ej: \"Cornfield Chase\" de Hans Zimmer.";
    const answer = await askAI(userPrompt, sysPrompt);
    const text = answer || "Aquí tienes excelentes temas musicales:\n- \"Time\" de Hans Zimmer\n- \"Cornfield Chase\" de Hans Zimmer\n- \"Tears in Rain\" de Vangelis";
    const songs = await enrichRecommendedMusic(text, userPrompt);

    let messages = Array.isArray(state.messages) ? state.messages.slice() : [];
    messages.push({ role: "user", text: userPrompt });
    messages.push({ role: "assistant", text: text, songs: songs, movies: [] });

    await persistCurrentSession(currentSessionId, messages);

    return {
      state: Object.assign({}, state, { currentTab: "chat", messages: messages, loading: false })
    };
  }

  // Prompt rápido de cine
  if (name === "quick_prompt") {
    const userPrompt = arg;
    const answer = await askAI(userPrompt, "Eres AI Center, asistente cinéfilo experto. Pon los títulos de películas recomendadas entre comillas con su año, ej: \"Matrix\" (1999).");
    const text = answer || "Aquí tienes excelentes recomendaciones:\n- \"Matrix\" (1999)\n- \"Arrival\" (2016)\n- \"Dark City\" (1998)";
    const movies = await enrichRecommendedMovies(text);

    let messages = Array.isArray(state.messages) ? state.messages.slice() : [];
    messages.push({ role: "user", text: userPrompt });
    messages.push({ role: "assistant", text: text, movies: movies, songs: [] });

    await persistCurrentSession(currentSessionId, messages);

    return {
      state: Object.assign({}, state, { messages: messages, loading: false })
    };
  }

  // Enviar mensaje del usuario con detección inteligente de Cine vs. Música
  if (name === "send_message") {
    const userText = (value && typeof value === "object" && value.prompt) ? value.prompt.trim() : (state.inputs && state.inputs.prompt ? state.inputs.prompt.trim() : (typeof value === "string" ? value.trim() : ""));
    if (!userText) return null;

    let messages = Array.isArray(state.messages) ? state.messages.slice() : [];
    messages.push({ role: "user", text: userText });

    const isMusic = isMusicIntent(userText);

    if (isMusic) {
      // Flujo de Música & YouTube Music
      const sysPrompt = "Eres AI Center especializado en música y bandas sonoras conectado a YouTube Music. " +
        "Recomienda de 2 a 3 canciones o pistas específicas. Escribe siempre cada tema musical entre comillas y nombra a su compositor o artista (ejemplo: \"Cornfield Chase\" de Hans Zimmer o \"Starboy\" de The Weeknd).";

      const aiResponse = await askAI(userText, sysPrompt);
      const finalAiText = aiResponse || "Aquí tienes algunas recomendaciones musicales disponibles en YouTube Music: \"Time\" de Hans Zimmer y \"Day One\" de Hans Zimmer.";
      const songs = await enrichRecommendedMusic(finalAiText, userText);

      messages.push({
        role: "assistant",
        text: finalAiText,
        songs: songs,
        movies: []
      });
    } else {
      // Flujo de Cine & Películas
      const libraryCtx = await getUserLibraryContext();
      let sysPrompt = "Eres AI Center, asistente cinéfilo experto de Kino. Responde de forma analítica y entusiasta. " +
        "Cuando recomiendes películas, menciona sus títulos entre comillas con su año, por ejemplo: \"Interestelar\" (2014) o \"El Padrino\" (1972).";

      if (libraryCtx.watchedTitles.length > 0) {
        sysPrompt += " Películas vistas por el usuario: " + libraryCtx.watchedTitles.slice(0, 8).join(", ") + ".";
      }

      const aiResponse = await askAI(userText, sysPrompt);
      const finalAiText = aiResponse || "Te recomiendo explorar \"Interestelar\" (2014) y \"Dune\" (2021). Son dos obras que destacan por su dirección y diseño sonoro.";
      const movies = await enrichRecommendedMovies(finalAiText);

      messages.push({
        role: "assistant",
        text: finalAiText,
        movies: movies,
        songs: []
      });
    }

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
// 9. PERSISTENCIA storageLarge
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
