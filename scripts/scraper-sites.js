// Site list for Lumora's built-in scraper engine (com.lumora.scraper).
//
// This script carries data, not behaviour. The engine - every per-site parser, all 86 extractors
// and the Cloudflare bypass - is compiled into the app, because none of it can be expressed as
// data: it needs a real WebView, the shared cookie store, and typed HTTP clients. What CAN be
// expressed as data is which of those sites are still up and which domain the repointable ones
// are on, and that is the half that rots. Editing this file takes a dead site out of rotation
// for everyone on the next refresh, with no app release.
//
// It is an OVERRIDE LAYER, not the source of truth:
//   - a `name` the installed app has no provider for is skipped, so this can be updated ahead
//     of an app release without breaking older installs;
//   - a site the app has but this file omits stays enabled, so a partial list degrades to
//     "everything on" rather than to "nothing works".
//
// `enabled: false` is a kill switch for something broken for everyone. It is deliberately not
// symmetric with the user's own per-site toggles in Settings: their "off" wins, so an update
// here can never switch a site back on for someone who turned it off.
//
// `baseUrl` is where the site actually lives, and it is required: a site without one is skipped
// even if `enabled` is true, because the compiled-in parser has nowhere to send a request. This
// is the point of the split - the parsing is specific to a site and has to ship in the app, but
// the address changes constantly and does not.
//
// `domainKey` marks the few sites that also keep their host in the app's settings, because their
// own code resolves a live domain at runtime and writes it back; the manifest seeds those so the
// two agree on a fresh install.
//
// `anime: true` marks an anime-only catalogue. Those sites cannot answer for a live-action
// title, so the app skips them unless the title is itself anime - roughly half the list was
// being queried for films it could never carry.
//
// `heavy: true` marks a site whose search goes through the Cloudflare WebView bypass: a full
// Chromium page load per query, by far the most expensive step here. Those are held back and
// only queried if the cheap sites came up empty.
//
// `name` must match the provider's own name exactly; that is the key the app matches on.
//
// `logo` and `extra` carry the secondary literals a provider used to compile in directly - its
// logo image, an alternate API/CDN host, a header value the site expects. A provider reads these
// via `ScraperExtras.get(name, key)`. Unlike `baseUrl` these apply even to a site that's
// `enabled: false` or has no `baseUrl` yet, so a provider's logo/etc. can move out here ahead of
// its baseUrl being wired up operationally. Which keys a given provider looks for is documented
// in that provider's own Kotlin source.

PLUGIN = {
    id: "scraper.sites",
    label: "Streaming Site List",
    description: "Which built-in scraper sites are live, and where the repointable ones point.",
    capabilities: ["scraper_sites"],
};

var VERSION = 4;

var SITES = [
    { name: "AfterDark", language: "en", enabled: false, note: "baseUrl not yet known - fill in before enabling.", baseUrl: "", extra: { logo: "https://images2.imgbox.com/f5/45/6Es7LVQ6_o.png" } },
    { name: "1Jour1Film", language: "fr", enabled: false, note: "baseUrl not yet known - fill in before enabling.", baseUrl: "", extra: { portalUrl: "https://1jour1film-officiel.site/" } },
    { name: "Altadefinizione01", language: "it", enabled: true, baseUrl: "https://altadefinizione-01.fun", extra: { vidxgoHost: "https://v.vidxgo.co" } },
    { name: "Anikoto", language: "en", enabled: true, baseUrl: "https://anikototv.to", anime: true },
    { name: "Anime Online Ninja", language: "es", enabled: true, baseUrl: "https://ww3.animeonline.ninja", anime: true, heavy: true },
    { name: "AnimeAV1", language: "es", enabled: true, baseUrl: "https://animeav1.com", anime: true, extra: { logo: "https://animeav1.com/favicon.png", origin: "https://animeav1.com", cdnHost: "https://cdn.animeav1.com" } },
    { name: "Animefenix", language: "es", enabled: true, baseUrl: "https://animefenix2.tv", anime: true, extra: { logo: "https://animefenix2.tv/themes/fenix-neo/images/AveFenix.png" } },
    { name: "AnimeFLV", language: "es", enabled: true, baseUrl: "https://www3.animeflv.net", anime: true, extra: { logo: "https://www3.animeflv.net/assets/animeflv/img/logo.png", cdnHost: "https://cdn.animeflv.net" } },
    { name: "AnimeSaturn", language: "it", enabled: true, baseUrl: "https://www.animesaturn.cx", anime: true, extra: { logo: "https://www.animesaturn.net/assets/img/saturn.png" } },
    { name: "AnimeUnity", language: "it", enabled: true, baseUrl: "https://www.animeunity.so", anime: true },
    { name: "AnimeWorld", language: "it", enabled: true, baseUrl: "https://www.animeworld.ac", anime: true, extra: { logo: "https://static.animeworld.ac/assets/images/favicon/android-icon-192x192.png?4" } },
    { name: "AniWorld", language: "de", enabled: true, baseUrl: "https://aniworld.to/", anime: true },
    { name: "CableVisionHD", language: "es", enabled: false, note: "Live TV channels only - cannot source a film or episode.", baseUrl: "https://www.cablevisionhd.com" },
    { name: "CB01", language: "it", enabled: true, baseUrl: "https://cb01official.uno", extra: { stayOnlineUrl: "https://stayonline.pro/" } },
    { name: "Cine24h", language: "es", enabled: true, baseUrl: "https://cine24h.online", heavy: true },
    { name: "CineCalidad", language: "es", enabled: true, baseUrl: "https://www.cinecalidad.ec", extra: { logo: "https://www.cinecalidad.ec/wp-content/themes/Cinecalidad/assets/img/logo.png" } },
    { name: "CineHax", language: "es", enabled: true, baseUrl: "https://cinehax.com", extra: { logo: "https://cinehax.com/wp-content/uploads/2026/06/cropped-favicon-192x192.jpg", unlimplayHost: "unlimplay.com", remuxHost: "remux.unlimplay.com" } },
    { name: "Cuevana 3", language: "es", enabled: true, domainKey: "cuevana", baseUrl: "https://cuevana.gs" },
    { name: "Doramasflix", language: "es", enabled: true, baseUrl: "https://doramasflix.in", anime: true, extra: { apiUrl: "https://sv1.fluxcedene.net/api/", fkPlayerDecodingUrl: "https://fkplayer.xyz/api/decoding", logo: "https://doramasflix.in/img/logo.png" } },
    { name: "Einschalten", language: "de", enabled: true, baseUrl: "https://einschalten.in" },
    { name: "Fanpelis", language: "es", enabled: true, baseUrl: "https://fanpelis.to/", extra: { apiUrl: "https://fanpelis.to/api/rest/", logo: "https://fanpelis.to/wp-content/uploads/2025/02/cropped-play-button-icon-trendy-flat-260nw-752745979-e1738708582632-192x192.webp" } },
    { name: "Filmpalast", language: "de", enabled: true, baseUrl: "https://filmpalast.to" },
    { name: "FilmyOnline", language: "pl", enabled: true, baseUrl: "https://filmyonline.cc", heavy: true },
    { name: "FlixLatam", language: "es", enabled: true, baseUrl: "https://flixlatam.com" },
    { name: "Frembed", language: "fr", enabled: true, baseUrl: "https://frembed.casa/", extra: { portalUrl: "https://audin213.com/" } },
    { name: "FrenchAnime", language: "fr", enabled: true, baseUrl: "https://french-anime.com/", anime: true },
    { name: "FrenchManga", language: "fr", enabled: true, baseUrl: "https://w16.french-manga.net/", anime: true, extra: { portalUrl: "http://fstream.info/" } },
    { name: "FrenchStream", language: "fr", enabled: true, baseUrl: "https://fs16.lol/", extra: { portalUrl: "https://fstream.info/" } },
    { name: "GuardaFlix", language: "it", enabled: true, baseUrl: "https://guardaplay.store" },
    { name: "GuardaSerie", language: "it", enabled: true, baseUrl: "https://guardoserie.study", heavy: true },
    { name: "HDFilme", language: "de", enabled: true, baseUrl: "https://hdfilme.win", extra: { serialApiUrl: "https://meinecloud.click" } },
    { name: "IPTV Spain", language: "es", enabled: false, note: "Live TV channels only - cannot source a film or episode.", baseUrl: "https://iptv-org.github.io/iptv/languages/spa.m3u" },
    { name: "IPTV-All World", language: "en", enabled: false, note: "Live TV channels only - cannot source a film or episode.", baseUrl: "https://iptv-org.github.io/iptv" },
    { name: "JKAnime", language: "es", enabled: true, baseUrl: "https://jkanime.net", anime: true, extra: { cdnUrl: "https://cdn.jkdesa.com" } },
    { name: "Kidraz", language: "fr", enabled: true, baseUrl: "https://www.kidraz.com/saby1jy/home/kidraz", anime: true, extra: { portalUrl: "http://chezlesducs.free.fr/films.php", logo: "https://www.kidraz.com/favicon.png" } },
    { name: "La Cartoons", language: "es", enabled: true, baseUrl: "https://www.lacartoons.com", anime: true },
    { name: "Latanime", language: "es", enabled: true, baseUrl: "https://latanime.org", anime: true, extra: { logo: "https://latanime.org/public/img/logito.png" } },
    { name: "MAGISTV", language: "es", enabled: false, note: "Live TV channels only - cannot source a film or episode.", baseUrl: "https://raw.githubusercontent.com", extra: { playlistUrl: "https://raw.githubusercontent.com/CINECITY2023/cinecity/cinecity.net/principal.m3u" } },
    { name: "MEGAKino", language: "de", enabled: true, baseUrl: "https://megakino12.com" },
    { name: "MKissa", language: "en", enabled: true, baseUrl: "https://mkissa.to/anime", anime: true, extra: { apiUrl: "https://api.allanime.day/api", clockUrl: "https://allanime.day", imageUrl: "https://aln.youtube-anime.com", imageAltUrl: "https://wp.youtube-anime.com", origin: "https://allanime.to" } },
    { name: "Moflix", language: "de", enabled: true, domainKey: "moflix", baseUrl: "https://moflix-stream.xyz" },
    { name: "PelisflixHD", language: "es", enabled: true, baseUrl: "https://pelisflixhd.win", extra: { logo: "https://s.pelisflixhd.win/cat/logo-mini.png" } },
    { name: "Pelisplusto", language: "es", enabled: true, baseUrl: "https://pelisplus.to", extra: { logo: "https://pelisplus.to/images/logo2.png" } },
    { name: "Pelota Libre TV", language: "es", enabled: false, note: "Live TV channels only - cannot source a film or episode.", baseUrl: "https://pelotalibretvhd.live", extra: { streamRedirectUrl: "https://streamtpday1.xyz", fallbackHost: "ontve.click" } },
    { name: "Pluto TV Ar", language: "es", enabled: false, note: "Live TV channels only - cannot source a film or episode.", baseUrl: "https://raw.githubusercontent.com", extra: { playlistUrl: "https://raw.githubusercontent.com/BuddyChewChew/app-m3u-generator/main/playlists/plutotv_ar.m3u" } },
    { name: "Pluto TV De", language: "de", enabled: false, note: "Live TV channels only - cannot source a film or episode.", baseUrl: "https://raw.githubusercontent.com", extra: { playlistUrl: "https://raw.githubusercontent.com/BuddyChewChew/app-m3u-generator/main/playlists/plutotv_de.m3u" } },
    { name: "Pluto TV Es", language: "es", enabled: false, note: "Live TV channels only - cannot source a film or episode.", baseUrl: "https://raw.githubusercontent.com", extra: { playlistUrl: "https://raw.githubusercontent.com/BuddyChewChew/app-m3u-generator/main/playlists/plutotv_es.m3u" } },
    { name: "Pluto TV FR", language: "fr", enabled: false, note: "Live TV channels only - cannot source a film or episode.", baseUrl: "https://raw.githubusercontent.com", extra: { playlistUrl: "https://raw.githubusercontent.com/BuddyChewChew/app-m3u-generator/main/playlists/plutotv_fr.m3u" } },
    { name: "Pluto TV It", language: "it", enabled: false, note: "Live TV channels only - cannot source a film or episode.", baseUrl: "https://raw.githubusercontent.com", extra: { playlistUrl: "https://raw.githubusercontent.com/BuddyChewChew/app-m3u-generator/main/playlists/plutotv_it.m3u" } },
    { name: "Pluto TV MX", language: "es", enabled: false, note: "Live TV channels only - cannot source a film or episode.", baseUrl: "https://raw.githubusercontent.com", extra: { playlistUrl: "https://raw.githubusercontent.com/BuddyChewChew/app-m3u-generator/main/playlists/plutotv_mx.m3u" } },
    { name: "Pluto TV Us", language: "en", enabled: false, note: "Live TV channels only - cannot source a film or episode.", baseUrl: "https://raw.githubusercontent.com", extra: { playlistUrl: "https://raw.githubusercontent.com/BuddyChewChew/app-m3u-generator/main/playlists/plutotv_us.m3u" } },
    { name: "Poseidonhd2", language: "es", enabled: true, domainKey: "poseidon", baseUrl: "https://www.poseidonhd2.co", heavy: true },
    { name: "Ridomovies", language: "en", enabled: true, baseUrl: "https://ridomovies.tv/" },
    { name: "SerienStream", language: "de", enabled: true, domainKey: "serienstream", baseUrl: "https://s.to" },
    { name: "Series Turcas", language: "es", enabled: true, baseUrl: "https://tbg.seriesturcastv.to", extra: { esprinahyUrl: "https://esprinahy.com" } },
    { name: "SeriesFlix", language: "es", enabled: true, baseUrl: "https://seriesflixhd.lol", extra: { logo: "https://s.seriesflixhd.lol/series/imgs/favicon-192.png" } },
    { name: "SFlix", language: "en", enabled: true, baseUrl: "https://sflix.to/", extra: { logo: "https://img.sflix.to/xxrz/400x400/100/66/35/66356c25ce98cb12993249e21742b129/66356c25ce98cb12993249e21742b129.png" } },
    { name: "SoloLatino", language: "es", enabled: true, baseUrl: "https://sololatino.net" },
    { name: "StreamingCommunity", language: "it", enabled: true, domainKey: "streamingcommunity", baseUrl: "https://streamingunity.cc" },
    { name: "StreamingCommunity EN", language: "en", enabled: true, domainKey: "streamingcommunity", baseUrl: "https://streamingunity.cc" },
    { name: "TioAnime", language: "es", enabled: true, baseUrl: "https://tioanime.com", anime: true },
    { name: "TMDb", language: "en", enabled: true, baseUrl: "https://www.themoviedb.org", note: "Metadata source, not a stream scraper; logo only. Provider's own name carries the active language, e.g. \"TMDb (en)\" - it looks this entry up by the bare \"TMDb\" family name.", extra: { logo: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/89/Tmdb.new.logo.svg/1280px-Tmdb.new.logo.svg.png" } },
    { name: "Tv Libre Futbol", language: "es", enabled: false, note: "Live TV channels only - cannot source a film or episode.", baseUrl: "https://www.librefutbol2.com", extra: { mirrorReferer: "https://www.librefutbol2.com/" } },
    { name: "TvporinternetHD", language: "es", enabled: false, note: "Live TV channels only - cannot source a film or episode.", baseUrl: "https://www.tvporinternet2.com", extra: { mirrorReferer: "https://www.tvporinternet2.com/" } },
    { name: "Wiflix", language: "fr", enabled: true, baseUrl: "https://flemmix.team/", extra: { portalUrl: "https://ww1.wiflix-adresses.fun/" } },
    { name: "Zaluknij", language: "pl", enabled: true, baseUrl: "https://zaluknij.cc", heavy: true },
];

// The host reads this back as a JSON string: it crosses the bridge once, deterministically,
// where a nested array of objects is the one shape that does not round-trip reliably.
function sites(host) {
    return JSON.stringify({ version: VERSION, sites: SITES });
}
